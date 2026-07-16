# Penumbra Phase 1 Implementation Progress

## Overview

This document tracks the implementation status of Penumbra Phase 1 (MVP). The work is organized by milestone and includes both completed components and next steps.

**As of:** 2026-07-11  
**Status:** Phase 1 MVP complete. Stages 1–7 all done: license split (GPL-3.0-or-later verifier+prover, Apache-2.0 spec), GitHub release (verify-v0.1.0 with all three platform binaries verified), crates.io publish (penumbra-verify v0.1.0 live), CI fixed (Playwright suite renamed), methodology finalized. Production deploy deferred per user choice (no real infra target yet). All verified end-to-end against real infra — see `docs/ROADMAP.md` for the complete narrative.  
**Commits shipped:** 57

## Completed milestones

### ✅ M0: Foundations (1.5 weeks)

**Objective:** Establish development infrastructure and core packages.

**Delivered:**
- Git repository initialized with authorship conventions (zero AI attribution)
- Pre-commit hook enforces clean commit history
- Monorepo structure: pnpm workspaces + Turbo + Cargo workspace
- Docker Compose for local services (Postgres, Redis, Minio)
- GitHub Actions CI pipeline (build, test, lint, type-check)
- TypeScript + ESLint + Prettier configuration
- `packages/core`: domain types, EPD normalization, Polyglot Zobrist hashing
- Rust verifier and prover crate stubs

**Key decisions:**
- TypeScript for web/API/services, Rust for verifier/prover
- Single-threaded deterministic evaluation (canonical mode)
- Append-only data model for eval history (archaeology)

### ✅ M1: Certificate + Verifier (3 weeks, complete and verified)

**Objective:** Define proof certificate format; build verifier CLI.

**Delivered:**
- Certificate format v0.1 spec (`docs/CERTIFICATE_FORMAT.md`, comprehensive)
- JSON Schema + TypeScript types (`packages/cert-schema`)
- JCS canonicalization (RFC 8785) + integrity checking
- Validation framework for certificates
- Rust verifier CLI (`penumbra-verify`):
  - Load and parse JSON certificates
  - Structural validation (node kinds, move coverage, zobrist)
  - Cycle detection (acyclic check for win certificates)
  - Golden test certificate (KQPK, 4-piece tablebase)
  - Mutation tests (missing child node, cycle in win)
- `verifier verify cert.pnbcert [--syzygy DIR | --offline]` command
- Integration test suite (`rust/verifier/tests/verify_certificates.rs`) wired into `cargo test`: golden certificate verifies clean, both mutation certs fail with the expected errors, unsupported format versions are rejected
- CLI now exits 0 on a valid certificate and 1 on an invalid one (previously always exited 0 regardless of validity)

**Still needed:**
- External spec review and public announcement

### ✅ M3: Fog Index v0.1 + UCI orchestration (complete)

**Objective:** Implement the Fog Index metric, calibration, and the engine orchestration worker
that actually produces evals from real engines.

**Delivered:**
- `packages/fog`: complete formula implementation
  - Components: disagreement (SF vs. Lc0), depth volatility, move criticality, tablebase distance, proof gate
  - Score: `Fog = round(100 · g · (0.30·d + 0.25·v + 0.25·c + 0.20·t))`
- Engine fingerprinting (SHA256 hash of canonical settings)
- Calibration CDF (100k position corpus, percentile lookups)
- Comprehensive methodology documentation (`docs/FOG_INDEX_METHODOLOGY.md`)
- Deterministic, reproducible formula (single-threaded fixed-node search)
- `services/analysis` (`@penumbra/analysis`, 2026-07-09): the UCI worker itself —
  `UciClient` (spawn + line protocol over real Stockfish/Lc0 subprocesses, timeout guards,
  Windows-safe kill), a pure `parseInfoLine`/`parseBestMove` parser unit-tested against
  committed real engine transcripts, engine adapters producing the exact `EngineEvals` shape
  `packages/fog` needs with WDL normalized to White's perspective in one place, the full
  `analyzePosition` pipeline (position upsert, append-only `evals`/`fog_scores` writes, a
  direct-children proof gate via real chess move generation), a BullMQ queue/worker split by
  tier (canonical concurrency 1, quick concurrency 2), and a `cli.ts`/`repro-test` pair. Verified
  end-to-end against real Postgres + real engine binaries, not just unit tests: the `analyze`
  CLI produces real fog JSON and the expected DB rows, and `repro-test` confirms byte-identical
  output across repeated runs.
- `scripts/fetch-engines.mjs` + `docs/ENGINES.md`: pinned, sha256-verified Stockfish 18 and Lc0
  v0.32.1 downloads. The Lc0 backend/network/node-count pin took real investigation, not the
  roadmap's original assumption — see below.

**Real-world finding that reshaped the Lc0 pin:** the roadmap assumed an explicit CUDA backend
(`cuda-fp32`) would give deterministic GPU evals, falling back to a CPU backend if not. In
practice: `cuda-fp32` doesn't exist on the pinned build; the closest explicit CUDA backend
(`cuda`) proved non-deterministic across repeated runs at fixed node counts (confirmed via
`repro-test`, including with `MinibatchSize=1` to rule out batching races — residual cuBLAS
kernel-selection nondeterminism, not fixable via UCI options); the CPU (`blas`/OpenBLAS) backend
is deterministic but per-node cost turned out dominated by backend overhead rather than network
size (a ~380MB top-tier net and a ~19MB legacy net both took minutes per 30k-node search on this
hardware). Net result: CPU backend + a modern "distilled" network (small but trained to
approximate a much larger net) + node count reduced from the spec'd 30k to 2k (~30s/search,
user-approved tradeoff) — full timing data and reasoning in `docs/ENGINES.md`.

### ✅ Database schema (partial, ~2 weeks)

**Objective:** Define and implement the persistent data model.

**Delivered:**
- `packages/db`: Drizzle ORM schema
- Append-only tables for `evals` and `fog_scores` (trigger enforcement still to be written as a migration)
- Positions table with Zobrist indexing (EPD is truth key)
- Games, game_positions, proofs, ledger_entries, users, api_keys
- Indexes for common queries (zobrist, game_id, position_id, timestamp)
- Initial migration generated (`packages/db/migrations/0000_*.sql`, 11 tables) via `pnpm run db:generate`

**Still needed:**
- Database initialization/seed scripts (`./seed` export declared in `package.json` but no `src/seed.ts` yet)

Migration apply and append-only triggers are now done — see the hardening pass below.

## Hardening pass (2026-07-08)

Before building anything further on top of the certificate/zobrist/DB layers, five verified
defects were fixed (full detail and rationale in `docs/ROADMAP.md` §Stage 1):

- **`penumbra-verify` now does real semantic verification**, not just structural shape checks:
  it replays every move against the claimed FEN with shakmaty, checks AND-node coverage is
  exhaustive, and confirms terminals are truthful (checkmate really is checkmate, etc.).
  Previously a cert with a fabricated zobrist or an incomplete opponent-reply set would still
  report `valid: true`. The old `tests/golden/kqpk.json` fixture — hand-faked, not a real proof
  — now correctly fails semantic verification and stays only as a structural-only fixture; the
  two real prover example certs became the new semantic goldens.
- **`packages/core`'s zobrist hashing is now real Polyglot**, not a homegrown LCG that could
  never match the hashes shakmaty stamps into certificates. The Random64 table is extracted
  directly from shakmaty's own source rather than retyped, and cross-checked against the Rust
  side via a shared fixture (`packages/core/test-fixtures/zobrist-vectors.json`) asserted from
  both `zobrist.test.ts` and `rust/verifier/tests/zobrist_vectors.rs`.
- **Certificate identity hashing is now real RFC 8785** on both sides (`canonicalize` in
  TypeScript, key-sorted `serde_json::Value` re-serialization in Rust), cross-checked via
  `packages/cert-schema/test-fixtures/hash-vectors.json`. `penumbra-verify verify`/`inspect`
  both print the computed `SHA256:`.
- **The DB schema's foreign keys are now real**: every FK-ish column was `bigserial` (each
  silently creating its own sequence instead of referencing anything); they're `bigint` +
  `.references()` now. Append-only triggers block UPDATE/DELETE on `evals`, `fog_scores`, and
  `ledger_entries` at the database level. **Migrations were applied to a live Postgres instance
  for the first time in this project's history** and verified end-to-end with
  `scripts/db-smoke.mjs` (real insert chain, both triggers, the FK constraint, all exercised
  live, not just inspected as generated SQL).
- **CI is genuinely green for the first time** (verified on GitHub, not just locally — see
  [run 28947002453](https://github.com/srikantlose/Penumbra/actions/runs/28947002453)): it
  previously couldn't pass as written (wrong cargo working directory, a pnpm version pin
  conflicting with `packageManager`, node 18). Fixed, plus a `rustfmt.toml` pinning the
  project's actual 2-space style so `cargo fmt --check` validates against reality instead of
  the entire codebase. Getting an actual green run additionally caught two bugs invisible to
  local testing (turbo's `type-check` task wasn't building workspace dependencies first;
  `packages/fog`'s empty-glob test script only failed on the Node version CI pins, not the
  newer one used for all local testing this session) — full detail in `docs/ROADMAP.md`'s
  Stage 1 close-out notes.

## In-progress and next steps

### 🟡 M2: Prover + Fortress seeds (3 weeks, PNS core delivered)

**Delivered (2026-07-08):**
- Real proof-number search over AND/OR trees in `rust/prover` (`src/pns.rs`),
  replacing the stub. OR nodes (claiming side) proved if any child wins; AND
  nodes (opponent) proved only if every legal reply is covered. Terminals are
  recognised directly — checkmate → win, stalemate/insufficient-material → not
  a win — so no external tablebase is needed for forced mates.
- `penumbra-prove` CLI (`src/main.rs`): `prove "<FEN>" [--side] [-o] [--max-nodes] [--time-ms]`,
  exit 0/1 on proved/not-proved, certificate to stdout or file.
- Proof-tree extraction to the v0.1 `.pnbcert` format (`src/certificate.rs`):
  OR nodes emit the one winning move, AND nodes emit all replies, leaves emit
  checkmate terminals. Certificates are acyclic by construction (a forced mate
  makes monotonic progress), satisfying the verifier's `win` acyclicity rule.
- Round-trip integration test (`tests/prove_and_verify.rs`, 6 tests): proves a
  set of known mates, serializes each certificate, and feeds it straight through
  `penumbra-verify`, asserting the report is valid. Includes a black-to-move
  case and negative cases (dead draw → no certificate; bad FEN → error).
- Reference certificates in `rust/prover/examples/`: back-rank mate-in-1,
  Morphy's mate-in-2 (one AND node covering all 7 black replies, 16 nodes /
  7 terminals), and a two-rook mate — each verifies clean.

**Scope note:** the deliverable is **self-contained forced-mate WIN
certificates** — a genuine end-to-end prove→verify loop. This is the core PNS
milestone. The remaining M2 items below are follow-on because they need
inputs the search doesn't yet model:

**Still needed:**
1. Fortress / `at_least_draw` certificates — need Syzygy tablebase terminals or
   repetition/50-move closure (the search currently only bottoms out at mates)
2. Syzygy tablebase probing in both prover (as leaf oracle) and verifier
3. Generate ~10 fortress seed certificates (min 5) and verify against Syzygy

### ✅ M4: Game import + analysis (complete, live acceptance gate passed)

**Delivered (2026-07-09):**
- `services/analysis/src/import/lichess.ts` — public NDJSON game export (no OAuth
  needed for public games), single-game export, non-standard-variant and
  missing-`pgn` filtering.
- `src/import/pgn.ts` — chessops-based `extractPositions`/`extractGames` (ply 0 =
  startpos convention, documented and reused everywhere positions are enumerated
  from a game).
- `src/import/persist.ts` + `importGame.ts` — `upsertGame`, the `positions`
  counter-table upsert (`occurrence_count` bump, `first_seen_game_id` set only on
  first insert), bulk `game_positions` insert.
- `src/pipeline/analyzeGame.ts` — creates the `analyses` row, enqueues every
  position for engine scoring (quick tier by default; deep games run at
  canonical tier with a lower BullMQ priority so they don't jump ahead of ad hoc
  canonical requests), waits on results via BullMQ's `QueueEvents`, assembles the
  fog timeline, and updates the row to `status: 'done'`.
- `src/pipeline/proofEntry.ts` — proof-entry-ply and missed-proofs (v1 scope:
  piece count ≤ 8, direct legal-move children only) detection, with the DB
  lookups injected as predicates so both are unit-testable against a synthetic
  endgame PGN without a live database.
- `packages/db/src/truth.ts` — `deriveTruthStatus`, the single shared
  EVALUATED-vs-PROVEN decision (proof exists, or piece count ≤ 7 and a
  `tb_probes` row exists), split into a pure function plus a thin DB-fetching
  wrapper. `services/analysis`'s Stage 3 position pipeline was retrofitted to
  call it too, removing what had been a private duplicate of the same check.
- `src/tablebase/lichess.ts` + `populate.ts` — the `tb_probes` population step
  Stage 3 explicitly punted ("populate in Stage 4+"): probes
  `https://tablebase.lichess.ovh/standard?fen=…` on cache miss for positions
  ≤ 7 men, normalizes the result to White-perspective WDL (reusing the
  pipeline's one WDL-flip point) + DTZ, and caches it in `tb_probes`.
  `cursed-win`/`blessed-loss` are stored as draws (the 50-move rule makes them
  practical draws in real games); `unknown`/`maybe-win`/`maybe-loss` cache
  nothing. Wired into both proof-entry-ply detection and missed-proofs' "proven
  win for the mover" check, which previously only consulted the `proofs` table.
  Local Syzygy probing (≤ 5 men) is still deferred — Lichess's endpoint already
  covers the full ≤ 7-man range this system checks, so it's a latency/coverage
  optimization, not a functional gap.
- CLI: `run import -- --user <name> --max <n>`, `run import -- --pgn <file>`,
  `run analyze-game -- --game-id <id> --tier quick`.
- Unit tests (no network, 56 total across the two packages): a hand-verified PGN
  fixture covering castling + en passant + promotion with a known 31-ply count;
  an NDJSON fixture exercising the variant/missing-pgn filters; a synthetic
  6-man-to-5-man endgame PGN (verified move-by-move against chessops) driving
  both proof-entry-ply and missed-proofs detection with mocked TB-probe/proof
  predicates; `deriveTruthStatus`'s own pure-logic table; the tablebase
  category-to-WDL mapping (including the White-perspective flip and the
  cursed-win/blessed-loss-as-draw simplification).

**Live acceptance gate (2026-07-10):** `run import -- --user DrNykterstein --max 5`
against the real Lichess API (5 real games, ids 4-8), then
`run analyze-game -- --game-id 7 --tier quick` against a running worker.
DB spot-checks: `analyses` row `status='done'`, 49-entry `fog_timeline`,
`engine_fingerprint` set, `completed_at` set; `proof_entry_ply` correctly
`null` (this game never reached ≤7 men before mate).

Two real bugs only surfaced once a full real game ran end-to-end against
the live worker (never exercised live before this session — see Stage 3's
handoff note); both fixed and covered by the existing test suite:
- **BullMQ colon rejection** (pre-existing Stage 3 bug, never triggered until
  this was the first live run of `queue/worker.ts`): this installed BullMQ
  version rejects `:` in both queue names and custom job IDs. Fixed
  `queueNameForTier` (`analyze-position:${tier}` → `analyze-position-${tier}`)
  and `analyzePositionJobId`'s separator (`:` → `__`).
- **Per-job wait ttl counted from enqueue time, not job start:** a flat
  10-minute `waitUntilFinished` ttl could expire on a position still
  legitimately queued behind ~40 others in a 49-ply game. Now scales with
  the game's own position count.
- **Checkmate/stalemate positions had no engine path:** a position with zero
  legal moves makes Stockfish report no `wdl`, which `runStockfishLadder`
  correctly turned into a thrown error — but `analyzeGame.ts` had nothing
  upstream to catch that for a real game's final position. Now detected
  before enqueueing and given a certain, zero-fog `PROVEN` timeline entry
  directly, skipping the engine entirely (chess rules guarantee it can only
  ever be the last position in a game).

A separate, non-reproducing anomaly was investigated at length during this
same session: an initial live run saw ~21 `stockfish.exe` process crashes
(Windows `STATUS_INTEGER_DIVIDE_BY_ZERO`) across many different positions.
Extensive isolated repro attempts (raw concurrent Stockfish spawns, the full
production ladder sequentially and concurrently across all 49 real
positions, the real `analyzePosition()` pipeline with sustained concurrency)
never reproduced a single crash. The eventual, most likely explanation:
Docker Desktop's idle auto-pause froze Postgres/Redis mid-run partway
through this same investigation (confirmed via `docker desktop status` and
a Postgres `terminating connection due to administrator command` error) — a
VM freeze/thaw cycle disrupting host process scheduling mid-search is a
plausible cause for a stray native crash that no controlled test could
reproduce. Not treated as a code bug; no fix applied beyond running the
final verification pass with a Docker keep-alive guard.

### ✅ M5: Web UI (positions, Frontier map) (complete, live-verified against real `apps/api`)

**Scaffolded (2026-07-07):** `apps/web` stood up as a real workspace package — Next.js (App
Router) + Tailwind, wired into `@penumbra/config`. Route skeleton only (`/`, `/board`, `/fog`,
`/positions`, `/frontier`), each rendering a placeholder `ScreenSlot` component pending real
designs. No visual/design decisions made (per standing rule to defer to user-provided styles).
A Google Stitch → code import pipeline is staged (`.mcp.json`, community MCP server vendored
under gitignored `tools/`); the MCP connects and can list projects, but its API key can't
authenticate the screen-content endpoints (Google requires an OAuth2 token there), so screens are
being imported manually (Stitch UI → code export → pasted in) instead — see
`docs/DEVELOPMENT.md` for setup.

**First import:** `apps/web/src/components/stitch/ShaderBackground.tsx` — a persistent,
mouse-interactive WebGL canvas background from the user's Stitch project ("Interactive Midnight
Interface"), mounted once in the root layout so it survives route navigation. Verified rendering
correctly (real WebGL context, zero console errors, content layers above it) via a Playwright
screenshot check.

**Design system decided (2026-07-08):** the project's Stitch designs turned out to contain two
conflicting visual directions — a colorful "academic dark serif" system (from the project's
`designMd`) and a stark monochrome black/white 8-bit retro system (`Press Start 2P` everywhere,
0px border radius, dithered checkerboard fills, click-triggered screen-shake + pixel-spark
effects). User confirmed **retro B&W is authoritative**. Wired as the shared baseline in
`apps/web/tailwind.config.ts` (colors/radius/spacing/fontFamily/fontSize tokens) and
`globals.css` (dither patterns, shake/spark keyframes). Home page (`/`) now holds real landing
content (hero, Fog gauge, 3 feature cards) instead of the placeholder. `TopNavBar`, `Footer`, and
`ClickEffects` (screen-shake + pixel-spark, sitewide per user's choice) are mounted in the root
layout so they apply across every route. Verified via Playwright: fonts resolve correctly, click
effects fire (shake class + 8 spark elements), zero console errors.

**Known issue:** the logo `<img>` src is a Stitch-hosted preview URL
(`lh3.googleusercontent.com/aida/...`) that fails to load cross-origin (`ERR_BLOCKED_BY_ORB`) —
these are ephemeral/CORP-restricted, not meant for hotlinking. Needs a real logo asset downloaded
and hosted locally (`public/`) before this ships. A second Stitch-hosted image (a user avatar on
the Analysis page) has the same problem.

**Analysis/board screen imported (2026-07-08):** `/board` now holds the real Analysis page —
persistent `EngineSidebar` (analysis-scoped, not sitewide), static demo chessboard with a
radial-gradient "fog" vignette, Fog Timeline bar, Fog Index + Truth Status cards, an Engine
Ladder table, and an Archaeology List with PROVEN/EVALUATED move badges. `TopNavBar` gained
real active-tab awareness (`usePathname()`) — ANALYSIS now underlines correctly on `/board`.

This screen's own embedded design tokens (JetBrains Mono, soft dark-gray palette) **conflicted**
with the locked retro B&W/Press-Start-2P system — per standing instruction, the layout was kept
but remapped onto the existing shared tokens rather than adopting this screen's values. Doing so
surfaced a real bug: a 2-column stat grid ("Disagreement/Volatility/Criticality") that fit fine
in the original's narrower JetBrains Mono started visually overlapping/garbling text
(`Press Start 2P` is much wider per character) — fixed by switching that block to stacked
`flex justify-between` rows at the design system's standard `data-mono` size. Lesson: importing
future screens onto the locked system needs a check for exactly this kind of overflow, not just a
class-name find/replace.

**Remaining routes built out from spec, not from screens (2026-07-08):** user clarified that
imported Stitch screens are a **style reference only** — specific buttons/tabs/nav items are
disposable, and pages without a matching screen shouldn't wait on one. Built directly from
`PROGRESS.md`/`docs/DEVELOPMENT.md`'s own feature descriptions and the real methodology docs,
in the locked design system:
- **`/frontier`** — the Frontier Map: a jagged SVG "coastline" (proven territory above, fog
  below) with a canvas-drawn noise texture (`FrontierCanvas.tsx`) over the fog region, plus a
  few landmark markers (`KPvK`, `KRvKB`, the 7-piece tablebase boundary) tying it directly to the
  Fog Index's tablebase-distance component.
- **`/positions`** — position detail: FEN + Zobrist header, provenance panel, reused
  `FogIndexCard`/`TruthStatusCard` (see below), an eval-history table, and a proof-reference
  panel with a download-certificate button.
- **`/proofs`** (new route, not in the original stub set) — certificate table (claim/FEN/SHA256)
  plus a hash-chained ledger list, pulling real field names/format from
  `docs/CERTIFICATE_FORMAT.md`.
- **`/methodology`** (new route) — the actual Fog Index v0.1 formula, all five components with
  their real formulas, the real calibration percentile table, and the certificate format's
  AND/OR/cycle-discipline rules — sourced directly from `docs/FOG_INDEX_METHODOLOGY.md` and
  `docs/CERTIFICATE_FORMAT.md`, not invented.
- **Removed `/fog`** as a standalone route — redundant with the Fog Timeline already embedded
  contextually on `/board`, and not a real nav destination.
- Extracted `FogIndexCard` and `TruthStatusCard` as shared components (now used on both `/board`
  and `/positions`) rather than duplicating the same markup a second time.
- **Real bug fixed:** `TopNavBar` was using plain `<a>` tags for internal routes, which forces a
  full page reload on every nav click — tearing down and restarting the WebGL shader background
  each time, undermining the "persistent across every screen" requirement. Switched to `next/link`
  so the root layout (and the shader) stays mounted across client-side navigation. Also made the
  logo a `Link` back to `/`.
- `PROOFS` and `METHODOLOGY` nav tabs now point at real routes instead of `#`.

**Stage 6 — wired to the real API (2026-07-11):** all six pages now render live data from
`apps/api` instead of hardcoded consts, plus a new personal-journey page. `docs/ROADMAP.md`
Stage 6.

- `src/lib/api.ts` — typed fetch helpers for every `apps/api` endpoint consumed. Server
  components fetch directly (no client-side loading state needed); `/bff/import` is
  server-only (reads `PENUMBRA_API_KEY`, a non-`NEXT_PUBLIC_` env var, so the key never
  reaches the browser — only ever called from a Server Action).
- `/` ← `GET /bff/stats`: real hero numbers (positions mapped, proofs published, ledger
  height) and a real median-Fog gauge.
- `/board` — the FEN input, fog poll, engine ladder, and archaeology list are now a client
  component (`BoardAnalysis.tsx`) computing the zobrist client-side (`@penumbra/core`, added
  as a new `apps/web` dependency, reusing the exact same Polyglot hash the backend uses rather
  than inventing a second implementation or growing the API's response contract) and polling
  `GET /v1/fog` with the server-given `retry_after_ms` backoff (`useFogPoll.ts`). The static
  demo chessboard visualization and player headers are unchanged — rendering a real position
  from FEN was out of scope. Reused real data honestly: `evals` rows have no stored move
  notation (that lives in `game_positions`, tied to a game, not a bare position), so "Engine
  Ladder" and "Archaeology List" show real per-fingerprint eval rows and real proof
  references instead of fabricating move labels the API doesn't have.
- `/positions` is now a search box (FEN or zobrist, computing the zobrist client-side same as
  `/board`) + a real recently-seen list, and `/positions/[zobrist]` (new dynamic route) shows
  a real position's provenance, fog, truth status, full append-only eval history, and proof
  refs, 404-ing cleanly for an unknown zobrist.
- `/frontier` ← `GET /bff/frontier`: the illustrative coastline SVG stays (per the roadmap),
  but its four landmark labels now show real proven/total counts per piece-count band.
- `/proofs` ← `GET /v1/proofs` + `GET /v1/ledger`: the real certificate table and hash chain,
  with a working per-cert download link (presigned minio URL).
- `/methodology` ← `GET /v1/meta/methodology`: real engine pins and both tier fingerprints;
  the formulas and calibration percentile table stay static (the percentile table is itself a
  fixed spec constant right now, not something the API recomputes). Added the
  provisional-calibration label here and on `FogIndexCard` per the roadmap's explicit
  instruction.
- **`/journey` (new)** — username → `POST /bff/import` (a Next.js Server Action) → real
  imported-game list → each game's real fog timeline (`GET /v1/games/{id}`, new endpoint, see
  below) rendered through a `FogTimelineBar` component extracted so `/board`'s static demo
  timeline and `/journey`'s real per-game timeline share the same markup, with a proof-entry
  marker. Games with no `analyses` row yet (import doesn't trigger analysis — that's still a
  separate CLI step per Stage 4) honestly show "not yet analyzed" instead of a fake timeline.
  Live-verified end to end: imported 10 real games for `DrNykterstein`, and the one game
  already analyzed during Stage 4's own acceptance gate (game id 7) rendered its real 49-ply
  fog timeline correctly.
- Two small, justified additions to `apps/api` (not in Stage 5's original route table):
  `GET /v1/positions` (recent-list, backs the `/positions` index page) and
  `GET /v1/games/{id}` (game + its latest `analyses` row, backs `/journey`'s timeline). Both
  covered by existing conventions (zod schemas, same auth/rate-limit hooks).
- Local B&W pixel-art assets replace both dead `lh3.googleusercontent.com` hotlinks: a
  dithered crescent-moon logo and a generic avatar silhouette, both hand-authored SVGs (not
  PNGs as the roadmap literally named — same "locally hosted, no network dependency" goal,
  chosen because it's something reliably authorable as text rather than needing an image
  generation dependency) built from a small pixel-grid generator script, not copied from
  anywhere. The avatar now also fills `/board`'s two player-icon slots.
- Deleted the dead `ScreenSlot.tsx` (no route had used it since the spec-built pages landed).
- Playwright smoke suite (`apps/web/tests/*.spec.ts`, `playwright.config.ts`): all 7 routes
  render with zero console errors and a live WebGL context (the `ShaderBackground` check);
  proofs page shows ≥1 real cert; journey imports a real public Lichess account
  (`DrNykterstein`) end to end; a genuine 202→200 fog round trip against a fresh, never-seen
  FEN (26s against the real canonical-tier worker). **Not wired into `ci.yml`** — same call as
  Stage 4's own live acceptance gate: it needs docker Postgres/Redis/minio, a running analysis
  worker, fetched engine binaries (~1GB, gitignored), and a seeded dev API key
  (`scripts/seed-dev-api-key.mjs`, new — key issuance has no public endpoint by design, so
  this is the out-of-band local-dev provisioning step). Run by hand per the acceptance gate.
- Live-verified visually too, not just via the test suite: booted the real dev server, drove
  it with a headless-Chromium script, and eyeballed the actual screenshots (home, board,
  journey) — the locked B&W 8-bit design system, the crescent logo, and the dithered gauge all
  render correctly with real data.

### ✅ M6 (API half): `apps/api` (complete, live acceptance gate passed)

**Objective:** the public v1 API + BFF endpoints the web app needs, plus the hash-chained proof
ledger writer (`docs/ROADMAP.md` Stage 5, pulled ahead of the M5 web-wiring remainder because
Stage 6 consumes it).

**Delivered (2026-07-11):**
- `src/server.ts` — Fastify 5 + `fastify-type-provider-zod`, CORS scoped to the web origin,
  listens on `:3001`. `buildServer(context)` is importable standalone (no side effects), with the
  real `listen()` call guarded behind an is-main-module check so the test suite can boot the app
  without opening a socket.
- `src/schemas.ts` — every request/response as a zod schema in one file (the API contract).
- `src/plugins/auth.ts` — `X-API-Key` → sha256 → `api_keys.key_hash` lookup as a global
  `onRequest` hook; a present-but-invalid/revoked key 401s immediately, a missing key passes
  through anonymously, and `requireApiKey` gates the one mutating route.
- `src/plugins/rateLimit.ts` — `@fastify/rate-limit` with a Redis store: per-key
  `api_keys.rate_limit`/min when authenticated, 60/min per-IP anonymous, ordered after the auth
  hook so the bucket key reflects `request.apiKey`.
- `src/routes/fog.ts` — `GET /v1/fog` and `POST /v1/fog/batch`: latest **canonical**-tier
  `fog_scores` hit → 200 (truth status re-derived live via `deriveTruthStatus`, not trusted from
  the stored row, so a proof published after the score was cached still reports PROVEN); miss →
  enqueues onto the same `analyze-position-canonical` BullMQ queue and idempotent jobId Stage 4
  built, returns 202. (Public tier choice logged below.)
- `src/routes/positions.ts` — `GET /v1/positions/:zobrist`: position + provenance + full
  append-only eval history + latest fog + proof refs + live truth status.
- `src/ledger.ts` — the hash chain: `entry_hash = '0x' + sha256(prev_hash_bytes ||
  sha256(canonicalizeJSON(payload)))`, genesis `'0x' + '00'.repeat(32)`, tail row locked via
  `SELECT ... FOR UPDATE` inside a transaction (single-writer, per spec). `publishProof()` uploads
  the cert to minio (`proofs` bucket, `certs/<sha256>.pnbcert`), inserts the `proofs` row, and
  appends the ledger entry inside one shared transaction (a crash between the two can't leave a
  published-but-unledgered proof) — idempotent on `certificate_sha256`'s unique index.
- `src/routes/proofs.ts` / `routes/ledger.ts` — list/detail with presigned minio download URLs
  (signed locally, no network round trip), `since_seq`-filtered ascending ledger reads.
- `src/routes/bff.ts` — `/bff/stats`, `/bff/frontier` (aggregated by piece count, "proven"
  matching `deriveTruthStatus` exactly — a proof row, or a cached tablebase probe within
  `SYZYGY_MAX_PIECES`), and `/bff/import` (API-key gated, reuses Stage 4's `importGame`/
  `streamUserGames` synchronously — see decisions below).
- `src/routes/meta.ts` — `GET /v1/meta/methodology`: formula version, weights, engine pins, both
  tier fingerprints, and the `provisional-placeholder` calibration label.
- `scripts/publish-proofs.mjs` / `scripts/verify-ledger.mjs` (root-level, alongside
  `scripts/db-smoke.mjs`) — publish every committed example + fortress cert
  (`rust/prover/examples/`, upserting each one's position row since they're synthetic prover
  fixtures, not positions from a real import) and walk the whole chain recomputing every hash.
- Tests: `src/ledger.test.ts` (pure, fixed-payload unit tests — determinism, payload/prevHash
  sensitivity, JCS key-order insensitivity) + `src/server.test.ts` (18 `fastify.inject()`
  integration tests against the real docker Postgres/Redis: fog 200/202 with a mocked BullMQ
  queue, positions detail, proof publishing + full ledger-chain verification, 401 auth paths, and
  a real 429 once the anonymous rate limit is exceeded).

**Live acceptance gate (2026-07-11):** real docker Postgres/Redis/minio, `pnpm --filter
@penumbra/api build && node dist/server.js` on `:3001`. `curl /v1/fog?fen=<startpos>` → 202,
confirmed real 200 with a computed score once the Stage 4 worker drained the canonical-tier job
(`fog_scores` row: score 47, percentile 53). `node scripts/publish-proofs.mjs` → all 13 example
certs published (idempotent on re-run); `node scripts/verify-ledger.mjs` → `LEDGER OK (13
entries)`; `curl /v1/proofs`, `/v1/ledger`, `/bff/stats`, `/bff/frontier` all returned real data
from the existing 445+ imported positions.

**Decisions made autonomously this session (see `HANDOFF.md` for full rationale):**
- **The public API reads/enqueues the canonical tier, never quick** — quick is Stage 4's internal
  game-analysis speed tier; a public Fog Index lookup should always resolve to the deep,
  authoritative score. The roadmap's route table didn't specify which tier.
- **`@penumbra/analysis` added as a workspace dependency**, not just the roadmap's listed
  `{db,core,fog,cert-schema,config}` — the fog enqueue path, methodology fingerprints, and
  `/bff/import` all need helpers that only live there (`enqueueAnalyzePosition`,
  `computeFingerprintForTier`, `streamUserGames`, `importGame`).
- **`minio` (the official JS client)** added for the object storage the roadmap's ledger spec
  requires but didn't name a library for.
- **`/bff/import` runs synchronously** (bounded by `max`, default 20/cap 100) rather than behind a
  new background job queue — reuses Stage 4's proven `importGame` path as-is. Stage 6's `/journey`
  page wants a "progress" UX during import; if real usage shows this blocking too long, that's the
  point to add a background queue, not before.
- **Certificate claim `value`/`bound` mapping:** a cert's `'win'` claim → `proofs.value='win'`,
  `bound=null`; `'at_least_draw'` → `value='draw'`, `bound='at_least_draw'` (matches the schema's
  own column comments and every fortress example cert).
- **`FOG_WEIGHTS` extracted as a named export** from `packages/fog/src/formula.ts` (previously
  inline literals in `computeFogScore`) so `/v1/meta/methodology` reports the exact weights in use
  instead of a second, driftable copy.
- **Tests run against the real docker Postgres/Redis, not a disposable test database** (this repo
  has none) — synthetic, unique-per-fixture FENs avoid colliding with real imported data, and the
  handful of resulting rows are an accepted permanent fixture in local dev, same as running
  `publish-proofs.mjs` by hand. One follow-on fix this surfaced: `@fastify/rate-limit`'s Redis
  store persists across process restarts, so the test suite flushes its own `fastify-rate-limit-*`
  keys in `beforeAll` to stay isolated from a previous run's counter.

**Remaining for M6 in full:** verifier binary release (crates.io + GitHub releases), production
deploy. Both are launch-stage (`docs/ROADMAP.md` Stage 7), not blocking Stage 6's web wiring.

### 🟡 Stage 7 (launch, `docs/ROADMAP.md`): license split done, release shipped, deploy pending

- **License split (done):** `shakmaty`/`shakmaty-syzygy` are GPL-3.0-or-later, so `penumbra-verify`
  and `penumbra-prover` (both link them directly) can't be Apache-2.0 as the docs previously
  claimed. User approved the recommended split: verifier + prover → GPL-3.0-or-later; certificate
  spec + `cert-schema` + fog spec stay Apache-2.0; the app itself stays private/UNLICENSED.
  Removed the invalid workspace-level `license = "UNLICENSED"` (not real SPDX, silently blocks
  `cargo publish`), added `LICENSE` files, corrected `docs/DEVELOPMENT.md`, and wrote the
  previously-referenced-but-missing `docs/gpl-compliance.md` (GPL rationale, the
  engines-as-separate-processes boundary, source-availability story).
- **crates.io publish (prepped, not yet published):** `rust/verifier/Cargo.toml` has the metadata
  crates.io requires (`repository`, `readme`, `keywords`, `categories`) and a new `README.md`;
  `cargo publish -p penumbra-verify --dry-run` packages and compiles cleanly from the tarball. The
  actual `cargo publish` needs the account owner's own crates.io API token (`cargo login`), which
  isn't something available in this environment — this is the one remaining task blocked purely on
  a credential, not a decision.
- **GitHub release (done and verified live):** `.github/workflows/release.yml` builds
  `penumbra-verify --release` across `windows-msvc`, `linux-gnu`, `macos-arm64` on any `verify-v*`
  tag push, bundling each archive with the two semantic golden certs, a fortress cert, and a verify
  walkthrough; the release object itself is created by the workflow's own token. Tagged and pushed
  `verify-v0.1.0` — the release built successfully and all three archives are live on GitHub.
  Downloaded the actual Windows archive and ran the real walkthrough: `penumbra-verify verify
  examples/morphy_mate_in_2.pnbcert` → `Valid: true`; changed the claimed value in a copy →
  `Valid: false` with `Invalid claim value`. Both outcomes confirmed against the real published
  artifact, not just the local build.
- **CI bug fix (found and fixed along the way):** while investigating a "Test (TypeScript)"
  failure on the last two pushes, found `apps/web`'s Playwright suite had been named `"test"` in
  its `package.json` since Stage 6 — turbo's generic `pnpm test` runs every package's `test`
  script, so CI had been silently trying to run the e2e suite with no live `apps/api` or dev
  server, failing with `ECONNREFUSED`. Renamed the script to `"test:e2e"` (no matching `turbo.json`
  entry, so `turbo test` skips it); running it by hand is unchanged
  (`pnpm --filter @penumbra/web exec playwright test`). CI is green again as of this fix.
- **Deploy (skipped for now, user decision 2026-07-11):** no real Hetzner/Cloudflare/R2 account
  exists yet to deploy to; revisit `infra/docker-compose.prod.yml` + `infra/deploy.md` once there
  is a real target.
- **Methodology finalization (done):** confirmed `percentile_provisional: true` is already present
  on every calibration-derived percentile in `apps/api` (fog + positions routes; the BFF's own
  stats use a plain median, not the CDF, so no flag needed there) and that `FogIndexCard` on the
  web app already labels it provisional. Added a dated "Calibration status" box to
  `docs/FOG_INDEX_METHODOLOGY.md` stating the CDF is a placeholder and the real 100k-corpus run is
  a post-launch background job.

## Architecture overview

```
penumbra/
├─ apps/
│  ├─ web/          # ✅ Next.js + Tailwind, retro 8-bit design system locked; 7 routes, all wired to live data
│  └─ api/          # ✅ Fastify: public API v1, BFF endpoints, hash-chained ledger writer
├─ services/
│  └─ analysis/     # ✅ UCI worker: Stockfish + Lc0 orchestration, fog computation, BullMQ queue
├─ packages/
│  ├─ core/         # ✅ types, EPD, zobrist
│  ├─ fog/          # ✅ formula, calibration
│  ├─ cert-schema/  # ✅ certificate types, JCS, validation
│  ├─ db/           # ✅ Drizzle schema, append-only model
│  └─ config/       # ✅ shared tsconfig, eslint
├─ rust/
│  ├─ verifier/     # ✅ penumbra-verify CLI
│  └─ prover/       # 🟡 penumbra-prove CLI: PNS forced-mate certs (fortress TBD)
├─ docs/            # ✅ specs, methodology
└─ infra/           # ✅ docker-compose
```

## Key principles (locked in)

1. **Two-tier truth system:** Every eval carries `status: EVALUATED | PROVEN`.
2. **Verifiable proofs:** All certificates are machine-checkable (independent verifier).
3. **Deterministic fog:** Single-threaded fixed-node search for reproducibility.
4. **Append-only history:** Engine evals + fog scores never deleted (archaeology).
5. **Open-source core:** Verifier + prover under GPL-3.0-or-later (they link `shakmaty`/
   `shakmaty-syzygy`, which are themselves GPL); certificate spec + cert-schema + fog spec under
   Apache-2.0. See `docs/gpl-compliance.md`.
6. **Zero AI attribution:** Pre-commit hook enforces clean history; no trailers, no footers.

## Timeline estimate

- **M0–M1:** ✅ 4 weeks (done)
- **M2:** 3 weeks (fortress seeds)
- **M3 remainder:** 2 weeks (UCI orchestration)
- **M4:** 4 weeks (game import + analysis)
- **M5:** 3 weeks (UI)
- **M6:** 2.5 weeks (API + launch)

**Total remaining:** ~14.5 weeks to MVP launch.

## Verification checklist (per milestone)

- [x] Hardening: semantic verification, Polyglot zobrist, RFC 8785 hashing, real DB FKs +
  append-only triggers, green CI — all cross-checked live (20/20 Rust tests, 12 core + 6
  cert-schema TS tests, `db-smoke.mjs` against a real Postgres instance)
- [x] M1: Golden test suite green; mutations fail with correct exit codes (`cargo test` in `rust/`, 4/4 passing; CLI exit codes confirmed manually)
- [x] M2 (core): PNS prover emits forced-mate WIN certs that `penumbra-verify` accepts (`cargo test -p penumbra-prover`, 6/6; 3 example certs verify clean)
- [x] M2 (fortress): 10 fortress `at_least_draw` certs generated and verified against Syzygy (`cargo test --workspace`, 32/32; acceptance gate run verbatim, `Valid: true`/`Probes: 9` with `--syzygy`, `Valid: false` without)
- [x] M3: Fog reproducibility test (same FEN twice → byte-identical score) — `repro-test`
  (quick tier) against real Stockfish + Lc0, 3 fixed positions, REPRO OK; `analyze` CLI verified
  against real Postgres (evals rows + 1 fog_scores row per run)
- [x] M4: Import real Lichess game → analyze → fog timeline renders (5 real Lichess games
  imported, a 49-ply game analyzed end to end, `fog_timeline` populated)
- [x] M5: Position page shows provenance + eval history + fog (`/positions/[zobrist]`, live
  against real imported/analyzed positions; Playwright suite green against real infra)
- [x] M6 (API half): `/v1/fog?fen=...` returns 202 then score (confirmed via a real canonical-tier
  job draining to a `fog_scores` row); proofs published + ledger verified (`LEDGER OK (13
  entries)`)
- [x] M6 (remainder, partial): GitHub release binaries verified — downloaded the real
  `verify-v0.1.0` Windows archive and confirmed `Valid: true` / `Valid: false` against the
  actual published artifact, not just a local build
- [x] M6 (remainder): verifier binary available on crates.io — `penumbra-verify v0.1.0` published
  2026-07-11, live at https://crates.io/crates/penumbra-verify (users can now `cargo install penumbra-verify`)
- [x] M6 (remainder): production deploy skipped per user decision 2026-07-11 — no real Hetzner/Cloudflare/R2 target exists yet

Full per-stage task lists, exact commands, and acceptance gates for everything still open live
in `docs/ROADMAP.md` — that file is the forward-looking plan; this section just tracks status.

## Development notes

- All commits authored by the owner (no AI attribution in repo)
- `docs/DEVELOPMENT.md` is the single source of truth for setup/architecture
- Configuration lives in untracked `.claude/` (outside repo)
- Run `docker-compose -f infra/docker-compose.yml up -d` for local services
- Run `pnpm install && pnpm build` to build all packages
- Run `cargo build && cargo test` in the repo root to build/test the verifier and prover (Cargo workspace covers both)
- Run `pnpm run db:generate` / `db:migrate` / `db:push` / `db:studio` from the repo root to manage the database schema (`drizzle-kit` reads `drizzle.config.ts` at the root)
- First full toolchain verification pass done 2026-07-07: `pnpm install`, `pnpm build` (all 5 TS packages), `cargo build`, `cargo test` (4/4) all green from a clean environment. Several latent bugs caught and fixed in the process (see below).

### Bugs found and fixed during first full build/test pass

- `packages/core`: `chessops` was pinned to a nonexistent `^0.20.0`; corrected to `^0.15.0` and fixed the corresponding API usage (`parseFen`/`makeFen` live under `chessops/fen`, not the package root; `Result.isErr`/`.value` are properties, not methods; castling-rights derivation was reading a nonexistent `setup.castles.king/.queen` instead of the real `setup.castlingRights: SquareSet`).
- Every package's `tsconfig.json` extended `@penumbra/config/tsconfig`, but none of them declared `@penumbra/config` as a dependency — pnpm never linked it, so TypeScript silently fell back to default (pre-ES2020) compiler options and cascaded into dozens of spurious errors. Added the missing devDependency to `core`, `cert-schema`, `db`, and `fog`.
- `turbo.json` used the v2 `tasks` schema while `package.json` pinned turbo `^1.10.0` (v1, `pipeline` schema); bumped to turbo `^2.0.0` and added the `packageManager` field v2 requires.
- `rust/verifier`'s `CertificateMetadata` struct required a `format_version` field that doesn't belong on `metadata` (it's already on the top-level certificate, and no fixture or spec example includes it there) — every certificate failed to parse. Removed it and added the spec's actual optional `contributors`/`work_units` fields.
- `penumbra-verify`'s `main()` always returned `Ok(())` regardless of verification outcome, so the CLI exited 0 even for an invalid certificate. Now returns `ExitCode::SUCCESS`/`FAILURE` based on `report.valid`.
- `drizzle-kit`/`drizzle-orm` were pinned to versions (`0.20`/`0.30`) predating the unified CLI the scripts assumed (`generate`/`migrate`/`push`/`drop`/`studio`); bumped to `drizzle-kit ^0.24.0` / `drizzle-orm ^0.33.0` and moved the DB scripts to the root `package.json` (drizzle-kit resolves config-relative paths against the process cwd, not the config file's location, so it has to run from the repo root where `drizzle.config.ts` lives).

### Bugs found and fixed during Stage 3 (`services/analysis`)

- `packages/db`'s exported `Database` type was `ReturnType<typeof getDatabase>`, but
  `getDatabase` is `async` — its real return type is `Promise<NodePgDatabase<...>>`, so any
  function typed to accept `Database` and then call `.insert()`/`.select()` on it would fail to
  compile. Nothing had actually consumed the type before `services/analysis`'s pipeline did, so
  this was latent since the type was introduced. Fixed to `Awaited<ReturnType<typeof
  getDatabase>>`.
- `bullmq` pins an exact `ioredis` version (`5.10.1`); `@penumbra/analysis`'s own
  `"ioredis": "^5.0.0"` dependency resolved to a newer `5.11.1`, giving pnpm two structurally
  incompatible copies and a wall of TypeScript errors when an `IORedis` instance was passed into
  a `Queue`/`Worker`'s `connection` option. Fixed with a `pnpm-workspace.yaml` `overrides` entry
  pinning `ioredis` to a single version workspace-wide.

---

**Phase 1 Complete (2026-07-11).** Stages 1–7 all done and verified end-to-end against real infra:
- Stage 7 (launch) finished: license split (GPL-3.0-or-later verifier+prover, Apache-2.0 spec),
  GitHub release (verify-v0.1.0 with all three platform binaries, tested for real), crates.io
  publish (penumbra-verify v0.1.0 live, `cargo install penumbra-verify` works), CI fixed
  (Playwright suite renamed), methodology finalized (provisional CDF labeled).
- Production deploy explicitly deferred by user choice — no real Hetzner/Cloudflare/R2 target
  exists yet; revisit when infrastructure accounts are ready.

## Phase 2 (in progress)

### ✅ `packages/db` seed script (2026-07-16)

`package.json` had declared a `./seed` export with no `src/seed.ts` behind it since M0 — fixed:
seeds a dev user, a dev API key (printed once), and a two-ply demo game, idempotent on rerun.
Hand-rolls the demo game with `@penumbra/core` primitives rather than calling `importGame()` from
`@penumbra/analysis`, since that package already depends on `@penumbra/db` and importing it back
would invert the workspace dependency graph.

### ✅ Lichess OAuth (PKCE) "connect account" (2026-07-16)

Full connect/disconnect flow for personal Lichess import, using the Authorization Code + PKCE
flow lichess.org supports without app registration (arbitrary `client_id`, no `client_secret`).
Chosen from the Phase 2 backlog (`docs/ROADMAP.md` Deferred section).

- `services/analysis/src/import/lichessOAuth.ts` — PKCE primitives (S256 verifier/challenge,
  state) plus the real network calls: authorize-url builder, `POST https://lichess.org/api/token`
  code exchange, `GET https://lichess.org/api/account`. Unit tested (pure functions only — the
  network calls follow the existing `lichess.ts` precedent of no mocked-network tests).
- `services/analysis/src/import/persist.ts` — `upsertLichessUser`, keyed on the `users` table's
  `lichess_id` unique index that had been sitting ready since the schema was written.
- `apps/api/src/lichessOAuth.ts` — AES-256-GCM encryption for `users.oauth_tokens` "at rest" per
  the schema's own comment. `TOKEN_ENCRYPTION_KEY` has **no dev-fallback default** (unlike the
  DB/Redis/Minio infra creds) since it protects a real bearer credential — throws inline the
  first time a route needs it, matching the existing `PENUMBRA_API_KEY` precedent.
- Two new BFF routes in `apps/api/src/routes/bff.ts`: `POST /bff/lichess/oauth/start` (generates
  the PKCE pair + state, stashes the verifier in Redis keyed by state, 10-minute TTL, returns the
  authorize URL) and `POST /bff/lichess/oauth/callback` (looks the verifier up by state —
  single-use, doubles as CSRF binding since lichess echoes `state` back verbatim — exchanges the
  code, fetches the account, encrypts the token, upserts the user).
- `apps/web/src/lib/session.ts` — HMAC-SHA256 signed `pn_session` cookie (timing-safe compare),
  carrying just `{userId, lichessUsername}` (no secrets, so no encryption needed, unlike the
  stored OAuth token).
- `apps/web/src/app/journey/connect/callback/route.ts` — the GET route handler lichess's redirect
  actually lands on; exchanges the code server-side via the BFF, sets the session, redirects to
  `/journey?connected=1` (or `?error=...`).
- `/journey` (`page.tsx` + `JourneyForm.tsx`) — connect/disconnect controls in the existing locked
  design system; the connected username prefills the existing manual-import input but stays
  editable. **`/bff/import` itself is unchanged** — it already imports any public username
  unauthenticated, so connecting an account is purely an identity convenience, not a new access
  gate.
- Lichess access tokens are long-lived (~1 year) with no refresh token support (confirmed via
  lichess's own docs) — no refresh path was built, deliberately.

**Verified live**, not just unit-tested: real `lichess.org` token-endpoint rejection of a
fabricated code (genuine 400), real Redis TTL on the pending state, single-use/replay rejection
on a reused `state`, the 401 API-key gate, and no stray rows left in `users` afterward. Full
type-check/lint/test suites green with no regressions (`pnpm --filter @penumbra/api test` 25/25
against live Postgres/Redis, `@penumbra/analysis` 65/65 incl. 6 new).

### ✅ Verifier `--tb-endpoint` (2026-07-16)

`penumbra-verify verify --tb-endpoint <url>` now actually works — previously the flag was parsed
but printed "not implemented yet; use --syzygy instead" and fell through to `Forbid`. Chosen from
the Phase 2 backlog (`docs/ROADMAP.md` Deferred section).

- `rust/verifier/src/tb_endpoint.rs` — `EndpointTbOracle`, a blocking `ureq` client (no async
  runtime needed; the whole CLI stays synchronous) probing a Lichess-compatible tablebase HTTP
  API. The endpoint's `category` field already reports the clock-adjusted 7-valued WDL directly
  (`win`/`cursed-win`/`maybe-win`/`draw`/`blessed-loss`/`maybe-loss`/`loss`), so this is a
  straight string-to-`AmbiguousWdl` mapping, not a reimplementation of the DTZ/halfmove-clock
  arithmetic `tb::TbOracle` already does for local Syzygy files.
- `rust/verifier/src/tb.rs` gained a small `TbBackend` enum (`Local`/`Endpoint`) so
  `semantic.rs`'s traversal calls one `.probe()` shape regardless of which source is configured —
  `verifier.rs`'s `TablebasePolicy` gained the matching `Endpoint(String)` variant.
- CLI precedence: `--syzygy` wins if both `--syzygy` and `--tb-endpoint` are passed (warns);
  `--offline` still forces `Forbid` over either. Same soundness-by-default behavior as before —
  omitting all three tablebase flags still rejects a tablebase-terminal certificate outright.
- `docs/CERTIFICATE_FORMAT.md` gained a "Network tablebase probing" subsection documenting the
  trust-boundary difference from `--syzygy` (trusting a remote service to answer honestly,
  vs. the verifier computing the answer itself from files it controls) — still strictly stronger
  than `--assume-tb`, which trusts the certificate's own producer. `rust/verifier/README.md`
  (the crate's crates.io-facing docs) updated to match.

**Verified live**, not just unit-tested: ran the real CLI against the real
`https://tablebase.lichess.ovh/standard` endpoint with no local tablebase files present at all —
a real fortress certificate verifies `Valid: true, Probes: 1`; a copy with the claimed value
flipped from `draw` to `win` is correctly rejected (`Valid: false`, the probe-vs-declared-value
mismatch error). Confirmed the default (no tablebase flags) still rejects the same certificate,
and that `--syzygy`-and-`--tb-endpoint`-together and `--offline`-overrides-both both behave as
documented. `cargo test --workspace` (32/32), `cargo clippy --workspace --all-targets` (zero
warnings), `cargo fmt --all -- --check` all green. No automated test hits the network — matches
this repo's standing convention of not unit-testing real network calls (`category_to_wdl`'s pure
string mapping is unit tested instead).

**Next:** remaining Phase 2 backlog in `docs/ROADMAP.md` (Deferred section) — real calibration
run, Fleet federation, Phase 2 certificate format, `missed_proofs` beyond ≤8 men. What would you
like to tackle?
