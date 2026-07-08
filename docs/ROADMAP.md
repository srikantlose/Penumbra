# Penumbra Roadmap — Phase 1 Completion

Executable, ordered plan for every remaining milestone. Written 2026-07-08 against HEAD at the
"add stitch design import pipeline and setup docs" commit.

**Document contract:** each task below names exact files, signatures, commands, and expected
output. Follow stages strictly in order; never start a stage before its predecessor's acceptance
gate passes in full. Tick checkboxes (`[ ]` → `[x]`) as tasks complete and commit the tick with
the work it describes. When something here conflicts with reality (an API changed, a version
vanished), stop, record the discrepancy in the Decision log at the bottom, pick the closest
equivalent, and continue — do not silently improvise beyond that.

**Relationship to the other status docs:**

- `docs/ROADMAP.md` (this file, committed) — the forward plan and single "what's next" authority.
- `PROGRESS.md` (committed) — narrative status ledger; update at each stage close (what shipped,
  verification results, bugs found). Its "Next action" section should just point here.
- `HANDOFF.md` (untracked, gitignored) — per-session working snapshot for context resets;
  regenerate freely; promote anything durable into this file (decisions) or PROGRESS.md (status)
  before a session ends.

---

## 1. Global invariants

### 1.1 Do-not-touch list

1. **Two-crate independence** — `rust/verifier` and `rust/prover` share **no code**, ever. No
   shared crate, no `use penumbra_prover::…` in the verifier (the prover's *dev-dependency* on
   the verifier for round-trip tests is the one allowed direction). Fixture *data* files may be
   copied between crates; code may not. Shared *third-party* deps (shakmaty, shakmaty-syzygy)
   are fine — each crate integrates them independently.
2. **`check_acyclic` stays gated on `claim.value == "win"`**
   (`rust/verifier/src/verifier.rs`). `at_least_draw` certificates MAY contain cycles
   (fortress/repetition discipline). Never extend the acyclicity check to draw claims.
3. **Append-only tables** — `evals`, `fog_scores`, `ledger_entries`: inserts only, never an
   UPDATE or DELETE path in any service code. (Stage 1.4 adds DB triggers that enforce this.)
4. **Existing golden/mutation fixture files** — `rust/verifier/tests/golden/kqpk.json`,
   `rust/verifier/tests/mutations/*.json` stay byte-identical. Tests referencing them may be
   renamed/re-scoped (Stage 1.1 does exactly that); the JSON files themselves are frozen.
   New fixtures are always *added*, never regenerated over old ones.
5. **`.git/hooks/pre-commit`** — blocks AI-attribution markers. Never disable or bypass
   (`--no-verify` is forbidden).
6. **`.gitignore` entries** for `.claude/`, `CLAUDE.md`, `tools/`, `HANDOFF.md`,
   `.stitch-project.json` — keep them.
7. **Web design system** — the retro B&W 8-bit system in `apps/web/tailwind.config.ts` +
   `globals.css` (Press Start 2P, 0px radius, dither fills, shader background, click effects)
   is locked. Page layouts may change; the font/shader/aesthetic tokens may not.
8. **Certificate format stays v0.1** — everything in Stages 1–7 fits the existing spec
   (`docs/CERTIFICATE_FORMAT.md`): `tablebase`/`transposition`/`stalemate` terminals, optional
   `terminal.value`/`dtm`, `dependencies.tablebase: "syzygy"` are all already spec'd. Do not bump
   the format version; only the Ledger section (Stage 5) is a documented *addendum* (the ledger
   is outside the certificate format).

### 1.2 Commit conventions

- Imperative lowercase subject ≤72 chars, plain-prose body when needed. Match `git log` tone.
- **Zero AI attribution** anywhere: no trailers, no co-authors, no "generated with" — the
  pre-commit hook enforces this; write commits as the repo owner.
- One logical change per commit; each stage section below ends with its commit plan.
- Never bundle unrelated working-tree changes; `git status` before every commit.

### 1.3 Ask-the-user-first checkpoints

Stop and ask before any of these; everything else in this file is pre-approved:

- `git push` to origin **outside** a stage's stated commit+push plan.
- Any production deploy, DNS, or account signup (Stage 7).
- The license split decision (Stage 7 task 1 — GPL finding must be confirmed by the user).
- Deleting or regenerating any committed fixture (vs. adding new ones).
- Any download beyond those named here (Syzygy 3-4-5 ≈ 1 GB, engine binaries + Lc0 net ≈ 500 MB
  are pre-approved).
- Publishing anything (crates.io, GitHub release) — Stage 7 lists these; confirm at stage start.

### 1.4 Recurring gotchas (read before every stage)

- **Cargo workspace root is the repo root.** Build artifacts land in `<repo>/target/`, never
  `rust/target/`. Binaries: `target\debug\penumbra-prove.exe`, `target\debug\penumbra-verify.exe`.
- **Fresh PowerShell may lack cargo on PATH:**
  `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`
- **drizzle-kit must run from the repo root** (`drizzle.config.ts` lives there and paths resolve
  against cwd). Use the root scripts: `pnpm run db:generate` / `db:migrate` / `db:push` / `db:studio`.
- **Windows line endings:** git warns `LF will be replaced by CRLF` — harmless, ignore.
- **shakmaty idioms** (both crates):
  position `Fen::from_ascii(bytes)?.into_setup().position::<Chess>(CastlingMode::Standard)?`;
  zobrist `pos.zobrist_hash::<Zobrist64>(EnPassantMode::Legal)`;
  UCI `mv.to_uci(CastlingMode::Standard)`.
- **`zobrist_hex` format:** `0x` + exactly 16 lowercase hex chars (length 18).
- **Docker services:** `docker-compose -f infra/docker-compose.yml up -d` (postgres 5432,
  redis 6379, minio 9000/9001; creds `penumbra`/`penumbra`, minio `minioadmin`). Docker Desktop
  may be paused on this machine — if a connect fails, that's the first thing to check.
- **Press Start 2P is ~2× wider than normal monospace** — any new data-dense web table must be
  eyeballed for overflow at the design system's `data-mono` (10px) size (this bit once already).
- **AND/OR semantics** (memorize): OR = claiming side to move (proved if ANY child proved,
  `pn = min(children)`, `dn = Σchildren`); AND = opponent to move (proved only if ALL children
  proved, `pn = Σ`, `dn = min`). OR nodes emit exactly one winning move in certs; AND nodes emit
  every legal reply.

---

## 2. Environment quick reference

```powershell
# Everything runs from the repo root: c:\Users\user\Desktop\PROJECTS 2026\Penumbra

pnpm install                      # JS deps (workspace: apps/* services/* packages/*)
pnpm build                        # turbo build, all TS packages incl. web
pnpm test                         # turbo test
cargo build --workspace           # both Rust crates
cargo test --workspace            # currently 10 tests (verifier 4, prover 6)
cargo clippy --workspace --all-targets
docker-compose -f infra/docker-compose.yml up -d
pnpm run db:generate              # drizzle: emit migration from schema diff
pnpm run db:migrate               # drizzle: apply migrations (needs DATABASE_URL or default)
# default DATABASE_URL: postgresql://penumbra:penumbra@localhost:5432/penumbra
```

Machine: Windows 11, Ryzen 5 7600 (12 threads), 32 GB RAM, RTX 4060 (CUDA — Lc0-viable).
Node ≥18 (CI uses 20 after Stage 1.5), pnpm 9.15.0 (`packageManager` field), Rust stable MSVC.

---

## 3. Stage map

| Stage | Milestone | Content | Status |
|---|---|---|---|
| 0 | — | commit web/stitch streams, this file, push | done when this file is committed |
| 1 | hardening | verifier semantics, Polyglot zobrist, RFC 8785, DB fixes, CI | pending |
| 2 | M2 remainder | Syzygy probing, `at_least_draw` fortress certs, ~10 seeds | pending |
| 3 | M3 remainder | `services/analysis`: UCI orchestration, fog pipeline | pending |
| 4 | M4 | Lichess import, PGN extraction, game analysis, truth labeling | pending |
| 5 | M6 (API part, pulled early) | `apps/api` Fastify public v1 + BFF + ledger writer | pending |
| 6 | M5 remainder | wire web to live data, journey page, assets, smoke tests | pending |
| 7 | M6 (launch part) | license split, crates.io, releases, deploy, methodology final | pending |

Stage 5 (API) deliberately runs **before** Stage 6 (web wiring): the web pages need endpoints to
call. Fog calibration stays the **placeholder CDF labeled provisional** through launch (user
decision 2026-07-08); the real 100k-corpus run is post-launch (see Deferred).

---

## Stage 1 — Hardening

**Goal:** everything later stages build on — zobrist identity, verifier semantics, canonical
hashing, DB shape, CI — is actually trustworthy. Five independent sub-streams, done in this
order, one commit series each.

**Non-goals:** no new features, no Syzygy, no engines, no API.

**Preconditions:** Stage 0 complete (clean tree, pushed); `cargo test --workspace` 10/10;
`pnpm build` green.

### 1.1 Verifier semantic pass (`rust/verifier`)

Today `CertificateVerifier::verify()` is structural-only: it never replays moves, never checks
AND coverage, never reads `terminal.type`. The error variants `IllegalMove`,
`IncompleteCoverage`, `TablebaseError`, `HashMismatch` in `src/error.rs` exist but are never
constructed. shakmaty 0.26 is already a declared dep (currently unused). Fix all of that.

**Tasks:**

- [x] Add `src/semantic.rs` with the replay pass, and extend the public API in `src/verifier.rs`:

  ```rust
  pub struct VerifyOptions {
      pub semantic: bool,           // default true
      pub tb: TablebasePolicy,      // default Forbid
  }
  #[derive(Default)]
  pub enum TablebasePolicy { #[default] Forbid, Assume }  // Stage 2 adds Syzygy(PathBuf)

  impl CertificateVerifier {
      pub fn verify(&self) -> Result<VerifyReport, VerifyError>;      // = verify_with(&VerifyOptions::default())
      pub fn verify_with(&self, opts: &VerifyOptions) -> Result<VerifyReport, VerifyError>;
  }
  ```

  `VerifyReport` gains `pub semantic: bool` and `pub assumed_probes: usize`.

- [x] Semantic pass algorithm (runs only after structural checks pass and only if
  `opts.semantic`). All findings append to `report.errors` (same accumulate-don't-abort style
  as the structural pass):
  1. Parse `claim.fen` with shakmaty. Compute its zobrist; must equal `claim.zobrist`
     (else error `"claim zobrist mismatch: expected {computed}, found {declared}"`).
  2. Iterative DFS from `root_id` carrying: the replayed `Chess` position, the set of node ids
     on the **current path** (for transposition checks), and the halfmove clock. Per node:
     - `node.zobrist` must equal the replayed position's hash; `node.to_move` must match
       `pos.turn()` (`"white"`/`"black"`).
     - Kind sanity: `or-node` ⇔ claiming side to move; `and-node` ⇔ opponent to move.
     - Every `moves[].uci`: parse via `UciMove::from_ascii`, convert via `uci.to_move(&pos)` —
       failure is an `IllegalMove`-style error naming node id + uci. Child position =
       `pos.clone().play(&mv)`.
     - **AND-node coverage:** the set of listed UCIs must equal the set of ALL legal moves
       (`pos.legal_moves()`, each `to_uci(CastlingMode::Standard).to_string()`). A missing legal
       move is an `IncompleteCoverage`-style error naming it; an extra/unknown move is an error too.
     - Terminal `checkmate`: `pos.is_checkmate()` must be true, and the side to move (the mated
       side) must be the opponent of `claim.side`.
     - Terminal `stalemate`: `pos.is_stalemate()` must be true; **invalid inside a `win` cert**
       (stalemate is a draw — it can't prove a win); valid for `at_least_draw`.
     - Terminal `tablebase`: under `TablebasePolicy::Forbid` (default) → error
       `"tablebase terminal at {id} but no tablebase source configured"`; under `Assume`
       (CLI `--assume-tb`) → count in `report.assumed_probes`, no error. (Stage 2 replaces this
       with real probing.)
     - Terminal `transposition`: allowed **only** when `claim.value == "at_least_draw"`; valid
       iff its `zobrist` equals the zobrist of a node on the **current DFS path** (an ancestor).
     - Track the halfmove clock along the path (reset on pawn move/capture, else +1). In a
       `win` cert, hitting 100 before a terminal is an error (50-move rule breaks the mate
       claim). Real prover certs are short mates — this passes trivially; it guards fakes.
     - Memoize fully-verified node ids: on re-encountering a verified node **not** on the current
       path (DAG sharing), skip re-verification. Re-encountering a node **on** the current path
       (a cycle) is fine for `at_least_draw` (stop descending — confinement cycle); for `win`
       certs `check_acyclic` already rejected it.
- [x] Copy the two real prover certs as semantic golden fixtures (data copy is allowed):
  `rust/prover/examples/back_rank_mate_in_1.pnbcert` → `rust/verifier/tests/golden/backrank_mate_in_1.json`,
  `rust/prover/examples/morphy_mate_in_2.pnbcert` → `rust/verifier/tests/golden/morphy_mate_in_2.json`.
- [x] Add mutation fixtures (hand-edit copies of the morphy cert; each must fail semantically
  with the named error while still passing structural checks):
  - `tests/mutations/illegal_uci.json` — one AND-node reply's `uci` changed to a legal-format
    but illegal move (e.g. `a7a5` where that pawn is pinned/absent).
  - `tests/mutations/missing_and_branch.json` — delete one reply (and its subtree) from the
    16-node morphy cert's AND node → `IncompleteCoverage`.
  - `tests/mutations/wrong_node_zobrist.json` — corrupt one node's zobrist hex.
  - `tests/mutations/fake_checkmate_terminal.json` — a terminal claiming checkmate on a
    non-mate position.
- [x] Update `tests/verify_certificates.rs`:
  - Rename `golden_kqpk_verifies_clean` → `golden_kqpk_passes_structural_checks`; call
    `verify_with(&VerifyOptions { semantic: false, ..Default::default() })`; keep the exact
    assertions (valid, 9 nodes, 7 terminals, `"win white"`).
  - Add `golden_kqpk_fails_semantic_checks`: default `verify()` must report invalid — the kqpk
    fixture has hand-faked zobrists/moves; it was never a real proof. **This is the honest
    outcome, not a regression.** (Fixture file untouched — invariant 1.1.4 holds.)
  - Add semantic golden tests for the two real certs (valid under default `verify()`).
  - Add one mutation test per new fixture, asserting invalid + error-message substring.
  - Keep the existing two mutation tests and the format-version test as-is.
- [x] CLI (`src/main.rs`): add `--structural-only` and `--assume-tb` flags to `verify`; print
  which mode ran and `assumed_probes` when nonzero. `--syzygy`/`--tb-endpoint`/`--offline`
  remain parsed-but-inert until Stage 2 (leave the TODO comment pointing at Stage 2).
- [x] Delete the dead `pub const FORMAT_VERSION: &str = "0.1.0"` from `src/lib.rs` (wrong value,
  never read) — or fix to `"0.1"` and use it in `load_from_json`'s check. Pick the second.
  (Fixed to `"0.1"` and wired into the format-version check.)
- [x] Add `dtm: Option<i32>` (serde `skip_serializing_if = "Option::is_none"`, `default`) to
  `CertificateTerminal` — the spec and `schema.json` already define it; the struct just lags.
- [x] Fix the 10 pre-existing clippy warnings in the verifier (`map_or` → `is_some_and`,
  `nth(0)` → `next()`, manual range → `RangeInclusive::contains`) — this stream owns that
  cleanup now. (Also fixed a redundant-closure warning and kept the new semantic-pass code
  itself clippy-clean via a `SemanticCtx` bundling struct instead of long argument lists.)

**The prover's 6 round-trip tests must stay green unchanged** — they call default `verify()`
on real certs and are the strongest regression gate for this work.

**Acceptance gate:**

```powershell
cargo test --workspace                      # all green: prover 6/6 + verifier (4 old + ~8 new)
cargo clippy --workspace --all-targets      # zero warnings
./target/debug/penumbra-verify.exe verify rust/prover/examples/morphy_mate_in_2.pnbcert
# → Valid: true (semantic mode)
./target/debug/penumbra-verify.exe verify rust/verifier/tests/golden/kqpk.json
# → Valid: false, exit code 1 (semantic failures listed)
./target/debug/penumbra-verify.exe verify rust/verifier/tests/golden/kqpk.json --structural-only
# → Valid: true
```

**If it fails:** shakmaty replay panics on a fixture FEN → the fixture is malformed; treat as a
semantic error (return, don't panic — wrap position setup in a Result). Coverage check flags
castling/promotion edge moves → check UCI formatting (`e1g1` for castling under
`CastlingMode::Standard`, promotion suffix like `e7e8q`) matches `to_uci` output exactly —
compare strings, not parsed moves.

**Commit plan:** `add semantic verification pass to penumbra-verify` (pass + fixtures + tests +
CLI flags), `fix clippy lints and dead format version const in verifier`.

### 1.2 True Polyglot Zobrist in TS (`packages/core`)

`packages/core/src/zobrist/index.ts` currently uses a homegrown LCG — it is NOT Polyglot despite
docs claiming so, and its hashes will never match the Rust side (shakmaty emits real
Polyglot-compatible hashes into every certificate). Every future DB row keys on zobrist. Fix
before anything writes to the DB.

**Tasks:**

- [x] Create `packages/core/src/zobrist/polyglot-random.ts`: the canonical 781-entry Polyglot
  `Random64` table as `const POLYGLOT_RANDOM: readonly bigint[]`. **Source the numbers, do not
  invent them.** Best source (offline, matches the committed reference): the local cargo
  registry copy of shakmaty —
  `~/.cargo/registry/src/index.crates.io-*/shakmaty-0.26.0/src/zobrist.rs` — extract the
  constant table with a throwaway script. Alternative: the Polyglot book-format page
  (`http://hgm.nubati.net/book_format.html`). Sanity-check: exactly 781 entries; entry 0 is
  `0x9D39247E33776D41`.
  (Done via a one-off Node script reading `PIECE_MASKS`/`CASTLING_RIGHT_MASKS`/
  `EN_PASSANT_FILE_MASKS`/`WHITE_TURN_MASK` directly out of shakmaty's `zobrist.rs` — those are
  u128 values whose low 64 bits are exactly the classic Polyglot Random64 array, confirmed by
  matching `PIECE_MASKS[0]`'s low 64 bits against the well-known `0x9d39247e33776d41` and by
  the script independently recomputing the startpos hash `0x463b96181691fc9c` from the
  extracted table before ever writing the TS file.)
- [x] Rewrite `computeZobristHash(fen: string): bigint` in `src/zobrist/index.ts` per Polyglot:
  - Piece-square: `kind = 2 * roleIndex + (isWhite ? 1 : 0)` with roles
    pawn=0 knight=1 bishop=2 rook=3 queen=4 king=5 (so black pawn=0, white pawn=1, …,
    white king=11); XOR `POLYGLOT_RANDOM[64 * kind + 8 * rankIndex + fileIndex]` for every piece
    (rank index 0 = rank 1, file index 0 = a-file).
  - Castling: offsets 768 (white K-side), 769 (white Q-side), 770 (black k-side),
    771 (black q-side) — XOR one entry per remaining right.
  - En passant: offset `772 + epFile`, XORed **only when an en-passant capture is actually
    legal** — construct the position via chessops (`Chess.fromSetup`) and check a legal pawn
    capture onto the ep square exists. This matches shakmaty `EnPassantMode::Legal` (the
    committed reference), which is *stricter* than classic Polyglot's adjacent-pawn rule —
    they diverge only in rare pinned-ep cases. Document this choice in a comment.
  - Turn: XOR offset 780 when **white** to move.
  - Keep the exported signatures `computeZobristHash`, `zobristToHexString`,
    `zobristFromHexString` unchanged; delete the LCG and `ZOBRIST_SIDE`.
- [x] Tests `packages/core/src/zobrist/zobrist.test.ts` — derive positions by **playing move
  sequences from the start position with chessops** (don't hand-write FENs), then assert the
  classic Polyglot spec hashes.
  **Deviation from the original plan, logged here and in the Decision log:** rather than
  transcribing a hardcoded table from memory, vectors were generated empirically with a
  temporary Rust test harness (`shakmaty` playing the same move sequences and printing FEN +
  hash), then deleted once the fixture was written — this removes any risk of a
  misremembered constant. One row (`a2a4 b7b5 h2h4 b5b4 c2c4` → `0x3c8123ea7b067637`) matched
  the originally-drafted value exactly, cross-confirming it; the ep-capturable row uses a
  different move order (`e4 a6 e5 f5`, giving White an immediate `exf6 e.p.`) than originally
  sketched, chosen because it's a cleaner capturable-ep example than continuing the
  `e2e4 d7d5 e4e5 f7f5` line. The fixture (below) is the actual source of truth; this bullet's
  original table is superseded by it.
- [x] Cross-impl fixture `packages/core/test-fixtures/zobrist-vectors.json`:
  `[{ "label", "fen", "zobrist_hex" }]`, 16 entries — startpos, plain development moves, an
  uncapturable ep square (`e4 d5`), a capturable ep square (`e4 a6 e5 f5`) and its immediate
  continuations (king move losing castling rights, a played en passant capture, a partial
  castling-rights loss via rook move), **two genuinely pinned-en-passant positions** (found by
  probing candidate FENs with shakmaty's `legal_ep_square()` until one returned `None` despite
  a pseudo-legal ep square being present), and the three committed prover example FENs.
  Generated with a temporary `rust/verifier/tests/_scratch_zobrist_gen.rs` (shakmaty is the
  source of truth), never committed. Consumed by:
  - TS side: `zobrist.test.ts` loads the fixture and asserts every entry, plus a
    startpos-constant test, an ep-affects-hash / ep-does-not-affect-hash pair, and a hex
    round-trip test.
  - Rust side: `rust/verifier/tests/zobrist_vectors.rs` loads the same file (relative path
    `../../packages/core/test-fixtures/zobrist-vectors.json`) and asserts shakmaty agrees.
  One fixture, two independent consumers — drift fails both CI sides.
- [x] Fix `normalizeEPD` in `packages/core/src/epd/index.ts`: the ep field survives
  normalization **only when a legal ep capture exists** (reuse the same chessops helper,
  factored out as `packages/core/src/internal/ep-legality.ts` since both `zobrist/index.ts` and
  `epd/index.ts` need the identical gate); otherwise emit `-`. Added `epd.test.ts` (ep kept
  when capturable, dropped when not, dropped when pinned, passthrough when absent) plus
  `parseFenToEPD`/`fenToEPD`/`getPieceCount` coverage. This makes the docs' "ep legality
  enforced" claim true. **Bonus fix caught by the new `getPieceCount` test:** the function
  never stripped the FEN placement field's `/` rank separators, over-counting every position by
  7 (e.g. startpos returned 39, not 32) — fixed in the same pass since it's a one-line,
  currently-uncalled-elsewhere function directly adjacent to this work.
- [x] `packages/core` had no test runner wired to real files yet. The package's existing
  `"test": "node --test dist/**/*.test.js"` script (already present, matching
  `cert-schema`/`fog`) is the established convention — used that instead of adding vitest, to
  avoid introducing a second test-running tool into the monorepo. Added `@types/node ^20.0.0`
  as a devDependency (needed for `node:test`/`node:assert`/`node:fs` typings; already used by
  `cert-schema` and `apps/web`).

**Acceptance gate:**

```powershell
pnpm --filter @penumbra/core run build && pnpm --filter @penumbra/core run test   # 12/12 green
cargo test -p penumbra-verify              # incl. zobrist_vectors.rs against the same fixture
```

**If it fails:** a single vector mismatch usually means piece-kind ordering (black-first
interleave) or ep gating — check kind encoding first (white = +1, not +0). Wholesale mismatch
means the Random64 table is wrong/shifted — re-extract. If shakmaty and the spec table disagree
on the two ep rows, shakmaty (Legal mode) wins; note it in the Decision log.

**Note for the commit body:** no live DB has ever been populated (migration never applied), so
changing TS-side hashes migrates nothing.

**Commit plan:** `implement polyglot zobrist hashing with cross-impl vectors`,
`enforce ep legality in epd normalization`.

### 1.3 Canonical JSON / RFC 8785 (`packages/cert-schema` + verifier hash)

`packages/cert-schema/src/jcs.ts` is a simplified key-sort, not real RFC 8785 (docs claim
RFC 8785). The Rust verifier computes no hash at all, yet cert identity is defined as
`SHA256(canonical_json)`.

**Tasks:**

- [x] Add npm dep `canonicalize@^3.0.0` to `packages/cert-schema` (latest on the registry at
  implementation time was 3.0.0, not the originally-guessed 2.0.0 — the `erdtman/canonicalize`
  package, a well-known RFC 8785 reference implementation); `canonicalizeJSON(obj)` delegates
  to it (exported signature, and `computeCertificateSHA256`/`verifyCertificateIntegrity`/
  `parseHexHash` signatures, all unchanged).
- [x] Add `rust/verifier/src/hash.rs`:
  `pub fn certificate_sha256(raw_json: &str) -> Result<String, VerifyError>` — parses into
  `serde_json::Value`, walks it and **rejects any float or non-ASCII string** with a clear error
  (v0.1 value-domain guard), re-serializes with `serde_json::to_string` (confirmed by reading
  serde_json 1.0.150's own source: `Value`'s object type is a `BTreeMap` unless the
  `preserve_order` feature is enabled, which nothing in this workspace's dependency tree turns
  on — no `indexmap` anywhere in `Cargo.lock` — so re-serialization is key-sorted, minimal
  separators, byte-identical to JCS under the ASCII+integer restriction), sha256 (the `sha2`
  dep was already declared and unused), returns `"0x" + 64 lowercase hex`.
- [x] Wired into the CLI: `verify` and `inspect` both print `SHA256: 0x…`; `VerifyReport` gained
  `pub sha256: String` (computed once per `verify_with` call from a new `raw_json` field stored
  on `CertificateVerifier` at load time; a value-domain violation is pushed into `report.errors`
  rather than aborting, consistent with the accumulate-don't-abort style everywhere else in
  `verify_with` — an uncanonicalizable certificate has no well-defined identity, so it's invalid).
- [x] Cross-impl fixture `packages/cert-schema/test-fixtures/hash-vectors.json`:
  `[{ "file": "<repo-relative cert path>", "sha256": "0x..." }]` for **all three** committed
  prover example certs. Asserted by a TS test (`src/jcs.test.ts`, using the package's existing
  `node --test` convention rather than adding vitest — see the 1.2 note on why) and a Rust test
  (`rust/verifier/tests/hash_vectors.rs`). Expected values generated with the Rust CLI first
  (`penumbra-verify inspect <cert>`), then confirmed identical from a throwaway Node script
  calling the TS implementation directly before either test file was written.
- [x] Documented the restriction in `docs/CERTIFICATE_FORMAT.md` under "Identity & integrity":
  v0.1's ASCII-string-and-integer-only value domain, why it lets two independent canonicalizers
  agree without either needing full RFC 8785 number formatting, and which file implements each
  side.

**Acceptance gate:**

```powershell
pnpm --filter @penumbra/cert-schema run build && pnpm --filter @penumbra/cert-schema run test   # 6/6 green
cargo test -p penumbra-verify              # incl. hash_vectors.rs, 15/15 green
./target/debug/penumbra-verify.exe verify rust/prover/examples/morphy_mate_in_2.pnbcert
# → prints SHA256: 0xcc2ad24351c66918ddebfb1a8a63c815d1f81c5d9e3a781b53060abe4dd59c48
#   (same value the TS test asserts from the fixture)
```

**If it fails:** byte differences are almost always number formatting or key order — dump both
canonical strings to files and `git diff --no-index` them. Remember Rust must serialize from
the *parsed* Value (not the raw input) so whitespace differences vanish.

**Commit plan:** `adopt rfc 8785 canonicalization and report certificate hashes`.

### 1.4 DB schema fixes (`packages/db`)

Every FK-ish column is `bigserial` (each silently creates its own sequence + default!) and no
real FK constraints exist. Append-only enforcement is missing. Migration 0000 was **never
applied to any live database** (verified 2026-07-08), so regenerating it wholesale is safe —
say so in the commit body.

**Tasks:**

- [ ] In `packages/db/src/schema.ts`, change to `bigint('col_name', { mode: 'number' })` with
  `.references(() => table.id)`:
  `positions.first_seen_game_id → games.id` (nullable),
  `games.imported_by_user_id → users.id` (nullable),
  `game_positions.game_id → games.id` (notNull), `game_positions.position_id → positions.id`
  (notNull), `evals.position_id` (notNull), `fog_scores.position_id` (notNull),
  `tb_probes.position_id` (notNull), `proofs.position_id` (notNull),
  `ledger_entries.proof_id → proofs.id` (nullable), `analyses.game_id → games.id` (notNull),
  `api_keys.user_id → users.id` (notNull).
  Watch declaration order for forward references (`positions` ↔ `games` are mutually
  referential — use the drizzle callback form `references(() => games.id)` which tolerates it;
  if TS circularity bites, type the column builder explicitly with
  `AnyPgColumn` as drizzle docs prescribe).
- [ ] `evals.nodes`: `integer` → `bigint({ mode: 'number' })` (future ladder rungs exceed int4).
- [ ] Delete `packages/db/migrations/` entirely; run `pnpm run db:generate` from the repo root
  to emit a fresh `0000_*`.
- [ ] Add a custom migration for append-only enforcement:
  `npx drizzle-kit generate --custom --name append_only_guards` (from repo root), then fill the
  generated SQL file with:

  ```sql
  CREATE OR REPLACE FUNCTION penumbra_block_mutation() RETURNS trigger AS $$
  BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END;
  $$ LANGUAGE plpgsql;
  CREATE TRIGGER evals_append_only BEFORE UPDATE OR DELETE ON evals
    FOR EACH ROW EXECUTE FUNCTION penumbra_block_mutation();
  CREATE TRIGGER fog_scores_append_only BEFORE UPDATE OR DELETE ON fog_scores
    FOR EACH ROW EXECUTE FUNCTION penumbra_block_mutation();
  CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION penumbra_block_mutation();
  ```

- [ ] Add `scripts/db-smoke.mjs` (repo root `scripts/`): connects via `DATABASE_URL` (default
  `postgresql://penumbra:penumbra@localhost:5432/penumbra`), inserts a user→game→position→eval
  chain, then asserts (a) `UPDATE evals …` raises the append-only exception, (b) inserting an
  `eval` with a nonexistent `position_id` raises an FK violation, (c) cleans up nothing (the
  test rows are fine to keep in a dev DB) — print `DB SMOKE OK` on success, exit 1 otherwise.

**Acceptance gate:**

```powershell
docker-compose -f infra/docker-compose.yml up -d postgres
pnpm run db:migrate                        # both migrations apply clean to a fresh DB
node scripts/db-smoke.mjs                  # → DB SMOKE OK
pnpm build                                 # @penumbra/db still compiles
```

**If it fails:** drizzle-kit version quirks around `--custom` → check
`npx drizzle-kit generate --help` for the exact flag spelling in 0.24.x; worst case hand-create
the migration file + journal entry following the existing `meta/_journal.json` shape. If
migrate fails on a *dirty* dev DB (old 0000 partially applied), `docker-compose down -v` then
up again for a fresh volume — **only** for the local dev DB.

**Commit plan:** `fix fk columns and add append-only triggers to db schema`.

### 1.5 CI + config fixes

CI has never actually passed as written: the cargo steps use `working-directory: rust` (no
Cargo.toml there — the workspace root is the repo root), and `pnpm/action-setup@v2` pins
`version: 8`, which hard-conflicts with root `packageManager: pnpm@9.15.0`.

**Tasks:**

- [ ] `.github/workflows/ci.yml`: remove `working-directory: rust` from all three cargo steps;
  drop the `version: 8` input from `pnpm/action-setup` (it then respects `packageManager`);
  `actions/setup-node` → node 20; `Swatinem/rust-cache` `workspaces: .`.
- [ ] `packages/config/package.json`: add `@typescript-eslint/parser ^7` and
  `@typescript-eslint/eslint-plugin ^7` as dependencies (the flat config references the parser
  but never declared it — works only by hoisting luck).
- [ ] `turbo.json`: add a `clean` task (`"clean": { "cache": false }`) — the root script calls
  `turbo clean` but no such task exists.

**Acceptance gate:** after the Stage 1 push, the GitHub Actions run is green end-to-end (this
will be the first genuinely green CI). Locally: `pnpm lint && pnpm type-check && pnpm build`.

**Commit plan:** `fix ci workspace paths and eslint parser dependency`.

**Stage 1 close-out:** update `PROGRESS.md` (hardening section: what shipped, the kqpk
semantic-honesty note, zobrist migration note), tick this file's boxes, commit
`update progress notes for hardening pass`, **push** (pre-approved for stage close), verify CI
goes green on GitHub (`gh run watch` or check the Actions tab).

---

## Stage 2 — M2 remainder: fortress track (Syzygy + `at_least_draw`)

**Goal:** prover emits `at_least_draw` fortress certificates that bottom out at tablebase /
stalemate / transposition terminals; verifier probes Syzygy for real; ~10 fortress seed certs
(min 5) verified end-to-end. This completes milestone M2.

**Non-goals:** DTM sources (Syzygy has DTZ only — never emit `dtm` from it), 6/7-man local
tablebases, network TB probing in the verifier (Lichess endpoint stays deferred).

**Preconditions:** Stage 1 gate green (the semantic verifier is what makes fortress certs
meaningful).

### 2.1 Syzygy acquisition

- [ ] `scripts/fetch-syzygy.mjs`: download all 3-4-5-man WDL (`.rtbw`) + DTZ (`.rtbz`) files
  (~1 GB total, 145 files each) from `https://tablebase.lichess.ovh/tables/standard/3-4-5/`
  (fallback mirror `https://tablebase.sesse.net/syzygy/3-4-5/`) into `tablebases/syzygy/3-4-5/`.
  Idempotent (skip files that exist with the right size); writes
  `tablebases/manifest.json` (file list + sizes + fetch date); prints a summary count.
- [ ] Add `tablebases/` to `.gitignore`.

**Acceptance:** `node scripts/fetch-syzygy.mjs` twice — second run downloads nothing; directory
holds 290 files ≈ 1 GB.

### 2.2 Prover: claim modes, TB leaf oracle, transpositions (`rust/prover`)

- [ ] Add dep `shakmaty-syzygy = "0.24"` (pairs with shakmaty 0.26 — verify `cargo tree -p
  penumbra-prover | findstr shakmaty` still shows 0.26 after adding; if the resolver pulls a
  different shakmaty, pin the shakmaty-syzygy version that depends on `^0.26`, do NOT bump
  shakmaty itself).
- [ ] New `src/tb.rs`: thin oracle wrapper —

  ```rust
  pub struct TbOracle { tb: shakmaty_syzygy::Tablebase<Chess>, pub max_pieces: u32 }
  impl TbOracle {
      pub fn new(dir: &Path) -> Result<Self, ...>;        // Tablebase::new() + add_directory(dir)
      pub fn probe_wdl(&self, pos: &Chess) -> Option<Wdl>; // None if pieces > max, castling rights present, or probe error
      pub fn probe_dtz(&self, pos: &Chess) -> Option<Dtz>;
  }
  ```

  Guard: **never probe a position with castling rights** (Syzygy is castling-free; probing one
  is undefined) — return `None`.
- [ ] `src/pns.rs` — claim-mode generalization:
  - `ProofSearchConfig` gains `pub claim: ClaimValue` (`enum ClaimValue { Win, AtLeastDraw }`,
    default `Win`) and the existing `tablebase_path: Option<String>` finally gets read
    (constructs the `TbOracle` when set).
  - Terminal evaluation (claiming side's perspective), replacing the current win-only logic:
    | outcome | `Win` claim | `AtLeastDraw` claim |
    |---|---|---|
    | opponent checkmated | success | success |
    | claiming side checkmated | fail | fail |
    | stalemate / insufficient material | fail | **success** |
    | TB probe `Wdl::Win` (for claiming side) | success (with DTZ/halfmove-clock check below) | success |
    | TB `CursedWin` | **fail** (it's a draw under the 50-move rule) | success |
    | TB `Draw` | fail | success |
    | TB `BlessedLoss` | fail | success **only if** `|dtz| + halfmove_clock ≥ 100` (the 50-move save must still hold from here); else fail |
    | TB `Loss` | fail | fail |
    For a `Win`-claim TB success, apply the symmetric soundness check: require
    `|dtz| + halfmove_clock ≤ 100` is NOT the right form — require the win is achievable within
    the 50-move budget: `Wdl::Win` already encodes that under optimal play from a zeroing
    reset; to stay sound with a nonzero clock, require `|dtz| ≤ 100 - halfmove_clock`.
    **Watch the perspective sign:** shakmaty-syzygy WDL is from the side-to-move's perspective;
    convert to the claiming side (`if pos.turn() != claiming_side { flip }`). Write a unit test
    for both colors — this is the classic bug.
  - TB terminals are evaluated at leaf creation exactly like mate terminals today
    (`make_leaf` → immediate `(pn, dn)`), recording terminal type `tablebase` and `value`
    (`"win"` or `"draw"` from the claiming side's perspective). Do not emit `dtm`.
  - **Transposition table:** `HashMap<u64 /* zobrist */, NodeIndex>` across the whole search.
    On generating a child position whose zobrist already exists: reuse the existing node (DAG).
    If the existing node is an ancestor on the current path (a cycle):
    - `Win` claim: do NOT create the edge-to-ancestor; treat that move as leading to an
      unproven fresh node (keeps win certs acyclic by construction, as today).
    - `AtLeastDraw` claim: create a **terminal node** `{ kind: "terminal", terminal:
      { type: "transposition", value: "draw" } }` whose zobrist is the repeated position's —
      this is exactly the spec's fortress-cycle shape, and the Stage 1 verifier already accepts
      it (ancestor-on-path rule).
    Because nodes are deduped by zobrist, each position carries exactly one OR-move choice —
    the "positional strategy" property the verifier's transposition rule assumes. Note this in
    the module doc comment.
  - Halfmove clock: thread it through the search state (shakmaty tracks it on `Chess` via
    `pos.halfmoves()`) — needed for the DTZ soundness checks above.
- [ ] `src/certificate.rs`: `Terminal` gains `dtm: Option<i32>` (kept `None`);
  `Dependencies { tablebase: Some("syzygy".into()) }` iff the emitted tree contains ≥1
  tablebase terminal; claim `value` string comes from the config (`"win"` / `"at_least_draw"`).
- [ ] `src/main.rs`: add `--claim <win|at_least_draw>` (default `win`) and `--syzygy <DIR>`
  (sets `tablebase_path`). Exit codes unchanged.
- [ ] Round-trip tests `tests/fortress_roundtrip.rs`: Tier-A seeds (below) prove →
  serialize → `penumbra_verify` with `TablebasePolicy::Syzygy(path)` → assert valid. Guard the
  TB-dependent tests with a check that `tablebases/syzygy/3-4-5/` exists, else
  `eprintln! + return` (CI has no tablebases; the tests must skip, not fail — same pattern as
  `#[ignore]` with a runtime check).

### 2.3 Verifier: real probing (`rust/verifier`)

- [ ] Add dep `shakmaty-syzygy = "0.24"`; write the verifier's **own** `src/tb.rs` wrapper
  (copy the shape, not the code — invariant 1.1.1).
- [ ] `TablebasePolicy` gains `Syzygy(PathBuf)`. During the semantic DFS, a `tablebase`
  terminal under `Syzygy` policy: replayed position must have ≤5 pieces (or ≤ the loaded set's
  max) and no castling rights; probe WDL; the result (converted to the claiming side's
  perspective, with the same DTZ/halfmove-clock rules as 2.2) must match `terminal.value`.
  Mismatch or probe failure constructs `VerifyError::TablebaseError` text into
  `report.errors`; `report.probe_count` increments per successful probe.
- [ ] CLI: `--syzygy DIR` now actually wires `TablebasePolicy::Syzygy`. `--offline` becomes:
  error out if a tablebase terminal exists and no `--syzygy` was given (i.e., alias for
  default-Forbid, kept for spec compatibility). `--tb-endpoint` stays inert (deferred; print a
  "not implemented, use --syzygy" warning if passed).
- [ ] Mutation test: take a Tier-A fortress cert, flip a TB terminal's `value` from `draw` to
  `win` → must fail with a TablebaseError-flavored message. Same runtime-skip guard when
  tablebases are absent.
- [ ] Spec addendum in `docs/CERTIFICATE_FORMAT.md`: document the DTZ/halfmove-clock soundness
  rule for TB terminals (both claim kinds) under the Verification section.

### 2.4 Fortress seeds (~10, min 5)

**Validation protocol (mandatory, per candidate, before any prover time):** probe
`https://tablebase.lichess.ovh/standard?fen=<url-encoded FEN>` and require `category` = `draw`
(or the claim-appropriate value). Discard any candidate that disagrees; pick the next from the
family. Keep a scratch list of validated FENs before starting proofs.

- [ ] **Tier A — machinery smoke (2–3 certs; root ≤5 men or immediate terminal):**
  a KPK dead draw (defender holds the square — validate exact FEN via the endpoint), a
  wrong-bishop + rook-pawn draw (`KBP(a/h)vK`, bishop not controlling the promotion corner,
  defending king in/near the corner), and a stalemate-at-root cert.
- [ ] **Tier B — shallow trees over TB terminals (3–4 certs; 6 men):** positions one or two
  plies from liquidating into 3-4-5-man TB draws — e.g. wrong-bishop with one extra attacker
  pawn that must be traded, opposite-colored-bishop single-pawn blockades.
- [ ] **Tier C — genuine fortress cycles (3–4 certs; 6–9 men):** fully blocked pawn chains with
  shuffling kings (family: `8/8/2k5/ppp5/PPP5/2K5/8/8 w - - 0 1` — validate!, every capture
  line liquidates into 3-4-5 territory, king moves cycle via transposition terminals);
  wrong-bishop cages where the defender shuttles between two safe squares. For ≤7-men
  candidates cross-validate with the Lichess endpoint; 8+-men certs are the showcase (the PNS
  proof is the evidence, the semantic verifier the check).
- [ ] Store final certs in `rust/prover/examples/fortress/*.pnbcert` (committed). A short
  `rust/prover/examples/fortress/README.md` table: FEN, claim, node count, terminal breakdown,
  provenance (endpoint-validated / showcase).

**Acceptance gate:**

```powershell
cargo test --workspace                     # incl. fortress round-trips (skipping if no TB dir)
./target/debug/penumbra-prove.exe prove "<tier C fen>" --claim at_least_draw --syzygy tablebases/syzygy/3-4-5 -o fortress1.pnbcert
./target/debug/penumbra-verify.exe verify fortress1.pnbcert --syzygy tablebases/syzygy/3-4-5
# → Valid: true, Probes: > 0
./target/debug/penumbra-verify.exe verify fortress1.pnbcert
# → Valid: false ("tablebase terminal … no tablebase source") — soundness by default
# ≥5 committed fortress certs, each verifying clean with --syzygy
```

**If it fails:** PNS explodes on a fortress candidate (node budget exhausted) → the position's
defensive tree is too wide; prefer candidates with locked pawns (few legal moves). Probe errors
on legal-looking positions → check for castling rights in the FEN (must be `-`). WDL sign
confusion → the both-colors unit test from 2.2 is the diagnostic.

**Commit plan:** `add syzygy fetch script`, `add tablebase oracle and at_least_draw claims to
prover`, `wire syzygy probing into verifier semantic pass`, `add fortress seed certificates`,
progress/tick updates, push at stage close.

---

## Stage 3 — M3 remainder: `services/analysis` (UCI worker)

**Goal:** deterministic canonical engine evals land in Postgres; fog scores computed end-to-end
for arbitrary FENs; reproducibility proven. This is the platform's data heartbeat.

**Non-goals:** game import (Stage 4), HTTP API (Stage 5), real calibration corpus (deferred).

**Preconditions:** Stage 1 done (DB schema + zobrist must be correct **before** rows are
written). Stage 2 not strictly required, but its TB probes feed the proof gate — implement the
`tb_probes` lookup here, populate in Stage 4+.

**New workspace package** `services/analysis` → `@penumbra/analysis` (private). Deps:
`bullmq ^5`, `ioredis ^5`, `zod ^3.23`, workspace `@penumbra/{core,fog,db,cert-schema,config}`.
DevDeps: `vitest ^2`, `typescript ^5`, `@types/node ^20`. Engine subprocesses via Node's
built-in `child_process.spawn` — no extra dependency.

**File layout:**

```
services/analysis/src/
  uci/client.ts         # UciClient — spawn + line protocol
  uci/parse.ts          # parseInfoLine / parseBestMove (pure, unit-testable)
  engines/config.ts     # canonical + quick settings objects, ladders
  engines/stockfish.ts  # runStockfishLadder(fen, tier) → per-rung multipv WDL
  engines/lc0.ts        # runLc0(fen) → single deep WDL
  fingerprint.ts        # computeEngineFingerprint(settings) → '0x'+sha256
  pipeline/analyzePosition.ts  # engines → EngineEvals → computeFogIndex → DB writes
  queue/queues.ts       # 'analyze-position' (+ 'analyze-game' in Stage 4)
  queue/worker.ts       # BullMQ Worker entrypoint (canonical concurrency = 1)
  cli.ts                # analyze --fen "<fen>" [--tier quick|canonical] [--json]
  index.ts
scripts/fetch-engines.mjs
docs/ENGINES.md
```

**Tasks:**

- [ ] **`uci/client.ts`** —

  ```ts
  class UciClient {
    constructor(exePath: string, opts?: { cwd?: string })
    async init(options: Record<string, string | number | boolean>): Promise<void>
      // send 'uci' → await 'uciok'; setoption for each; 'isready' → await 'readyok'
    async goNodes(fen: string, nodes: number): Promise<UciSearchResult>
      // 'ucinewgame'; 'isready'→'readyok'; 'position fen <fen>'; 'go nodes <N>';
      // collect info lines until 'bestmove'; return last info line per multipv + bestmove
    async quit(): Promise<void>   // 'quit', then proc.kill() after 2s grace (Windows: no SIGTERM semantics)
  }
  ```

  Line-buffer stdout (split on `\n`, keep partial tails). Reject on engine exit before
  `bestmove`. Timeout guard (default 10 min/search) that kills and rejects.
- [ ] **`uci/parse.ts`** — pure parser:
  `parseInfoLine(line) → { multipv?, depth?, nodes?, scoreCp?, scoreMate?, wdl?: {w,d,l}, pv? } | null`.
  Handles `score cp -13`, `score mate 3`, `wdl 124 812 64`, `multipv 2`. Unit tests against
  **committed transcript fixtures** (`services/analysis/test-fixtures/*.txt` — capture a real
  SF and Lc0 transcript once during implementation, commit them) so CI needs no engine binary.
- [ ] **`engines/config.ts`** — the canonical contract (from `docs/FOG_INDEX_METHODOLOGY.md`):

  ```ts
  export const STOCKFISH_CANONICAL = {
    options: { Threads: 1, Hash: 256, MultiPV: 4, UCI_ShowWDL: true },
    ladder: [1_000_000, 4_000_000, 16_000_000, 64_000_000],
  };
  export const STOCKFISH_QUICK = { options: same, ladder: [100_000, 400_000, 1_600_000] };
  export const LC0_CANONICAL = { options: { MultiPV: 4 }, nodes: 30_000 };
  ```

- [ ] **`fingerprint.ts`** — exact definition (uses cert-schema's `canonicalizeJSON`):

  ```ts
  computeEngineFingerprint({
    formulaVersion: '0.1',
    stockfish: { version, nnue, options: {...}, ladder: [...] },
    lc0: { version, network, options: {...}, nodes, backend },
  }) => '0x' + sha256(canonicalizeJSON(settings))    // 66 chars, fits evals.engine_fingerprint varchar(66)
  ```

  The quick tier gets its **own honest fingerprint** (different ladder ⇒ different fingerprint
  ⇒ separate `fog_scores` rows). Never label quick output with the canonical fingerprint.
- [ ] **`scripts/fetch-engines.mjs`** — downloads pinned engine builds into gitignored
  `engines/` (add to `.gitignore`): a Stockfish release win-x86-64-avx2 zip and a matching
  Lc0 CUDA build + one pinned network file. **Pin at implementation time:** pick the latest
  stable release of each, record exact version, URL, and sha256 in `docs/ENGINES.md` (a table:
  component / version / URL / sha256 / date). The script verifies sha256 after download and is
  idempotent. Lc0 needs its CUDA DLLs from the release zip; the RTX 4060 + driver already
  present suffice.
- [ ] **`engines/stockfish.ts` / `engines/lc0.ts`** — produce exactly the shape
  `packages/fog` needs (`EngineEvals` in `packages/fog/src/formula.ts`):
  `stockfishWdl: [{nodes, wins, draws, losses}, …]` (one entry per rung, ladder order, rung-4
  multipv-1 WDL per rung) and `lc0Wdl: [{…}]` (single deep entry). Also return the rung-4
  multipv array so the pipeline computes `k` = count of moves within 0.06 win-prob of best
  (`winProbability` from `@penumbra/fog`) → `FogComputeOptions.moveMultiPV`.
  **WDL perspective:** UCI `wdl` is from the side to move. Normalize to the **claiming/white
  perspective consistently** — pick white-perspective storage, document in ENGINES.md, and
  normalize in exactly one place (the engine adapters), with a unit test.
  **Lc0 WDL:** confirm the pinned build emits `wdl` per multipv (needs
  `UCI_ShowWDL`-equivalent? Lc0 emits WDL natively when `--show-wdl`/option enabled — check
  `lc0 --help` at pin time and record in ENGINES.md; fallback: convert `score cp` via Lc0's
  documented cp↔winprob mapping and note it).
- [ ] **`pipeline/analyzePosition.ts`** —
  1. `normalizeEPD(fen)` + `computeZobristHash` (`@penumbra/core`); upsert into `positions`
     (`ON CONFLICT (epd) DO NOTHING`, then select id).
  2. Run engines per tier; write **one `evals` row per engine × rung × multipv rank**
     (append-only insert; include `settings` JSON + fingerprint).
  3. Proof gate inputs: `hasProof` = `proofs` row exists for the position OR piece count ≤ 7
     with a cached `tb_probes` hit; `hasChildProof` analogous for any child position already
     known proven (v1: check `proofs`/`tb_probes` for direct children only when piece count ≤ 8;
     document the scope).
  4. `computeFogIndex(evals, options)` → set `engineFingerprint` (the formula leaves it '' for
     the caller — that's this call site); percentile via `getCalibration('0.1')` (placeholder,
     labeled provisional downstream).
  5. Insert `fog_scores` with `ON CONFLICT DO NOTHING` on the unique
     (position_id, formula_version, engine_fingerprint) index — re-analysis with an identical
     fingerprint is a no-op, preserving append-only semantics.
- [ ] **`queue/worker.ts`** — BullMQ worker for `analyze-position`
  (`jobId = epd + ':' + fingerprint` for idempotent dedupe), canonical queue concurrency **1**
  (determinism + the 64M rung is CPU-saturating), quick queue concurrency 2. Graceful
  shutdown kills engine children (`proc.kill()`; Windows has no POSIX signals).
- [ ] **`cli.ts`** — `pnpm --filter @penumbra/analysis run analyze -- --fen "<fen>" --tier
  quick --json`: runs the pipeline inline (no queue), prints the fog JSON.
- [ ] **`repro-test` script** (package.json script): runs the **quick** ladder twice on 3 fixed
  FENs, asserts the two canonical-JSON outputs are byte-identical. Canonical-tier repro
  (2 × ~90 s/position) is a manual script (`repro-test:canonical`), run once and record the
  result in ENGINES.md. **If Lc0 flakes** (GPU nondeterminism): pin `--backend=cuda-fp32`; if
  still flaky, fall back to a CPU backend (`blas`/`eigen` — 30k nodes is CPU-feasible) — record
  whichever backend wins in ENGINES.md and bake it into the fingerprint.

**Acceptance gate:**

```powershell
pnpm --filter @penumbra/analysis test          # parser + perspective + fingerprint units (no engines needed)
node scripts/fetch-engines.mjs                 # engines + net in engines/, hashes verified
docker-compose -f infra/docker-compose.yml up -d
pnpm --filter @penumbra/analysis run analyze -- --fen "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" --tier quick --json
# → fog JSON printed; evals rows + 1 fog_scores row in Postgres
pnpm --filter @penumbra/analysis run repro-test   # → REPRO OK (byte-identical)
```

**If it fails:** engine hangs at init → an unsupported `setoption` name (SF renamed options
across versions — check `uci` output listing); WDL missing from SF info lines →
`UCI_ShowWDL` not applied before `isready`; nondeterminism → check Threads=1 actually set and
no other CPU-heavy process ran concurrently (fixed-node search is timing-independent, so real
nondeterminism means a settings leak).

**Commit plan:** `add engine fetch script and pin table`, `add uci client and parsers with
transcript fixtures`, `add canonical analysis pipeline with fog persistence`,
`add analysis worker queue and repro test`, progress/ticks, push.

---

## Stage 4 — M4: game import + analysis

**Goal:** a Lichess username (or exported PGN) → games in the DB, every position extracted and
keyed, fog timeline computed per game, proof-entry detected, truth labeled.

**Preconditions:** Stage 3 gate green (the pipeline is what analysis jobs call).

**All code lives in `services/analysis`** (`src/import/…`, `src/pipeline/analyzeGame.ts`).

**Tasks:**

- [ ] **`src/import/lichess.ts`** — public export API (no OAuth for public games):
  `GET https://lichess.org/api/games/user/{username}?max={n}&moves=true&pgnInJson=true` with
  header `Accept: application/x-ndjson`; stream-parse NDJSON lines → `{id, players, winner,
  pgn, variant, speed, createdAt}`. **Skip non-standard variants** (`variant !== 'standard'` —
  rules:"standard" invariant). Single concurrent request, and throttle politely (Lichess
  etiquette: one stream at a time, no hammering). Single game:
  `GET https://lichess.org/game/export/{id}?pgnInJson=true`.
- [ ] **`src/import/pgn.ts`** — chessops-based extraction (chessops 0.15 API, verified:
  `parsePgn` from `chessops/pgn`, `startingPosition(game.headers)`, `game.moves.mainline()`,
  `parseSan` from `chessops/san`, `makeUci` from `chessops/util`):
  `extractPositions(pgn: string) → { ply, fen, epd, zobristHex, pieceCount, uci, san }[]`
  — entry per position **after** each ply, plus ply-0 startpos entry. Convention (document in
  the module docstring, reuse everywhere): **ply 0 = the position before White's first move;
  entry N holds the position after ply N and the move that produced it.**
- [ ] **`src/import/persist.ts`** —
  `upsertGame` (unique on (source, source_game_id) — `ON CONFLICT DO NOTHING` + select),
  `upsertPositions`: `INSERT … ON CONFLICT (epd) DO UPDATE SET occurrence_count =
  positions.occurrence_count + 1` (positions is a counter table, not append-only);
  `first_seen_game_id` set only on first insert; bulk-insert `game_positions` rows.
- [ ] **`src/pipeline/analyzeGame.ts`** — create `analyses` row (`tier`, `status: 'queued'`);
  enqueue per-position jobs (quick tier default; deep = canonical enqueued with low priority);
  when all positions of a game are scored, assemble the **fog timeline** and update the row
  (`status: 'done'`, `completed_at`):

  ```json
  [{ "ply": 1, "positionId": 123, "san": "e4", "fog": 45, "percentile": 52.3,
     "status": "EVALUATED", "fingerprint": "0x…" }, …]
  ```

- [ ] **Truth labeling helper** (put in `packages/db/src/truth.ts`, exported — web/API/worker
  must not disagree): `deriveTruthStatus({ positionId, pieceCount }) → 'PROVEN' | 'EVALUATED'`
  — PROVEN iff a `proofs` row exists for the position, or piece count ≤ 7 **and** a `tb_probes`
  row exists (probe cache; populate via the Lichess TB endpoint
  `https://tablebase.lichess.ovh/standard?fen=…` for 6–7 men, local Syzygy for ≤5 when
  available — cache every probe in `tb_probes`).
- [ ] **Proof-entry detection:** `analyses.proof_entry_ply` = first ply whose position is
  PROVEN by the helper above. `missed_proofs` v1 scope (document it): for positions with
  piece count ≤ 8, check whether any legal move leads to a child position that is already
  PROVEN with a win for the mover while the played move's result position is not — collect
  `{ ply, uci }` entries; anything deeper is out of scope until Phase 2.
- [ ] **CLI additions:** `run import -- --user <name> --max 5`,
  `run import -- --pgn <file>`, `run analyze-game -- --game-id <id> --tier quick`.
- [ ] **Unit tests** (no network): PGN fixture with castling + promotion + en passant +
  a known ply count; an NDJSON fixture file parsed by the lichess module; proof-entry detection
  on a synthetic endgame PGN reaching a ≤5-man position (mock the TB probe).

**Acceptance gate (M4 checklist item):**

```powershell
pnpm --filter @penumbra/analysis run import -- --user <any real lichess username> --max 5
pnpm --filter @penumbra/analysis run analyze-game -- --game-id 1 --tier quick
# DB spot-checks (psql or drizzle studio):
#   games: 5 rows; positions: >0, no EPD duplicates; game_positions: full ply chains;
#   analyses: status='done', fog_timeline non-empty JSON;
#   proof_entry_ply set for any game that reached ≤7 men
```

**If it fails:** NDJSON lines with missing `pgn` → request forgot `pgnInJson=true`; chessops
`parseSan` returns undefined mid-game → the game is a variant or has an illegal-SAN annotation;
skip the game with a logged warning, never crash the batch.

**Commit plan:** `add lichess import and pgn position extraction`,
`add game analysis pipeline with fog timeline and proof entry detection`,
`add truth status helper`, progress/ticks, push.

---

## Stage 5 — M6 (API half, pulled early): `apps/api`

**Goal:** the public v1 API + BFF endpoints the web app needs, plus the proof ledger writer.
Runs before web wiring because Stage 6 consumes it.

**Preconditions:** Stages 3–4 green (there must be data to serve).

**New workspace package** `apps/api` → `@penumbra/api` (private). Deps: `fastify ^5`,
`@fastify/cors ^10`, `@fastify/rate-limit ^10`, `zod ^3.23`, `fastify-type-provider-zod ^4`,
`bullmq ^5`, `ioredis ^5`, workspace `@penumbra/{db,core,fog,cert-schema,config}`.

**Routes (from `docs/DEVELOPMENT.md` §APIs — keep the shapes it documents):**

| route | behavior |
|---|---|
| `GET /v1/fog?fen=` | normalize FEN→EPD→zobrist; latest canonical `fog_scores` hit → 200 `{score, components, percentile, percentile_provisional: true, status, fingerprint}`; miss → enqueue `analyze-position` (idempotent jobId) → `202 {status:"pending", retry_after_ms: 5000}` |
| `POST /v1/fog/batch` | array ≤100 FENs, same per-item semantics |
| `GET /v1/positions/{zobrist}` | position + provenance + eval history + fog + proof refs + truth status |
| `GET /v1/proofs` / `GET /v1/proofs/{id}` | list/detail from `proofs`, incl. `certificate_sha256` + download URL (minio object key) |
| `GET /v1/ledger?since_seq=` | hash-chained entries, ascending |
| `GET /v1/meta/methodology` | formula version, weights, canonical fingerprints, engine pin table, `calibration: { corpus: "provisional-placeholder", … }` |
| `GET /bff/stats` | counts for the home page (positions, proofs, ledger height, median fog) |
| `GET /bff/frontier` | aggregates by piece-count band for the frontier map |
| `POST /bff/import` | `{username}` → triggers Stage-4 import, returns job/game ids |

**Tasks:**

- [ ] `src/server.ts` (build + listen :3001, zod type provider, CORS for `localhost:3000`),
  `src/schemas.ts` (zod for every request/response — the response schemas are the API contract,
  keep them in one file).
- [ ] `src/plugins/auth.ts`: `X-API-Key` → sha256 → `api_keys` lookup (`key_hash`); anonymous
  requests allowed on GET routes with the per-IP limiter. Key format `pnb_` + 32 random bytes
  hex; store only the sha256.
- [ ] `src/plugins/rateLimit.ts`: `@fastify/rate-limit` with redis store — per-key
  `api_keys.rate_limit`/min when authenticated, 60/min per-IP anonymous; 429 with retry-after.
- [ ] `src/ledger.ts` — the hash chain writer (also documented as a spec addendum in
  `docs/CERTIFICATE_FORMAT.md` §Ledger):
  `entry_hash = '0x' + sha256( bytes(prev_hash_hex_decoded) || sha256(canonicalizeJSON(payload)) )`;
  genesis `prev_hash = '0x' + '00'.repeat(32)`. Single-writer: `SELECT seq FROM ledger_entries
  ORDER BY seq DESC LIMIT 1 FOR UPDATE` inside a transaction.
  `publishProof(proofRow, certJson)`: upload cert to minio bucket `proofs` (object key
  `certs/<sha256>.pnbcert`), insert `proofs` row (status `published`), append ledger entry
  `{type:"proof_published", proof_sha256, claim, epd, published_at}`.
- [ ] `scripts/publish-proofs.mjs` — publishes the committed example + fortress certs through
  `publishProof` (idempotent on `certificate_sha256` unique index).
- [ ] `scripts/verify-ledger.mjs` — walks the chain, recomputes every hash, prints
  `LEDGER OK (n entries)` or the first broken seq.
- [ ] Tests: `fastify.inject()` integration tests against docker Postgres/Redis (fog 200/202
  path with a mocked queue, positions detail, ledger chain validity, 429 rate-limit, api-key
  auth); ledger unit test with fixed payloads.

**Acceptance gate:**

```powershell
pnpm --filter @penumbra/api test
pnpm --filter @penumbra/api dev            # :3001
node scripts/publish-proofs.mjs            # fortress + mate certs into proofs + ledger + minio
curl "http://localhost:3001/v1/fog?fen=rnbqkbnr%2Fpppppppp%2F8%2F8%2F8%2F8%2FPPPPPPPP%2FRNBQKBNR%20w%20KQkq%20-%200%201"
# → 202 first, 200 with score after the worker drains
curl "http://localhost:3001/v1/proofs"     # lists published certs
node scripts/verify-ledger.mjs             # → LEDGER OK
```

**If it fails:** FEN query-string mangling → always URL-encode in clients; accept both raw FEN
and EPD. Fastify plugin version mismatches (fastify 5 needs the v10+ plugin line) → check the
compat table in each plugin's README before downgrading anything.

**Commit plan:** `scaffold fastify api with zod schemas and rate limiting`,
`add fog and positions endpoints with 202 queue pattern`,
`add proof publishing and hash chained ledger`, `add bff endpoints for web`, progress/ticks, push.

---

## Stage 6 — M5 remainder: wire the web app

**Goal:** all six pages render live data; personal game journey page; local assets; Playwright
smoke suite. The M5 checklist line — "Position page shows provenance + eval history + fog" —
goes green here.

**Preconditions:** Stage 5 running locally (API on :3001, worker running, seed data published).

**Tasks:**

- [ ] `apps/web/src/lib/api.ts` — typed fetch helpers for every consumed endpoint; base URL
  from `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`). Server components fetch
  directly; the `/board` fog-poll is client-side (202 → retry with backoff until 200).
- [ ] **Assets:** create `apps/web/public/logo.png` and `apps/web/public/avatar.png` (design a
  simple B&W pixel logo consistent with the locked design system — a dithered half-moon
  "penumbra" mark works; any locally-produced asset beats the dead Stitch hotlinks). Replace
  the two `lh3.googleusercontent.com` `<img>` srcs (in `src/app/page.tsx` and
  `src/components/stitch/TopNavBar.tsx` / board page avatar).
- [ ] Page wiring (keep layouts; swap hardcoded consts for fetched data):
  - `/` ← `GET /bff/stats` (hero numbers, real global fog gauge).
  - `/board` ← FEN input → fog poll → `FogIndexCard`; `GET /v1/positions/{zobrist}` → engine
    ladder + archaeology list (evals grouped by fingerprint, append-only history order).
  - `/positions` → becomes `/positions/[zobrist]/page.tsx` (dynamic route) ←
    `GET /v1/positions/{zobrist}`; keep a `/positions` index page (search box + recent list).
  - `/frontier` ← `GET /bff/frontier` feeding the landmark markers/counts (SVG stays).
  - `/proofs` ← `GET /v1/proofs` + `GET /v1/ledger` (real chain; download button → cert URL).
  - `/methodology` ← `GET /v1/meta/methodology` for live fingerprints/engine pins; formulas
    stay static. **Add the provisional-calibration label** wherever a percentile renders
    (methodology page + `FogIndexCard`): "Percentiles are provisional pending the 100k-corpus
    calibration."
  - **`/journey` (new):** username form → `POST /bff/import` → progress → analyzed-game list →
    per-game fog timeline (reuse the `/board` timeline component) with proof-entry markers.
    Add JOURNEY to `TopNavBar`.
- [ ] Delete dead `ScreenSlot.tsx` (no route uses it since the spec-built pages landed).
- [ ] **Playwright smoke** (`apps/web/tests/*.spec.ts` + `playwright.config.ts`, devDep
  `@playwright/test`): boots web+api against docker services; per route: renders, zero console
  errors (the ShaderBackground WebGL check pattern already proved out); one live fog round-trip
  (202→200); proofs page shows ≥1 real cert; journey imports a tiny public account (or a
  seeded fixture user when offline).
- [ ] **Design-system overflow check** (the Press Start 2P lesson): eyeball every new
  data-bearing table/grid at `data-mono` size with real data lengths (zobrist hex, SHA256
  strings are the usual offenders — truncate middle with `…` where needed).

**Acceptance gate:**

```powershell
pnpm --filter @penumbra/web exec playwright test    # all smoke specs green
pnpm build                                          # web still builds statically where expected
# Manual: /positions/<real zobrist> shows provenance + eval history + fog  ← M5 checklist line
```

**Commit plan:** `add typed api client and wire home and board pages`,
`add dynamic position route and wire proofs and frontier`, `add journey page with import flow`,
`replace stitch-hosted images with local assets`, `add playwright smoke suite`, progress/ticks,
push.

---

## Stage 7 — Launch (M6 remainder)

**Goal:** public artifacts (crates.io verifier, GitHub release binaries), production deploy,
methodology finalization. **Every task here has an ask-the-user checkpoint** (§1.3).

**Preconditions:** Stages 1–6 green; CI green.

**Tasks:**

- [ ] **License split — ASK THE USER FIRST (new finding, 2026-07-08):** `shakmaty` and
  `shakmaty-syzygy` are **GPL-3.0-or-later**, so `penumbra-verify` cannot ship Apache-2.0 while
  linking them (the docs' current claim is wrong). Recommended resolution: verifier crate →
  `license = "GPL-3.0-or-later"`; the *spec* (`docs/CERTIFICATE_FORMAT.md`) +
  `packages/cert-schema` + fog *spec* stay Apache-2.0; the app remains private/UNLICENSED.
  Auditability is fully preserved by GPL. Alternative (expensive): swap shakmaty for a
  permissive movegen crate and lose the syzygy pairing — not recommended. On approval: set
  per-crate `license` fields (workspace `license = "UNLICENSED"` must be removed — invalid
  SPDX blocks `cargo publish`), add `LICENSE` files per package, update DEVELOPMENT.md
  §Licenses, and write the referenced-but-missing `docs/gpl-compliance.md` (engine binaries as
  separate processes, source availability, verifier GPL rationale).
- [ ] **crates.io publish `penumbra-verify`:** Cargo.toml needs `description`, `repository`,
  `readme`, `license`, `keywords`, `categories`; `cargo publish --dry-run` first; then publish
  (user confirms). The prover is NOT published (its dev-dep direction is fine).
- [ ] **GitHub release:** `.github/workflows/release.yml` — on tag `verify-v0.1.0`, matrix
  build (`windows-msvc`, `linux-gnu`, `macos-arm64`) of `penumbra-verify --release`; archives
  include the binary, the two semantic golden certs, a fortress cert, and a README verification
  walkthrough (`penumbra-verify verify morphy_mate_in_2.pnbcert` → `Valid: true`).
- [ ] **Deploy — ASK THE USER (target + accounts):** docs assume Hetzner + Cloudflare + R2.
  Produce `infra/docker-compose.prod.yml` (postgres, redis, api, worker, web behind
  Caddy/nginx; minio replaced by R2 in prod) + `infra/deploy.md` runbook. Lc0 canonical jobs:
  local-CPU backend or on-demand RunPod per the Stage 3 ENGINES.md decision.
- [ ] **Methodology finalization:** `percentile_provisional: true` in every API response
  carrying a percentile (already per Stage 5), the provisional label on web (already per
  Stage 6), `docs/FOG_INDEX_METHODOLOGY.md` gets a dated "Calibration status" box stating the
  placeholder situation and the post-launch plan.
- [ ] **M6 gate (the launch checklist):**
  - `GET /v1/fog?fen=…` on prod: 202 → score.
  - `cargo install penumbra-verify` works from crates.io.
  - A stranger can download a release binary + a fortress cert + Syzygy 3-4-5 and get
    `Valid: true` offline, and `Valid: false` after flipping any byte of the cert.

**Commit plan:** `split licenses and add gpl compliance notes` (post-approval),
`prepare verifier crate for publication`, `add release workflow`,
`add production compose and deploy runbook`, progress/ticks, push, tag `verify-v0.1.0`.

---

## Decision log

- **2026-07-08 — Roadmap home:** committed `docs/ROADMAP.md` (user choice; PROGRESS.md stays
  the status ledger, HANDOFF.md becomes untracked session scratch).
- **2026-07-08 — Hardening before features** (user choice): zobrist/verifier/DB/JCS defects
  block trustworthy data; fixed first.
- **2026-07-08 — Frontend stream committed & pushed** as its own commits (user choice).
- **2026-07-08 — Calibration:** placeholder CDF ships at MVP, labeled provisional everywhere;
  real 100k corpus is a post-launch background job (user choice).
- **2026-07-08 — kqpk golden fixture:** hand-faked data can't pass a real semantic check; it
  becomes the *structural-only* fixture (file untouched) and real prover certs become the
  semantic goldens. Its semantic failure is asserted as correct behavior.
- **2026-07-08 — GPL finding:** shakmaty (+syzygy) are GPL-3.0-or-later ⇒ verifier can't be
  Apache-2.0 as docs claimed. Decision deferred to Stage 7 with a user checkpoint;
  recommendation on file: verifier GPL, spec + cert-schema Apache-2.0.
- **2026-07-08 — JCS scope:** v0.1 certs restricted to ASCII strings + integers; both
  implementations are RFC 8785-exact under that restriction (TS uses `canonicalize`, Rust uses
  sorted-Value serialization + a value-domain guard).
- **2026-07-08 — shakmaty-syzygy 0.24** pinned (pairs with shakmaty 0.26; no shakmaty bump
  mid-project).
- **2026-07-08 — EP hashing semantics:** TS Polyglot implementation matches shakmaty
  `EnPassantMode::Legal` (fully legal capture), stricter than classic Polyglot adjacency —
  divergence only in pinned-ep corners; shakmaty is the committed reference.
- **2026-07-08 — Quick tier fingerprinting:** quick-ladder evals carry their own fingerprint;
  canonical and quick rows never mix under one fingerprint.
- **2026-07-08 — Syzygy value mapping:** CursedWin/BlessedLoss are draws under standard rules;
  `win` claims require strict `Wdl::Win` + DTZ-vs-halfmove-clock check; `at_least_draw` accepts
  Win/CursedWin/Draw and BlessedLoss only with `|dtz| + hmc ≥ 100`.

## Deferred / post-launch

- **Real calibration run:** 100k Lichess-elite positions (plies 10–80) through the canonical
  ladder ≈ 90 s/position ⇒ ~104 CPU-days serial, ~9 days at 12× parallel — schedule post-launch
  (or calibrate the quick-tier fingerprint first); output = new `CalibrationData` for
  `packages/fog/src/calibration.ts` + the ~200-position QA gate from the methodology doc;
  replaces the placeholder in a minor release and drops the provisional labels.
- **Lichess OAuth (PKCE, no app registration)** — "connect account" personal import; `users`
  table is ready.
- **Verifier `--tb-endpoint`** (Lichess 6-7-man network probing) — spec'd flag, deferred.
- **Phase 2 items** (per CERTIFICATE_FORMAT.md): zstd container (`PNBC` magic), signatures /
  attestation, work-unit federation ("Fleet"), transposition-aware win certs.
- **`missed_proofs` beyond the ≤8-men v1 scope.**
- **`packages/db` seed script** (`./seed` export exists in package.json but no source).
