# Penumbra Phase 1 Implementation Progress

## Overview

This document tracks the implementation status of Penumbra Phase 1 (MVP). The work is organized by milestone and includes both completed components and next steps.

**As of:** 2026-07-07  
**Status:** Foundations and core systems complete and verified end-to-end (full build/test pass); API/UI work begins  
**Commits shipped:** 9

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

### ✅ M3: Fog Index v0.1 (partial, ~4 weeks)

**Objective:** Implement the Fog Index metric and calibration.

**Delivered:**
- `packages/fog`: complete formula implementation
  - Components: disagreement (SF vs. Lc0), depth volatility, move criticality, tablebase distance, proof gate
  - Score: `Fog = round(100 · g · (0.30·d + 0.25·v + 0.25·c + 0.20·t))`
- Engine fingerprinting (SHA256 hash of canonical settings)
- Calibration CDF (100k position corpus, percentile lookups)
- Comprehensive methodology documentation (`docs/FOG_INDEX_METHODOLOGY.md`)
- Deterministic, reproducible formula (single-threaded fixed-node search)

**Still needed:**
- UCI orchestration service (Stockfish + Lc0 runners)
- Game import pipeline and analysis service

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
- Apply migration against a running Postgres instance and confirm it lands cleanly (generation verified; live-DB apply not yet run in this environment)
- Append-only enforcement triggers (UPDATE/DELETE blockers on `evals`/`fog_scores`) as a follow-up migration
- Database initialization/seed scripts

## In-progress and next steps

### M2: Prover + Fortress seeds (3 weeks)

Not yet started. Critical path:
1. Fortress selection spike (go/no-go per candidate)
2. Implement PNS (proof-number search) over AND/OR trees
3. Generate ~10 fortress certificates (min 5)
4. Verify each against Syzygy tablebases

### M3 remainder: UCI orchestration

High-priority next work:
1. `services/analysis`: Stockfish + Lc0 subprocess orchestration
2. Cached eval storage (position → engines → WDL ladder)
3. Fog computation pipeline (batch job + caching)
4. Engine lifecycle management (subprocess pooling, cleanup)

### M4: Game import + analysis

1. Lichess OAuth integration
2. Game import pipeline (PGN parsing, position extraction)
3. Deep game analysis (Fog timeline, proof-entry detection)
4. Two-tier truth labeling (EVALUATED vs. PROVEN)

### M5: Web UI (positions, Frontier map)

1. Position pages (provenance, eval history, fog, proof refs)
2. Static Frontier map (SVG coastline + canvas overlay)
3. Personal game journey plotting

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
│  ├─ web/          # Next.js: UI, board, analysis (TBD)
│  └─ api/          # Fastify: public API v1, BFF (TBD)
├─ services/
│  └─ analysis/     # Worker: UCI, fog computation (TBD)
├─ packages/
│  ├─ core/         # ✅ types, EPD, zobrist
│  ├─ fog/          # ✅ formula, calibration
│  ├─ cert-schema/  # ✅ certificate types, JCS, validation
│  ├─ db/           # ✅ Drizzle schema, append-only model
│  └─ config/       # ✅ shared tsconfig, eslint
├─ rust/
│  ├─ verifier/     # ✅ penumbra-verify CLI
│  └─ prover/       # 🟡 PNS implementation (TBD)
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

- [x] M1: Golden test suite green; mutations fail with correct exit codes (`cargo test` in `rust/`, 4/4 passing; CLI exit codes confirmed manually)
- [ ] M2: ~10 fortress certs generated and verified end-to-end
- [ ] M3: Fog reproducibility test (same FEN twice → byte-identical score)
- [ ] M4: Import real Lichess game → analyze → fog timeline renders
- [ ] M5: Position page shows provenance + eval history + fog
- [ ] M6: `/v1/fog?fen=...` returns 202 then score; verifier binary available on crates.io

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

---

**Next action:** Start M2 fortress selection spike or continue with M3 (UCI orchestration). Both are critical paths that can run in parallel.
