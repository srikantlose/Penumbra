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
| 0 | — | commit web/stitch streams, this file, push | done |
| 1 | hardening | verifier semantics, Polyglot zobrist, RFC 8785, DB fixes, CI | done |
| 2 | M2 remainder | Syzygy probing, `at_least_draw` fortress certs, ~10 seeds | done |
| 3 | M3 remainder | `services/analysis`: UCI orchestration, fog pipeline | done |
| 4 | M4 | Lichess import, PGN extraction, game analysis, truth labeling | done |
| 5 | M6 (API part, pulled early) | `apps/api` Fastify public v1 + BFF + ledger writer | done |
| 6 | M5 remainder | wire web to live data, journey page, assets, smoke tests | done |
| 7 | M6 (launch part) | license split, crates.io, releases, deploy, methodology final | in progress |

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

- [x] In `packages/db/src/schema.ts`, change to `bigint('col_name', { mode: 'number' })` with
  `.references(() => table.id)`:
  `positions.first_seen_game_id → games.id` (nullable),
  `games.imported_by_user_id → users.id` (nullable),
  `game_positions.game_id → games.id` (notNull), `game_positions.position_id → positions.id`
  (notNull), `evals.position_id` (notNull), `fog_scores.position_id` (notNull),
  `tb_probes.position_id` (notNull), `proofs.position_id` (notNull),
  `ledger_entries.proof_id → proofs.id` (nullable), `analyses.game_id → games.id` (notNull),
  `api_keys.user_id → users.id` (notNull).
  **Correction to this plan:** `positions` and `games` are *not* actually mutually
  referential — only `positions.first_seen_game_id → games.id` exists in that direction, and
  `games` has no reference back to `positions`. Tracing every FK confirmed the full dependency
  graph is a DAG (`users → games → positions → game_positions → evals/fog_scores/tb_probes/
  proofs → ledger_entries`, plus `games → analyses` and `users → api_keys`), so simply
  reordering the table declarations (users and games before positions) satisfies TypeScript
  with zero circularity — no `AnyPgColumn` workaround needed. `tsc --noEmit` confirmed clean.
- [ ] ~~`evals.nodes`: `integer` → `bigint`~~ **Deviation: skipped, reasoning was wrong.**
  Postgres `integer` is 4 bytes signed, max ≈2.147 billion — the canonical ladder tops out at
  64,000,000 nodes, nowhere near that ceiling even allowing for future rungs an order of
  magnitude higher. Left as `integer`; logged in the Decision log rather than silently dropped.
- [x] Delete `packages/db/migrations/` entirely; run `pnpm run db:generate` from the repo root
  to emit a fresh `0000_*`. (Deleted via `git rm -r` rather than `rm -rf` — same effect on
  a clean, fully-committed directory, but keeps the removal in git's reversible history.
  Regenerated as `0000_illegal_killraven.sql`; drizzle-kit's own summary confirmed the expected
  shape — 11 tables, 11 real `fk`s, all prior indexes intact.)
- [x] Add a custom migration for append-only enforcement:
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

- [x] Add `scripts/db-smoke.mjs` (repo root `scripts/`): connects via `DATABASE_URL` (default
  `postgresql://penumbra:penumbra@localhost:5432/penumbra`), inserts a user→game→position→eval
  chain, then asserts (a) `UPDATE evals …` raises the append-only exception, (b) `DELETE FROM
  evals …` also raises it (the trigger covers both), (c) inserting an `eval` with a nonexistent
  `position_id` raises an FK violation, (d) cleans up nothing (the test rows are fine to keep in
  a dev DB) — prints `DB SMOKE OK` on success, exit 1 otherwise. Added `"db:smoke"` to the root
  `package.json` scripts.
  **Dependency note:** the script needs `drizzle-orm`'s `sql` tagged-template to run raw
  UPDATE/DELETE probes; a bare `import 'drizzle-orm'` from a file physically at repo-root
  `scripts/` cannot resolve through pnpm's per-package `node_modules` isolation (Node's ESM
  resolver walks up from the *importing file's* own location, not cwd), so `drizzle-orm` was
  added as a real root `dependencies` entry. This is a one-time fix that also unblocks every
  later-stage root `scripts/*.mjs` file that needs a workspace package. `pg`/`@penumbra/db`
  itself did *not* need the same treatment — the script's only import from `@penumbra/db` is a
  relative path (`../packages/db/dist/index.js`), and that module's own bare imports resolve
  fine from *its own* location inside `packages/db/node_modules`.
  **Also required starting Docker Desktop** (it was stopped at session start, per prior
  PROGRESS.md notes) to actually run `docker-compose up -d postgres` and apply migrations to a
  real database for the first time ever in this project — left running afterward.

**Acceptance gate — actually run, not just described (first real DB in this project's
history):**

```powershell
docker-compose -f infra/docker-compose.yml up -d postgres
pnpm run db:migrate                        # both migrations applied clean to a fresh DB
node scripts/db-smoke.mjs                  # → DB SMOKE OK (setup + both triggers + FK, all live)
pnpm build                                 # @penumbra/db still compiles
```
Verified: 11 tables, 11 FK constraints (`pg_constraint`), exactly 3 trigger objects
(`pg_trigger`, not the 6 rows `information_schema.triggers` shows — that view lists one row
per covered event, UPDATE and DELETE separately, for the same `BEFORE UPDATE OR DELETE`
trigger).

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

- [x] `.github/workflows/ci.yml`: removed `working-directory: rust` from all three cargo steps
  (and switched `cargo test/clippy --all` → `--workspace`, the current non-deprecated spelling);
  dropped the `version: 8` input from `pnpm/action-setup` (it now respects `packageManager`);
  `actions/setup-node` → node 20; `Swatinem/rust-cache` `workspaces: .`.
- [x] `packages/config/package.json`: added `@typescript-eslint/parser` and
  `@typescript-eslint/eslint-plugin` at `^8.63.0` (latest on the registry, not the originally
  guessed `^7` — `@typescript-eslint` 8.x's peer range already covers the installed
  `eslint@8.57.1`, so no eslint version bump was needed). Also added `"type": "module"` to this
  package.json (missing despite the config file using ESM `import`/`export default` — Node was
  silently reparsing it every run and warning about it).
  **Found and fixed a second, more serious latent bug while verifying this:** `parser:
  '@typescript-eslint/parser'` as a **string** doesn't just work "by hoisting luck" — it's
  outright rejected by ESLint's flat config (`ConfigError: Key "parser": Expected object with
  parse() or parseForESLint() method`), confirmed by actually running the shared config in flat
  mode. Flat config requires the imported parser *module object*, not its package name (that
  string form is only valid in the legacy `.eslintrc` format). Fixed by importing
  `@typescript-eslint/parser` and passing the module directly. This was previously undetectable
  because **no package in the workspace actually invokes `@penumbra/config/eslint`** — only
  `apps/web` has a `lint` script, and it uses `next lint` (its own `eslint-config-next`), not
  this shared config. Verified the fix directly: ran the shared config against a real `.ts`
  file with `ESLINT_USE_FLAT_CONFIG=true`, confirmed it errors before the fix and lints clean
  after. Wiring this shared config into the five currently lint-less packages (core, fog, db,
  cert-schema, config itself) is out of scope here — flagged for whichever later stage first
  needs real linting there (Stage 3's `services/analysis` or Stage 5's `apps/api`).
- [x] `turbo.json`: added a `clean` task (`"clean": { "cache": false }`) — confirmed via
  `turbo run clean --dry-run` that it now dispatches to all six packages' own `clean` scripts.

**Acceptance gate:** after the Stage 1 push, the GitHub Actions run is green end-to-end (this
will be the first genuinely green CI). Locally: `pnpm lint && pnpm type-check && pnpm build` —
all green. Also required an unplanned but necessary fix: `cargo fmt --all -- --check` (part of
CI) failed against the **entire pre-existing codebase**, not anything touched this stage — the
whole repo is hand-formatted at 2-space indentation, but rustfmt's default is 4-space. Added a
root `rustfmt.toml` (`tab_spaces = 2`) so the check validates against the project's actual
established style instead of fighting it, then ran `cargo fmt --all` once to fix the handful of
over-width lines (mine and a couple of pre-existing ones) that `--check` also flags regardless
of indent width — a whitespace-only diff, confirmed by rerunning the full test suite (still
20/20) and clippy (still clean) afterward.

**Second unplanned fix, only found by actually watching the pushed CI run (not just running
things locally):** the run failed at the `Type check` step with
`@penumbra/fog: Cannot find module '@penumbra/core'`. `turbo.json`'s `type-check` task had no
`dependsOn: ["^build"]` (unlike `build` and `test`), so on a genuinely clean checkout turbo ran
every package's `tsc --noEmit` in parallel with no ordering — and `@penumbra/fog` needs
`@penumbra/core`'s compiled `dist/` (its `package.json` `exports` map points there, not at
`src/`). This had never surfaced locally because `dist/` folders were already sitting on disk
from earlier builds in every session. Added the missing `dependsOn`, then reproduced and
confirmed the fix by actually deleting every package's `dist/` and `.turbo` cache and rerunning
`pnpm type-check` from that clean state (fails without the fix, passes with it), then reran the
full local sequence (`type-check`, `lint`, `build`, `test`, plus all three Rust steps) end to
end from clean before pushing again.

**Third unplanned fix, same "watch the actual CI run" discipline:** the next push got past
`Type check`/`Lint`/`Build` but failed at `Test (TypeScript)` with
`packages/fog: pnpm run test exited (1)`. `@penumbra/fog` has zero test files yet, and its
script (like `core`'s and `cert-schema`'s) was `"test": "node --test dist/**/*.test.js"`
**unquoted** — on Node 20 (what CI was pinned to), an explicit glob argument that matches zero
files apparently isn't handled the same forgiving way it is on newer Node (verified locally on
Node 24.15.0: the identical unquoted-then-literal glob string, fed straight to `node --test`,
gracefully reports "0 tests" whether or not anything matches — but that's Node 24's behavior,
not proof of Node 20's). Rather than gamble on which Node version's `--test` glob support is
responsible, fixed both contributing factors: quoted the glob in all three affected
`package.json` scripts (`"node --test \"dist/**/*.test.js\""`) so a single consistent literal
string always reaches Node's own glob engine regardless of shell — confirmed this reaches
Node identically however `pnpm run test` invokes it — and bumped `actions/setup-node`'s
`node-version` from 20 to 22, which separately resolves a GitHub-surfaced annotation warning
that Node 20 support itself is deprecated on the platform.

**Commit plan:** `fix ci workspace paths and eslint parser dependency`,
`fix type-check task missing a build dependency in turbo`,
`fix test script glob and bump ci to node 22`.

**Stage 1 close-out:** update `PROGRESS.md` (hardening section: what shipped, the kqpk
semantic-honesty note, zobrist migration note), tick this file's boxes, commit
`update progress notes for hardening pass`, **push** (pre-approved for stage close), verify CI
goes green on GitHub (`gh run watch` or check the Actions tab).

**Done 2026-07-08.** Confirmed via the GitHub Actions API (no `gh` CLI available in this
environment) — run
[28947002453](https://github.com/srikantlose/Penumbra/actions/runs/28947002453), commit
`d0f25f3`: every step green (`Type check`, `Lint`, `Build`, `Test (TypeScript)`,
`Test (Rust)`, `Check Rust formatting`, `Clippy`). This took three iterations to actually get
green — two real bugs (turbo's `type-check` missing `dependsOn: ["^build"]`; an unquoted empty
test glob failing on Node 20 but not on the Node 24 used for all local testing this session)
were only caught by watching the pushed run itself, not by anything that could be reproduced
by running commands locally in a long-lived dev environment with `dist/` already built and a
newer Node than CI's pin. **Lesson for future stages:** a green local `pnpm build && pnpm test`
is necessary but not sufficient evidence CI will pass — actually push and watch at least once
per stage that touches shared tooling (turbo, CI config, package scripts), and prefer
reproducing suspected environment-shaped bugs (stale build artifacts, tool version drift) over
guessing from local output alone.

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

- [x] `scripts/fetch-syzygy.mjs`: download all 3-4-5-man WDL (`.rtbw`) + DTZ (`.rtbz`) files
  (~1 GB total, 145 files each) from `https://tablebase.lichess.ovh/tables/standard/3-4-5-wdl/`
  and `.../3-4-5-dtz/` (see decision log — corrected from this doc's original single-dir URL;
  fallback mirror `https://tablebase.sesse.net/syzygy/3-4-5/`) into `tablebases/syzygy/3-4-5/`.
  Idempotent (skip files that exist with the right size); writes
  `tablebases/manifest.json` (file list + sizes + fetch date); prints a summary count.
- [x] Add `tablebases/` to `.gitignore`.

**Acceptance:** `node scripts/fetch-syzygy.mjs` twice — second run downloads nothing; directory
holds 290 files ≈ 1 GB. **Done** 2026-07-08: 290 files, 984 MB, second run reports
`0 downloaded, 290 already present`.

### 2.2 Prover: claim modes, TB leaf oracle, transpositions (`rust/prover`)

- [x] Add dep `shakmaty-syzygy = "0.24"` — confirmed via `cargo tree -p penumbra-prover` that it
  resolves to `shakmaty 0.26.0` (checked crates.io's dependency graph directly before adding:
  `shakmaty-syzygy 0.24.0` requires `shakmaty ^0.26.0` exactly; 0.25+ require newer shakmaty).
- [x] New `src/tb.rs`: thin oracle wrapper. **Deviates from the pseudocode above** — see decision
  log ("TbOracle built on `probe_wdl`/`AmbiguousWdl`, not `probe_wdl_after_zeroing`+manual DTZ
  math"). Signature actually shipped:
  ```rust
  pub struct TbOracle { tb: Tablebase<Chess>, max_pieces: usize }
  impl TbOracle {
      pub fn new(dir: &Path) -> io::Result<Self>;
      pub fn probe(&self, pos: &Chess, perspective: Color) -> Option<AmbiguousWdl>;
  }
  pub fn outcome_for_claim(wdl: AmbiguousWdl, claim: ClaimValue) -> Option<&'static str>;
  ```
  Castling-rights and piece-count guards implemented as specified.
- [x] `src/pns.rs` — claim-mode generalization: `ClaimValue { Win, AtLeastDraw }` (default
  `Win`) added to `ProofSearchConfig`; `tablebase_path` now constructs a `TbOracle`. Terminal
  evaluation matches the table above exactly (verified via `tb::tests::*_claim_truth_table`),
  but the DTZ/halfmove-clock arithmetic is delegated to `shakmaty_syzygy::Tablebase::probe_wdl`
  (see decision log) rather than hand-rolled. Both-colors perspective unit test:
  `tb::tests::probe_perspective_matches_regardless_of_side_to_move` (KQvK, both sides to move).
- [x] TB terminals evaluated at leaf creation exactly as specified; terminal type `tablebase`,
  value `"win"`/`"draw"`; `dtm` never emitted.
- [x] **Transposition handling implemented; full cross-branch DAG dedup deliberately NOT
  implemented** — see decision log ("ancestor-path cycle detection only, no global transposition
  table"). Ancestor detection walks `PnsNode.parent` links (each node now caches its own
  `zobrist: String`); on a hit, `AtLeastDraw` emits a `transposition` terminal, `Win` is
  unchanged (no-op, matching today's behavior exactly). Halfmove clock: not threaded manually —
  `pos.halfmoves()` is read directly off the position at probe time, which is what
  `probe_wdl` needs.
- [x] `src/certificate.rs`: `Terminal` gains `dtm: Option<i32>` (kept `None`);
  `Dependencies { tablebase: Some("syzygy".into()) }` iff the emitted tree contains ≥1
  tablebase terminal; claim `value` string comes from the config.
- [x] `src/main.rs`: `--claim <win|at_least_draw>` (default `win`) and `--syzygy <DIR>` added.
- [x] Round-trip tests `tests/fortress_roundtrip.rs`: KPvK dead-draw (endpoint-validated, see
  below) proves → serializes → verifies with `TablebasePolicy::Syzygy`, plus a
  rejected-without-`--syzygy` counterpart. Runtime-skip guard on `tablebases/syzygy/3-4-5/`
  existing, confirmed both the "present" and (by temporarily renaming the dir) "absent" paths.

### 2.3 Verifier: real probing (`rust/verifier`)

- [x] Added `shakmaty-syzygy = "0.24"`; `rust/verifier/src/tb.rs` is a separately-written wrapper
  (own `TbOracle`, own `wdl_matches` truth table — no shared code with the prover's `tb.rs`,
  per invariant 1.1.1). Returns `Result<_, String>` rather than `Option` (a verifier probe
  failure is always reportable, unlike the prover which can just keep searching).
- [x] `TablebasePolicy::Syzygy(PathBuf)` added (dropped `Copy` from the enum's derive since
  `PathBuf` isn't `Copy`; `Clone` retained). Oracle built once per `verify_with` call (not
  per-terminal) and threaded through `SemanticCtx`. Piece-count/castling guards match 2.2.
  Mismatch and probe-failure messages both go through `VerifyError::TablebaseError` as specified;
  `report.probe_count` increments once per successful probe (match or mismatch — a mismatch is
  still a real probe, just a failing one).
- [x] CLI: `--syzygy DIR` wires `TablebasePolicy::Syzygy`. `--offline` implemented as a hard
  override (forces `Forbid` even if `--syzygy`/`--assume-tb` are also passed, with a warning) —
  stronger than the spec's minimum ("alias for default-Forbid"), chosen so the flag has real
  teeth as an explicit opt-out. `--tb-endpoint` still inert, warns to use `--syzygy`.
- [x] Mutation test added as static fixtures (verifier can't depend on the prover crate, so this
  couldn't be generated inline): `tests/golden/kpvk_fortress_draw.json` (real, endpoint-validated
  KPvK draw, produced by the actual prover CLI) and `tests/mutations/tablebase_value_flip.json`
  (same cert, `value` flipped `draw`→`win`). `mutation_tablebase_value_flip_fails_with_syzygy`
  asserts the flip is caught with a `"tablebase probe failed"` + `"declares value"` message.
- [x] Spec addendum written: `docs/CERTIFICATE_FORMAT.md` §"Tablebase terminal soundness (DTZ /
  50-move rule)", including the same probe-vs-declared-value table as above, framed around
  `probe_wdl`'s 7-valued `AmbiguousWdl` rather than raw DTZ arithmetic.

### 2.4 Fortress seeds (~10, min 5)

**Validation protocol (mandatory, per candidate, before any prover time):** probe
`https://tablebase.lichess.ovh/standard?fen=<url-encoded FEN>` and require `category` = `draw`
(or the claim-appropriate value). Discard any candidate that disagrees; pick the next from the
family. Keep a scratch list of validated FENs before starting proofs.

- [x] **Tier A — machinery smoke (4 certs; root ≤5 men, all resolve in 1 node):** KPK dead draw,
  wrong-bishop + h-pawn draw (`KBPvK`, light bishop can't cover the dark h8 corner), a genuine
  stalemate-at-root, and a Vancura-position `KRPvKR` draw. All 4 endpoint-validated
  (`category: draw`) before proving.
- [x] **Tier B — shallow trees over TB terminals (3 certs; 6 men):** two opposite-colored-bishop
  single-pawn blockades (different king placements → different proof-tree sizes, 126 and 3725
  search nodes) and an adjacent-file triple pawn chain that liquidates via a diagonal capture
  into a 5-man draw. Root positions endpoint-validated.
- [x] **Tier C — genuine fortress cycles (3 certs; 8–10 men):** the roadmap's suggested family
  (`8/8/2k5/ppp5/PPP5/2K5/8/8 w - - 0 1`) turned out to be a **win**, not a draw, on endpoint
  validation — several king placements in that family were tried and rejected before finding the
  actual mechanism that works: pawns on *non-adjacent* files (no diagonal captures ever legal
  for either side, unlike Tier B's adjacent-file chains), which forces the proof to close purely
  by king-shuffle repetition. Two are pure-transposition showcases (7 and 9 transposition
  terminals, zero tablebase dependency); the third mixes 2 transposition + 1 stalemate terminal.
  8-10 men is beyond Lichess's 7-man table coverage, so validated via its per-move heuristic
  instead of a whole-position category — confirmed the proof's actual root move matches the
  endpoint's own `"category": "draw"` reply, not just some other move landing on a drawn
  position.
- [x] Stored in `rust/prover/examples/fortress/*.pnbcert` (10 certs, committed). Full
  provenance table (FEN, claim side, search/cert node counts, terminal breakdown, validation
  method) in `rust/prover/examples/fortress/README.md`.

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

**Done** 2026-07-08: ran verbatim against `tierB_ocb_blockade_1` — `Valid: true, Probes: 9` with
`--syzygy`, `Valid: false` (same "no tablebase source" message) without it. `cargo test
--workspace`: 32/32 green (incl. the 4 fortress-round-trip tests across both crates, all
detecting the tablebase directory and running for real, not skipping). All 10 committed certs
individually confirmed `Valid: true` with `--syzygy`; the 7 with a tablebase dependency also
confirmed `Valid: false` without it (the other 3 are pure transposition/stalemate proofs with no
tablebase terminal to gate, so they pass either way — expected, not a soundness gap).

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

- [x] **`uci/client.ts`** —

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
- [x] **`uci/parse.ts`** — pure parser:
  `parseInfoLine(line) → { multipv?, depth?, nodes?, scoreCp?, scoreMate?, wdl?: {w,d,l}, pv? } | null`.
  Handles `score cp -13`, `score mate 3`, `wdl 124 812 64`, `multipv 2`. Unit tests against
  **committed transcript fixtures** (`services/analysis/test-fixtures/*.txt` — capture a real
  SF and Lc0 transcript once during implementation, commit them) so CI needs no engine binary.
- [x] **`engines/config.ts`** — the canonical contract (from `docs/FOG_INDEX_METHODOLOGY.md`):

  ```ts
  export const STOCKFISH_CANONICAL = {
    options: { Threads: 1, Hash: 256, MultiPV: 4, UCI_ShowWDL: true },
    ladder: [1_000_000, 4_000_000, 16_000_000, 64_000_000],
  };
  export const STOCKFISH_QUICK = { options: same, ladder: [100_000, 400_000, 1_600_000] };
  export const LC0_CANONICAL = { options: { MultiPV: 4 }, nodes: 30_000 };
  ```

- [x] **`fingerprint.ts`** — exact definition (uses cert-schema's `canonicalizeJSON`):

  ```ts
  computeEngineFingerprint({
    formulaVersion: '0.1',
    stockfish: { version, nnue, options: {...}, ladder: [...] },
    lc0: { version, network, options: {...}, nodes, backend },
  }) => '0x' + sha256(canonicalizeJSON(settings))    // 66 chars, fits evals.engine_fingerprint varchar(66)
  ```

  The quick tier gets its **own honest fingerprint** (different ladder ⇒ different fingerprint
  ⇒ separate `fog_scores` rows). Never label quick output with the canonical fingerprint.
- [x] **`scripts/fetch-engines.mjs`** — downloads pinned engine builds into gitignored
  `engines/` (add to `.gitignore`): a Stockfish release win-x86-64-avx2 zip and a matching
  Lc0 CUDA build + one pinned network file. **Pin at implementation time:** pick the latest
  stable release of each, record exact version, URL, and sha256 in `docs/ENGINES.md` (a table:
  component / version / URL / sha256 / date). The script verifies sha256 after download and is
  idempotent. Lc0 needs its CUDA DLLs from the release zip; the RTX 4060 + driver already
  present suffice.
- [x] **`engines/stockfish.ts` / `engines/lc0.ts`** — produce exactly the shape
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
- [x] **`pipeline/analyzePosition.ts`** —
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
- [x] **`queue/worker.ts`** — BullMQ worker for `analyze-position`
  (`jobId = epd + ':' + fingerprint` for idempotent dedupe), canonical queue concurrency **1**
  (determinism + the 64M rung is CPU-saturating), quick queue concurrency 2. Graceful
  shutdown kills engine children (`proc.kill()`; Windows has no POSIX signals).
- [x] **`cli.ts`** — `pnpm --filter @penumbra/analysis run analyze -- --fen "<fen>" --tier
  quick --json`: runs the pipeline inline (no queue), prints the fog JSON.
- [x] **`repro-test` script** (package.json script): runs the **quick** ladder twice on 3 fixed
  FENs, asserts the two canonical-JSON outputs are byte-identical. Canonical-tier repro
  (2 × ~90 s/position) is a manual script (`repro-test:canonical`), run once and record the
  result in ENGINES.md. **If Lc0 flakes** (GPU nondeterminism): pin `--backend=cuda-fp32`; if
  still flaky, fall back to a CPU backend (`blas`/`eigen` — 30k nodes is CPU-feasible) — record
  whichever backend wins in ENGINES.md and bake it into the fingerprint.
  **Result:** `cuda-fp32` doesn't exist on the pinned build; plain `cuda` (incl. with
  `MinibatchSize=1`) was verified non-deterministic; `blas` was verified deterministic but 30k
  nodes cost 5-8 min/search regardless of network size on this hardware — node count reduced to
  2k (user-approved) after measuring per-node cost is backend-overhead-bound, not FLOPs-bound.
  Full quick-tier `repro-test` passes byte-identical on all 3 fixed positions with the final
  pin. See `docs/ENGINES.md` for the complete investigation and timing data.

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

- [x] **`src/import/lichess.ts`** — public export API (no OAuth for public games):
  `GET https://lichess.org/api/games/user/{username}?max={n}&moves=true&pgnInJson=true` with
  header `Accept: application/x-ndjson`; stream-parse NDJSON lines → `{id, players, winner,
  pgn, variant, speed, createdAt}`. **Skip non-standard variants** (`variant !== 'standard'` —
  rules:"standard" invariant). Single concurrent request, and throttle politely (Lichess
  etiquette: one stream at a time, no hammering). Single game:
  `GET https://lichess.org/game/export/{id}?pgnInJson=true`.
- [x] **`src/import/pgn.ts`** — chessops-based extraction (chessops 0.15 API, verified:
  `parsePgn` from `chessops/pgn`, `startingPosition(game.headers)`, `game.moves.mainline()`,
  `parseSan` from `chessops/san`, `makeUci` from `chessops/util`):
  `extractPositions(pgn: string) → { ply, fen, epd, zobristHex, pieceCount, uci, san }[]`
  — entry per position **after** each ply, plus ply-0 startpos entry. Convention (document in
  the module docstring, reuse everywhere): **ply 0 = the position before White's first move;
  entry N holds the position after ply N and the move that produced it.**
- [x] **`src/import/persist.ts`** —
  `upsertGame` (unique on (source, source_game_id) — `ON CONFLICT DO NOTHING` + select),
  `upsertPositions`: `INSERT … ON CONFLICT (epd) DO UPDATE SET occurrence_count =
  positions.occurrence_count + 1` (positions is a counter table, not append-only);
  `first_seen_game_id` set only on first insert; bulk-insert `game_positions` rows.
- [x] **`src/pipeline/analyzeGame.ts`** — create `analyses` row (`tier`, `status: 'queued'`);
  enqueue per-position jobs (quick tier default; deep = canonical enqueued with low priority);
  when all positions of a game are scored, assemble the **fog timeline** and update the row
  (`status: 'done'`, `completed_at`):

  ```json
  [{ "ply": 1, "positionId": 123, "san": "e4", "fog": 45, "percentile": 52.3,
     "status": "EVALUATED", "fingerprint": "0x…" }, …]
  ```

- [x] **Truth labeling helper** (put in `packages/db/src/truth.ts`, exported — web/API/worker
  must not disagree): `deriveTruthStatus({ positionId, pieceCount }) → 'PROVEN' | 'EVALUATED'`
  — PROVEN iff a `proofs` row exists for the position, or piece count ≤ 7 **and** a `tb_probes`
  row exists (probe cache; populate via the Lichess TB endpoint
  `https://tablebase.lichess.ovh/standard?fen=…` for 6–7 men, local Syzygy for ≤5 when
  available — cache every probe in `tb_probes`).
- [x] **Proof-entry detection:** `analyses.proof_entry_ply` = first ply whose position is
  PROVEN by the helper above. `missed_proofs` v1 scope (document it): for positions with
  piece count ≤ 8, check whether any legal move leads to a child position that is already
  PROVEN with a win for the mover while the played move's result position is not — collect
  `{ ply, uci }` entries; anything deeper is out of scope until Phase 2.
- [x] **CLI additions:** `run import -- --user <name> --max 5`,
  `run import -- --pgn <file>`, `run analyze-game -- --game-id <id> --tier quick`.
- [x] **Unit tests** (no network): PGN fixture with castling + promotion + en passant +
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

**Result:** the truth-status helper landed one commit earlier than planned --
proof-entry detection's own required unit test (mocking the TB probe, no live DB)
only works cleanly if `deriveTruthStatus` already exists as an injectable, DB-free
predicate, so `packages/db/src/truth.ts` shipped together with `analyzeGame.ts` in
the second commit. The third commit became a small retrofit instead: point
`analyzePosition.ts`'s existing (Stage 3) proof check at the new shared helper,
deleting its private duplicate. Actual commits: `add lichess import and pgn
position extraction`, `add game analysis pipeline with fog timeline and proof
entry detection`, `adopt the shared truth status helper in the position
pipeline`, progress/ticks, push.

**Acceptance gate: passed (2026-07-10).** Running it live surfaced two pre-existing
bugs the gate exists to catch (a colon-in-identifier BullMQ rejection, live-tested
for the first time here since Stage 3's worker had never actually run against Redis)
and two real gaps in `analyzeGame.ts` only visible with a full real game's worth of
positions (a per-job wait ttl that counted from enqueue rather than job-start, and
no handling for a checkmate/stalemate position's terminal all-legal-moves-exhausted
case). All four fixed in a follow-up commit (`fix analyze-game queue bugs surfaced
by the live acceptance gate`), re-verified against the same live game, then pushed.
Full account, including a non-reproducing Stockfish-crash investigation traced to
Docker Desktop's idle auto-pause rather than a code bug, is in `PROGRESS.md`'s M4
section. These decisions (the fixes and the choice not to chase the non-reproducing
crash further) were made autonomously, per standing instruction, without pausing
for user sign-off -- see `HANDOFF.md`.

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

- [x] `src/server.ts` (build + listen :3001, zod type provider, CORS for `localhost:3000`),
  `src/schemas.ts` (zod for every request/response — the response schemas are the API contract,
  keep them in one file).
- [x] `src/plugins/auth.ts`: `X-API-Key` → sha256 → `api_keys` lookup (`key_hash`); anonymous
  requests allowed on GET routes with the per-IP limiter. Key format `pnb_` + 32 random bytes
  hex; store only the sha256.
- [x] `src/plugins/rateLimit.ts`: `@fastify/rate-limit` with redis store — per-key
  `api_keys.rate_limit`/min when authenticated, 60/min per-IP anonymous; 429 with retry-after.
- [x] `src/ledger.ts` — the hash chain writer (also documented as a spec addendum in
  `docs/CERTIFICATE_FORMAT.md` §Ledger):
  `entry_hash = '0x' + sha256( bytes(prev_hash_hex_decoded) || sha256(canonicalizeJSON(payload)) )`;
  genesis `prev_hash = '0x' + '00'.repeat(32)`. Single-writer: `SELECT seq FROM ledger_entries
  ORDER BY seq DESC LIMIT 1 FOR UPDATE` inside a transaction.
  `publishProof(proofRow, certJson)`: upload cert to minio bucket `proofs` (object key
  `certs/<sha256>.pnbcert`), insert `proofs` row (status `published`), append ledger entry
  `{type:"proof_published", proof_sha256, claim, epd, published_at}`.
- [x] `scripts/publish-proofs.mjs` — publishes the committed example + fortress certs through
  `publishProof` (idempotent on `certificate_sha256` unique index).
- [x] `scripts/verify-ledger.mjs` — walks the chain, recomputes every hash, prints
  `LEDGER OK (n entries)` or the first broken seq.
- [x] Tests: `fastify.inject()` integration tests against docker Postgres/Redis (fog 200/202
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

**Result:** built and committed largely as planned, with two additions the original task list
didn't anticipate. `@penumbra/analysis` had to be added as a workspace dependency (not just the
`{db,core,fog,cert-schema,config}` this section lists) — the fog enqueue path, methodology
fingerprints, and `/bff/import` all need helpers that only live in that package. The `minio` JS
client was added too; the task list specifies minio as the object store but doesn't name a
library. `FOG_WEIGHTS` was extracted as a named export from `packages/fog/src/formula.ts`
(previously inline literals) so the methodology endpoint reports the exact weights in use instead
of a second, driftable copy — a small, justified refactor, not scope creep.

**Acceptance gate: passed (2026-07-11).** Real docker Postgres/Redis/minio, real Stage 4 engine
binaries. `pnpm --filter @penumbra/api test` → 18/18 (`fastify.inject()` integration tests against
live infra, `ledger.test.ts`'s fixed-payload unit tests); `node dist/server.js` on `:3001`;
`node scripts/publish-proofs.mjs` → all 13 example/fortress certs published (idempotent on
re-run); `curl /v1/fog?fen=<startpos>` → 202 first, confirmed 200 with a real computed score
(`fog_scores` row: score 47, percentile 53) once the canonical-tier worker drained the job;
`curl /v1/proofs` → real published certs; `node scripts/verify-ledger.mjs` → `LEDGER OK (13
entries)`. Full account, including the public-tier choice (canonical, not quick) and the
synchronous-for-v1 call on `/bff/import`, is in `PROGRESS.md`'s M6 (API half) section and
`HANDOFF.md`.

---

## Stage 6 — M5 remainder: wire the web app

**Goal:** all six pages render live data; personal game journey page; local assets; Playwright
smoke suite. The M5 checklist line — "Position page shows provenance + eval history + fog" —
goes green here.

**Preconditions:** Stage 5 running locally (API on :3001, worker running, seed data published).

**Tasks:**

- [x] `apps/web/src/lib/api.ts` — typed fetch helpers for every consumed endpoint; base URL
  from `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`). Server components fetch
  directly; the `/board` fog-poll is client-side (202 → retry with backoff until 200).
- [x] **Assets:** create `apps/web/public/logo.png` and `apps/web/public/avatar.png` (design a
  simple B&W pixel logo consistent with the locked design system — a dithered half-moon
  "penumbra" mark works; any locally-produced asset beats the dead Stitch hotlinks). Replace
  the two `lh3.googleusercontent.com` `<img>` srcs (in `src/app/page.tsx` and
  `src/components/stitch/TopNavBar.tsx` / board page avatar).
- [x] Page wiring (keep layouts; swap hardcoded consts for fetched data):
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
- [x] Delete dead `ScreenSlot.tsx` (no route uses it since the spec-built pages landed).
- [x] **Playwright smoke** (`apps/web/tests/*.spec.ts` + `playwright.config.ts`, devDep
  `@playwright/test`): boots web+api against docker services; per route: renders, zero console
  errors (the ShaderBackground WebGL check pattern already proved out); one live fog round-trip
  (202→200); proofs page shows ≥1 real cert; journey imports a tiny public account (or a
  seeded fixture user when offline).
- [x] **Design-system overflow check** (the Press Start 2P lesson): eyeball every new
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

**Result:** built largely as planned, with two small additions the original task list didn't
anticipate and one deliberate substitution. `apps/api` gained `GET /v1/positions` (recent list,
backs the `/positions` index page) and `GET /v1/games/{id}` (a game's latest analysis, backs
`/journey`'s per-game timeline) — Stage 5's route table had no "list" or "game" endpoints, and
the web app needed both to do what this stage actually asks for. `@penumbra/core` was added as
an `apps/web` dependency so the FEN→zobrist computation on `/board` and `/positions` reuses the
exact backend algorithm instead of a second implementation or a widened API contract. The
logo/avatar assets are hand-authored SVGs, not PNGs as literally named in the task list — same
"locally hosted, no network dependency" goal, chosen because SVG is something reliably
authorable as text.

**Acceptance gate: passed (2026-07-11).** `pnpm --filter @penumbra/web build` succeeds (7 routes,
static where expected); the Playwright suite is 10/10 against real running infra (`apps/api`,
docker Postgres/Redis/minio, the analysis worker): all 7 routes render with a live WebGL context
and zero console errors, the proofs page shows real published certs, a fresh never-seen FEN's fog
score flips 202→200 in ~26s against the real canonical-tier worker, and importing the real
account `DrNykterstein` returns 10 real games — one of which (already analyzed during Stage 4's
own acceptance gate) renders its real 49-ply fog timeline. Also eyeballed directly in a real
browser (not just the test suite): screenshots of `/`, `/board`, `/journey`, `/proofs`, and a
`/positions/[zobrist]` detail page all confirm the locked design system renders correctly with
real data and no text overflow. **The Playwright suite is not wired into `ci.yml`** — same call
as Stage 4's own live acceptance gate: it needs a running worker and ~1GB of gitignored engine
binaries that have no place in a GitHub Actions runner. Full account, including the API
additions and the seed-dev-api-key.mjs script the `/journey` flow needed, is in `PROGRESS.md`'s
M5 section and `HANDOFF.md`.

---

## Stage 7 — Launch (M6 remainder)

**Goal:** public artifacts (crates.io verifier, GitHub release binaries), production deploy,
methodology finalization. **Every task here has an ask-the-user checkpoint** (§1.3).

**Preconditions:** Stages 1–6 green; CI green.

**Tasks:**

- [x] **License split — ASK THE USER FIRST (new finding, 2026-07-08):** `shakmaty` and
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
- [x] **crates.io publish `penumbra-verify`:** Cargo.toml needs `description`, `repository`,
  `readme`, `license`, `keywords`, `categories`; `cargo publish --dry-run` first; then publish
  (user confirms). The prover is NOT published (its dev-dep direction is fine).
- [x] **GitHub release:** `.github/workflows/release.yml` — on tag `verify-v0.1.0`, matrix
  build (`windows-msvc`, `linux-gnu`, `macos-arm64`) of `penumbra-verify --release`; archives
  include the binary, the two semantic golden certs, a fortress cert, and a README verification
  walkthrough (`penumbra-verify verify morphy_mate_in_2.pnbcert` → `Valid: true`).
- [ ] **Deploy — ASK THE USER (target + accounts):** docs assume Hetzner + Cloudflare + R2.
  Produce `infra/docker-compose.prod.yml` (postgres, redis, api, worker, web behind
  Caddy/nginx; minio replaced by R2 in prod) + `infra/deploy.md` runbook. Lc0 canonical jobs:
  local-CPU backend or on-demand RunPod per the Stage 3 ENGINES.md decision.
  **Skipped for now (user decision, 2026-07-11):** no real Hetzner/Cloudflare/R2 target exists
  yet; revisit when there is one.
- [x] **Methodology finalization:** `percentile_provisional: true` in every API response
  carrying a percentile (already per Stage 5), the provisional label on web (already per
  Stage 6), `docs/FOG_INDEX_METHODOLOGY.md` gets a dated "Calibration status" box stating the
  placeholder situation and the post-launch plan.
- [~] **M6 gate (the launch checklist):**
  - `GET /v1/fog?fen=…` on prod: 202 → score. **N/A** — no prod deploy yet (see above).
  - `cargo install penumbra-verify` works from crates.io. **Pending** — crate is packaged,
    metadata-complete, and `cargo publish --dry-run` verified; actual `cargo publish` is
    blocked on a crates.io API token only the account owner can provide (`cargo login`).
  - A stranger can download a release binary + a fortress cert + Syzygy 3-4-5 and get
    `Valid: true` offline, and `Valid: false` after flipping any byte of the cert. **Verified**
    2026-07-11: downloaded the actual `verify-v0.1.0` Windows release asset from GitHub,
    ran `penumbra-verify verify examples/morphy_mate_in_2.pnbcert` → `Valid: true`, then
    changed the claimed value in a copy → `Valid: false` with `Invalid claim value`. (Used the
    mate-in-2 golden cert rather than the Syzygy-backed fortress cert, since that needs the
    ~1 GB tablebase download — the offline verification path itself is confirmed either way.)

**Result:** License split, crates.io publish prep, and the GitHub release workflow are done
and verified live (release `verify-v0.1.0` on GitHub has all three platform archives, smoke-tested
for real). Also fixed a CI bug discovered along the way while investigating a failing "Test
(TypeScript)" step unrelated to this stage's own changes: `apps/web`'s Playwright suite was
named `"test"` in its `package.json`, so turbo's generic `pnpm test` pipeline had been silently
running it in CI (with no live `apps/api` or dev server there) since the suite was added in
Stage 6 — renamed to `"test:e2e"` so `turbo test` no longer picks it up. Deploy and the actual
`cargo publish` remain open, both blocked on things only the user can supply (real infra
accounts; a crates.io token) rather than on any remaining decision or code.

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
- **2026-07-08 — Syzygy source URLs corrected:** the actual lichess layout splits WDL/DTZ into
  `tables/standard/3-4-5-wdl/` and `tables/standard/3-4-5-dtz/` (not the single `3-4-5/` this
  roadmap originally named); both confirmed to hold exactly 145 files each (984 MB total), matching
  the estimate. `scripts/fetch-syzygy.mjs` lists both index pages directly instead of hardcoding
  the 290 filenames, so it stays correct if the host's set ever changes. The `sesse.net` mirror
  is currently serving a mismatched TLS cert for an unrelated host (fails from both curl/schannel
  and Node) — kept as a best-effort per-file fallback in the script, but don't rely on it.
- **2026-07-08 — Syzygy value mapping — superseded by the `probe_wdl`/`AmbiguousWdl` decision
  below.** (Original plan, kept for history: `win` claims require strict `Wdl::Win` +
  hand-rolled DTZ-vs-halfmove-clock check; `at_least_draw` accepts Win/CursedWin/Draw and
  BlessedLoss only with `|dtz| + hmc ≥ 100`. Superseded because `shakmaty-syzygy`'s own
  `Tablebase::probe_wdl` already does this arithmetic — see below.)
- **2026-07-08 — `TbOracle` built on `probe_wdl`/`AmbiguousWdl`, not `probe_wdl_after_zeroing` +
  manual DTZ math:** reading the actual `shakmaty-syzygy 0.24.0` source
  (`src/tablebase.rs`/`src/types.rs`) before writing the oracle showed `Tablebase::probe_wdl`
  already computes `AmbiguousWdl::from_dtz_and_halfmoves(dtz, pos.halfmoves())` internally — the
  exact `|dtz| + halfmove_clock` bookkeeping this roadmap's 2.2 pseudocode asked to hand-roll.
  Using it directly: (a) removes an entire class of "the classic bug" this doc explicitly warned
  about, since the sign/rounding logic is the crate's own tested code, not a reimplementation;
  (b) collapses the `win`/`at_least_draw` truth table to one small match (`tb::outcome_for_claim`
  in the prover, `tb::wdl_matches` in the verifier — independently written per the two-crate
  rule) over `AmbiguousWdl`'s 7 values, including its `MaybeWin`/`MaybeLoss` rounding-ambiguity
  cases, which the original DTZ-arithmetic plan didn't account for at all. `MaybeLoss` is
  rejected under both claims (can't tell `Loss` from `BlessedLoss`); `MaybeWin` is accepted only
  under `at_least_draw` (both `Win` and `CursedWin` already qualify). Both truth tables are
  documented in `docs/CERTIFICATE_FORMAT.md` and covered by table-driven unit tests
  (`tb::tests::*_claim_truth_table` in each crate).
- **2026-07-08 — No cross-branch transposition dedup; ancestor-path cycle detection only:** the
  roadmap's 2.2 pseudocode asked for a global `HashMap<zobrist, NodeIndex>` so repeated
  positions share one arena node (a DAG) — but PNS over a true DAG requires multi-parent proof-
  number backup (a node reached two ways must propagate to *both* parents), which is a known
  hard generalization (the graph-history-interaction problem in PN-search literature) and not
  something to bolt on hastily. Re-reading `rust/verifier/src/semantic.rs`'s existing
  transposition-terminal check (`ctx.path_zobrists.contains(&node.zobrist)`) showed it only
  requires the *terminal's own* zobrist to match *some ancestor's* zobrist — it does not require
  the prover to actually share node objects, and doesn't check that every occurrence of a
  position picks the same move (no "positional strategy" invariant is actually enforced
  verifier-side). So the prover implements only the correctness-required half: walk
  `PnsNode.parent` links from the node being expanded up to the root (each node now caches its
  own `zobrist: String`), and if a child's zobrist matches an ancestor, close it with a
  `transposition` terminal instead of continuing (`at_least_draw` only; `win` is untouched, as
  specified). Cross-branch sharing as a search-size optimization is left undone; per this stage's
  own "If it fails" guidance ("prefer candidates with locked pawns, few legal moves"), seed FENs
  are picked for small search trees rather than relying on dedup to tame large ones.
- **2026-07-08 — `canonicalize` version:** pinned `^3.0.0` (latest on the registry), not the
  originally-guessed `^2.0.0` — check the actual registry before pinning next time.
- **2026-07-08 — `evals.nodes` stays `integer`:** the drafted plan to widen it to `bigint`
  assumed future overflow risk that doesn't exist — int4's ~2.147B ceiling is nowhere near any
  realistic single-position node count (canonical ladder tops at 64M). Skipped as scope creep
  that wasn't fixing a real defect.
- **2026-07-08 — `positions`/`games` aren't mutually referential:** tracing the actual FK graph
  found a clean DAG, not the circular reference the draft plan assumed — reordering table
  declarations (dependency-first) was sufficient, no `AnyPgColumn` escape hatch needed.
- **2026-07-08 — root-level `drizzle-orm` dependency:** added so `scripts/*.mjs` (this stage's
  `db-smoke.mjs`, and every later-stage ops script that touches the DB directly) can resolve it
  — pnpm's per-package `node_modules` isolation means a script physically at repo-root
  `scripts/` can't see a workspace package's own dependencies merely by importing that
  package's dist output via a relative path; only the workspace package's *own* files can.
- **2026-07-08 — Docker Desktop started:** it was stopped at session start (a prior session had
  paused it deliberately); starting it was necessary to actually run and verify the Stage 1.4
  migrations against a live Postgres instead of only reading the generated SQL. Left running.
- **2026-07-08 — `@typescript-eslint` version:** pinned `^8.63.0` (latest), not the drafted
  `^7` — check the actual registry/peer-dep range before pinning, same lesson as `canonicalize`.
- **2026-07-08 — shared eslint config was dead code:** `packages/config/eslint.config.js` had a
  real bug (string `parser` invalid in flat config) that nothing ever caught because no package
  actually consumes it — `apps/web` lints via `eslint-config-next` instead. Fixed the bug and
  the dependency declaration; did *not* retrofit `lint` scripts onto the five packages that
  don't have one, since that's a separate scope decision for whichever stage first needs it.
- **2026-07-08 — added `rustfmt.toml` (`tab_spaces = 2`)** rather than reformatting the whole
  codebase to rustfmt's 4-space default — the project's established style is 2-space, and CI's
  new `cargo fmt --check` step needs to validate against that, not fight it.
- **2026-07-08 — Tier C fortress mechanism: non-adjacent-file pawn chains, not this doc's
  suggested family.** `8/8/2k5/ppp5/PPP5/2K5/8/8 w - - 0 1` (and several king-placement variants
  of it) validated as a **win**, not a draw, on the Lichess endpoint — the open ranks in front of
  an *adjacent*-file pawn wall (3-wide, e.g. a/b/c) give the attacking king's AND-node full-width
  board access to infiltrate around either flank, which also made naive attempts at this pattern
  blow the 500k-2M node search budget without proving anything (both the win/loss outcome *and*
  the tree-size explosion point the same way: this family just isn't a fortress). The mechanism
  that actually works: pawns on **non-adjacent** files (b/d/f or every-other-file), which removes
  every diagonal capture — with zero legal captures for either side, the only legal moves are
  king shuffles, so the proof is forced to close by repetition rather than ever reaching a
  tablebase leaf. Cross-validated one candidate two ways: Lichess's per-move heuristic for the
  root position lists the proof's actual chosen move (`h1g1`) as `"category": "draw"` while the
  alternatives are `"maybe-loss"` — the search and independent chess judgment agree not just on
  the outcome but on which move holds it.
- **2026-07-08 — Stage 2 (M2 fortress track) complete.** All of 2.1-2.4 done: Syzygy tablebases
  fetched, prover `at_least_draw` + TB oracle + transposition terminals, verifier real Syzygy
  probing, 10 committed fortress certs (4 Tier A + 3 Tier B + 3 Tier C) all verifying clean.
  Milestone M2 is done. Next up per this roadmap is Stage 3 (`services/analysis` UCI worker).
- **2026-07-16 — Redis over a client cookie for pending PKCE state:** the pending code_verifier
  only needs to survive between `/bff/lichess/oauth/start` and lichess's own redirect back to
  `/journey/connect/callback` — lichess echoes `state` verbatim, so looking that up in
  `context.redis` (already wired) is sufficient and avoids adding a second, CSRF-relevant cookie
  to `apps/web` purely to shuttle a value it never needs to read itself.

## Deferred / post-launch

- **Real calibration run:** 100k Lichess-elite positions (plies 10–80) through the canonical
  ladder ≈ 90 s/position ⇒ ~104 CPU-days serial, ~9 days at 12× parallel — schedule post-launch
  (or calibrate the quick-tier fingerprint first); output = new `CalibrationData` for
  `packages/fog/src/calibration.ts` + the ~200-position QA gate from the methodology doc;
  replaces the placeholder in a minor release and drops the provisional labels.
- ~~**Lichess OAuth (PKCE, no app registration)**~~ **Done 2026-07-16.** "Connect account" flow
  shipped: `services/analysis/src/import/lichessOAuth.ts` (PKCE + the lichess.org token/account
  calls), two new BFF routes (`/bff/lichess/oauth/start` + `/callback`, pending-state in Redis,
  keyed by state, single-use), AES-256-GCM token-at-rest encryption
  (`apps/api/src/lichessOAuth.ts`, `TOKEN_ENCRYPTION_KEY`, no dev-fallback), and a signed session
  cookie (`apps/web/src/lib/session.ts`) driving connect/disconnect controls on `/journey`. The
  existing unauthenticated manual-username import path is unchanged — connecting is an identity
  convenience (prefills the input), not a new privilege boundary, since `/bff/import` already
  accepts any public username. Verified live against real `lichess.org` endpoints (real 400 on a
  fake code, real Redis TTL, single-use replay rejection); no code path yet reads the stored
  token back (nothing needs it while game export stays public/unauthenticated).
- ~~**Verifier `--tb-endpoint`**~~ **Done 2026-07-16.** `rust/verifier/src/tb_endpoint.rs` adds
  `EndpointTbOracle`, probing a Lichess-compatible tablebase HTTP API (`ureq`, blocking, no
  runtime needed since the whole CLI stays synchronous) instead of local Syzygy files. The
  endpoint's own `category` field already reports the clock-adjusted 7-valued WDL directly, so
  it's a straight string mapping, not a DTZ reimplementation — same `wdl_matches` soundness table
  as `--syzygy`, wired through a new `TbBackend` enum (`tb.rs`) so `semantic.rs` doesn't care
  which source answered. `--syzygy` takes precedence if both flags are passed (warns); `--offline`
  still overrides either. Verified live against the real `https://tablebase.lichess.ovh/standard`
  endpoint: a real fortress cert verifies `Valid: true, Probes: 1` with no local tablebase files
  present at all, and a tampered copy (`win` claim flipped onto a real draw) is correctly rejected
  by the live probe. No automated test hits the network (matches this repo's standing convention
  of not unit-testing real network calls); `category_to_wdl`'s pure string mapping is unit tested.
- ~~**zstd container (`PNBC` magic) + transposition-aware win certs**~~ **Done 2026-07-17.**
  `rust/verifier/src/container.rs` adds `decode_certificate_bytes`: no `PNBC` prefix -> read as
  plain JSON exactly as before (every certificate written to date), `PNBC` + zstd frame magic ->
  decompress, `PNBC` + anything else -> plain JSON. `rust/verifier/src/main.rs`'s `verify`/`inspect`
  switched from `fs::read_to_string` to raw-byte reads through this decoder. `rust/prover/src/
  container.rs` mirrors the writer (`encode_certificate_container`); `penumbra-prove -o` now
  writes `PNBC`-prefixed plaintext by default and `PNBC` + zstd with the new `--compress` flag
  (stdout output is untouched, still plain JSON, since `--compress` only affects file output).
  Separately, `rust/prover/src/pns.rs`'s `emit()` now dedupes certificate nodes by zobrist: the PNS
  search arena is a strict tree (every expansion gets a fresh node even when it transposes into a
  position seen elsewhere), so without this a proof revisiting the same position from multiple
  branches serialized that subtree once per occurrence. `emit` now caches zobrist -> emitted node
  id and points every later occurrence's `child_id` at the first one instead of re-emitting a
  duplicate, shrinking certificates for lines with real transpositions. This is a serialization-time
  change only — the search itself is untouched, so it can't introduce the graph-history-interaction
  unsoundness that merging transpositions mid-search is prone to. The verifier needed no changes:
  `dfs_check_acyclic`'s `visited`/`rec_stack` split and `semantic.rs`'s `verify_node`'s global
  `ctx.verified` memo already treat a shared node id referenced from multiple parents as a normal
  DAG reconvergence, not a cycle. Verified against the real CLIs (not just unit tests): a plain and
  a `--compress`ed certificate for the same position both verify identically, and a checked-in
  pre-existing example cert with no `PNBC` prefix at all still verifies — confirming "old
  certificates remain verifiable forever" holds in practice, not just in the spec.
- **Remaining Phase 2 items** (per CERTIFICATE_FORMAT.md): signatures / attestation, work-unit
  federation ("Fleet") — deferred pending a concrete multi-contributor scenario to design against;
  no existing code/infra for either.
- ~~**`missed_proofs` beyond the ≤8-men v1 scope**~~ **Done 2026-07-16.** The v1 gate skipped any
  parent position above 8 pieces before even enumerating its children -- but a `proofs` row isn't
  piece-count-bounded at all (a transposition into an already-proven fortress can happen at any
  material count), so that cutoff was silently missing real misses outside the endgame. Removed
  the parent-side gate entirely; `detectMissedProofs` (`services/analysis/src/pipeline/proofEntry.ts`)
  now calls its predicate once per ply with every legal child in one batch instead of once per
  child gated by piece count. `analyzeGame.ts`'s `findProvenWinningMoves` backs it with two batched
  queries per ply (`positions`/`proofs` via `inArray`, matching this repo's first use of that
  operator) plus a tablebase fallback restricted to `SYZYGY_MAX_PIECES` candidates -- so this never
  adds one DB round trip per candidate move (which would have been the naive fix, and expensive
  during the opening/middlegame's wider branching factor), and never probes the network for
  material outside TB range. `MISSED_PROOF_MAX_PIECES` is gone; nothing else referenced it.
- ~~**`packages/db` seed script**~~ **Done 2026-07-16** (`85d9b99`) — `packages/db/src/seed.ts`
  seeds a dev user/api-key/demo game, idempotent.
