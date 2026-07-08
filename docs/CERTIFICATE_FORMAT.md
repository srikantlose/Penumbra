# Penumbra Certificate Format v0.1

## Overview

A Penumbra certificate is a machine-verifiable proof that establishes the game-theoretic value of a chess position. Certificates are compact, canonical, and independently verifiable without access to the prover.

**Key principle:** A certificate is an AND/OR DAG proof tree with terminals at tablebase positions or checkmate/stalemate states. The verifier reconstructs the tree, checks move legality, and validates claim coverage.

## Semantics

### Claims

A certificate proves **one of two claim types** about a position:

1. **`win(side)`** — The specified side has a forced win from this position under standard chess rules.
2. **`at_least_draw(side)`** — The specified side can force a draw at minimum (fortress-style).

An **exact draw** is proven by two certificates: `at_least_draw(white)` and `at_least_draw(black)`.

### Proof structure

The proof is an AND/OR directed acyclic graph (DAG):

- **OR-node**: The claiming side moves. Certificate supplies **one** move (the key move along the winning/drawing line).
- **AND-node**: The opponent moves. Certificate must cover **all legal moves** from this position (verifier regenerates the move list independently).
- **Terminal**: Proof ends at checkmate, stalemate, or a position referenced in the Syzygy tablebase (≤7 pieces).

### Cycle discipline (soundness)

- **`win` certificates must be acyclic** (proof of game-theoretic win requires well-founded progress to terminal wins via the chosen line + forced opponent responses).
- **`at_least_draw` certificates MAY contain cycles** (a cycle in the defender's moves means the defender confines play to a finite closed set with no forced loss, which is sufficient for a draw claim under the 50-move and threefold repetition rules).

The spec explicitly documents this asymmetry.

## Format (JSON)

Certificates are stored as canonical JSON (RFC 8785 / JCS) within a zstd-compressed container.

### Top-level fields

```json
{
  "format_version": "0.1",
  "claim": { ... },
  "rules": "standard",
  "root_id": "string",
  "nodes": [ ... ],
  "dependencies": { ... },
  "metadata": { ... }
}
```

### Claim object

```json
{
  "claim": {
    "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "zobrist": "0x1234567890abcdef",
    "value": "win",
    "side": "white"
  }
}
```

- **fen**: Full FEN of the position (board, side to move, castling, ep target, clocks).
- **zobrist**: Polyglot Zobrist hash (64-bit hex).
- **value**: `"win"` or `"at_least_draw"`.
- **side**: `"white"` or `"black"` — the side for which the claim holds.

### Nodes array

```json
{
  "nodes": [
    {
      "id": "root",
      "zobrist": "0x1234567890abcdef",
      "to_move": "white",
      "kind": "or-node",
      "moves": [
        {
          "uci": "e2e4",
          "child_id": "node_1"
        }
      ]
    },
    {
      "id": "node_1",
      "zobrist": "0xfedcba0987654321",
      "to_move": "black",
      "kind": "and-node",
      "moves": [
        {
          "uci": "c7c5",
          "child_id": "node_2"
        },
        {
          "uci": "e7e5",
          "child_id": "node_3"
        }
      ]
    },
    {
      "id": "node_2",
      "zobrist": "0xabcd1234ef567890",
      "to_move": "white",
      "kind": "terminal",
      "terminal": {
        "type": "tablebase",
        "value": "win"
      }
    }
  ]
}
```

#### Node fields

- **id**: Unique identifier within the certificate (string, e.g., "root", "node_1", etc.).
- **zobrist**: Polyglot hash of the position at this node.
- **to_move**: `"white"` or `"black"`.
- **kind**: `"or-node"` | `"and-node"` | `"terminal"`.
- **moves** (non-terminal only): Array of move objects with UCI notation and child node IDs.
  - For OR-nodes: typically one move (the key line).
  - For AND-nodes: **all legal moves must be present** (verifier will check coverage).
- **terminal** (terminal only): 
  - **type**: `"checkmate"` | `"stalemate"` | `"tablebase"` | `"transposition"`.
  - **value**: Result (`"win"`, `"draw"`, `"loss"`) — can be omitted for transposition/tablebase if obvious from context.
  - **dtm** (optional): Distance-to-mate for tablebase terminals.

### Dependencies

```json
{
  "dependencies": {
    "tablebase": "syzygy"
  }
}
```

Lists external dependencies. Currently only `"syzygy"` is supported (optional if no TB references).

### Metadata

```json
{
  "metadata": {
    "producer": "penumbra-prover v0.1",
    "timestamp": "2024-07-07T12:00:00Z",
    "contributors": ["alice", "bob"],
    "work_units": ["wu_001", "wu_002"]
  }
}
```

**Important:** Metadata is **outside the verification boundary**. The verifier ignores it. Signatures and attestation arrive later (Phase 3 Fleet).

- **producer**: Name of the certificate generator.
- **timestamp**: ISO 8601 timestamp.
- **contributors** (optional): Fleet contributors.
- **work_units** (optional): Work unit identifiers (for distributed proving).

## Wire format

### Container (`.pnbcert` file)

```
[4 bytes magic: "PNBC"]
[JSON Certificate - canonical RFC 8785 / JCS]
```

For Phase 1, the JSON is stored plaintext. Phase 2 may add zstd compression; verifier supports both.

## Identity & integrity

Certificate identity = `SHA256(canonical_json)` (hex string, prefixed `0x`).

The verifier computes the hash and reports it. Certificates are matched against a trusted registry (the Ledger, Phase 3) by this hash.

**Canonical value domain:** v0.1 certificates are restricted to ASCII strings and integers — no
floating-point numbers, no non-ASCII characters. Every field in this spec (`fen`, `zobrist`,
`uci`, ids, enum values, `dtm`, timestamps) already satisfies this. The restriction exists so
that two independently-written canonicalizers can agree without either needing to implement
RFC 8785's full ECMAScript-derived number-formatting algorithm: the reference implementations
are `packages/cert-schema` (TypeScript, via the `canonicalize` library) and `rust/verifier`
(Rust, via `serde_json::Value` re-serialization — its default map type is key-sorted, so no
separate canonicalization step is needed once the value domain is enforced). A certificate
containing a float or a non-ASCII string is rejected as having no well-defined identity, rather
than hashed inconsistently.

## Verification algorithm

### Input
- Certificate file (`.pnbcert`).
- Optional: path to Syzygy tablebases or endpoint URL.

### Output
- Valid/invalid with an error code (verifier exit code).
- Report: claim, node count, terminal count, probe count, elapsed time.

### Procedure

1. **Parse**: Decompress/parse JSON, validate against JSON Schema.
2. **Semantic checks**:
   - Verify the root node ID exists.
   - Foreach non-terminal node:
     - Regenerate legal moves (via `shakmaty` or equivalent).
     - For OR-nodes: the single move in the certificate must be legal.
     - For AND-nodes: all legal moves must have a child in the certificate (coverage check).
   - Foreach terminal node:
     - If checkmate/stalemate: verify it matches the actual board state (no legal moves, etc.).
     - If tablebase: probe Syzygy and verify the claimed result (value = `win`/`draw`/`loss`).
3. **Cycle detection** (soundness):
   - For `win` certificates: ensure no cycles (use DFS, mark nodes as "visiting" and "visited").
   - For `at_least_draw` certificates: cycles are allowed.
4. **Report**: Print claim, counts, elapsed time; exit 0 if valid, exit 1 if invalid.

## Examples

### Minimal fortress certificate (3 moves, 2 nodes)

```json
{
  "format_version": "0.1",
  "claim": {
    "fen": "7k/8/8/8/K7/8/8/8 w - - 0 1",
    "zobrist": "0x0123456789abcdef",
    "value": "at_least_draw",
    "side": "black"
  },
  "rules": "standard",
  "root_id": "root",
  "nodes": [
    {
      "id": "root",
      "zobrist": "0x0123456789abcdef",
      "to_move": "white",
      "kind": "or-node",
      "moves": [
        {
          "uci": "a4b5",
          "child_id": "black_move"
        }
      ]
    },
    {
      "id": "black_move",
      "zobrist": "0xfedcba9876543210",
      "to_move": "black",
      "kind": "and-node",
      "moves": [
        {
          "uci": "h8g7",
          "child_id": "cycle_back"
        },
        {
          "uci": "h8g8",
          "child_id": "cycle_back"
        }
      ]
    },
    {
      "id": "cycle_back",
      "zobrist": "0x0123456789abcdef",
      "to_move": "white",
      "kind": "terminal",
      "terminal": {
        "type": "transposition",
        "value": "draw"
      }
    }
  ],
  "dependencies": {},
  "metadata": {
    "producer": "penumbra-prover v0.1",
    "timestamp": "2024-07-07T12:00:00Z"
  }
}
```

## Versioning

Format versions are independent. A v0.2 may introduce binary encoding or zstd by default; the verifier binary is pinned per `format_version` in the schema. Old certificates remain verifiable forever.

## Compliance notes

- **GPL:** The verifier is distributed under Apache-2.0 (maximum auditability). Engine binaries remain GPL.
- **Independence:** The verifier has zero code shared with the prover; move generation is via `shakmaty` (third-party).
