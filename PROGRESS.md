# Penumbra Phase 1 Implementation Progress

## Overview

This document tracks the implementation status of Penumbra Phase 1 (MVP). The work is organized by milestone and includes both completed components and next steps.

**As of:** 2026-07-07  
**Status:** Foundations and core systems complete; API/UI work begins  
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

### ✅ M1: Certificate + Verifier (3 weeks, 90% complete)

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

**Still needed:**
- Integration test harness (verify golden passes, mutations fail with correct exit codes)
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
- Append-only tables for `evals` and `fog_scores` (trigger enforced)
- Positions table with Zobrist indexing (EPD is truth key)
- Games, game_positions, proofs, ledger_entries, users, api_keys
- Indexes for common queries (zobrist, game_id, position_id, timestamp)
- Drizzle configuration for migrations

**Still needed:**
- Migration generation and testing
- Database initialization scripts

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

- [ ] M1: Golden test suite green; mutations fail with correct exit codes
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
- Run `cargo build --release` in `rust/` for verifier CLI

---

**Next action:** Start M2 fortress selection spike or continue with M3 (UCI orchestration). Both are critical paths that can run in parallel.
