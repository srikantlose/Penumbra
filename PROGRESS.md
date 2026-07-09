# Penumbra Phase 1 Implementation Progress

## Overview

This document tracks the implementation status of Penumbra Phase 1 (MVP). The work is organized by milestone and includes both completed components and next steps.

**As of:** 2026-07-09  
**Status:** Foundations + core systems verified end-to-end; PNS prover now emits forced-mate certificates that round-trip through the verifier; web skeleton up in the locked retro design system; hardening pass complete (verifier semantic verification, Polyglot zobrist, RFC 8785 hashing, real DB constraints, green CI); `services/analysis` (Stage 3, UCI orchestration worker) now lands real Stockfish + Lc0 evals and fog scores in Postgres end-to-end — see `docs/ROADMAP.md` for the detailed forward plan through launch  
**Commits shipped:** 23

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

### M4: Game import + analysis

1. Lichess OAuth integration
2. Game import pipeline (PGN parsing, position extraction)
3. Deep game analysis (Fog timeline, proof-entry detection)
4. Two-tier truth labeling (EVALUATED vs. PROVEN)

### M5: Web UI (positions, Frontier map)

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

1. Replace both placeholder logo/avatar images with locally hosted assets
2. Import any remaining specific Stitch screens if/when the user sends more (style reference only)
3. Personal game journey plotting (M5 remainder)

### M6: API + launch

1. Public API v1 (fog, positions, proofs, ledger)
2. Rate limiting + API keys
3. Methodology pages + docs
4. Verifier binary release (crates.io + GitHub releases)
5. Deploy to production

## Architecture overview

```
penumbra/
├─ apps/
│  ├─ web/          # 🟡 Next.js + Tailwind, retro 8-bit design system locked; 6 routes built
│  └─ api/          # Fastify: public API v1, BFF (TBD)
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
5. **Open-source core:** Verifier + cert-schema under Apache-2.0.
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
- [ ] M4: Import real Lichess game → analyze → fog timeline renders
- [ ] M5: Position page shows provenance + eval history + fog
- [ ] M6: `/v1/fog?fen=...` returns 202 then score; verifier binary available on crates.io

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

**Next action:** Stages 1-3 are all done — hardening, the M2 fortress track (Syzygy tablebases,
`at_least_draw` proofs, 10 committed fortress certs), and now Stage 3 (`services/analysis`, the
UCI orchestration worker) landing real Stockfish + Lc0 evals and fog scores in Postgres, verified
end-to-end against real engine binaries and a real database, with `repro-test` confirming
byte-identical reproducibility. Milestones M2 and M3 are both complete. Next per `docs/ROADMAP.md`
is Stage 4: game import + analysis (Lichess OAuth, PGN parsing, fog timeline, two-tier truth
labeling). `docs/ROADMAP.md` has the full task-by-task plan through Stage 7 (launch) — treat it as
the authoritative "what's next," not this section.
