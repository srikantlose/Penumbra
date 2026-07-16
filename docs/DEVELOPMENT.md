# Penumbra Development Guide

## Architecture

**Monorepo structure:**

```
penumbra/
├─ apps/
│  ├─ web/            # Next.js: board UI, analysis, Fog timeline, Frontier map, position pages
│  └─ api/            # Fastify API: public v1, app BFF, Lichess OAuth, rate limiting
├─ services/
│  └─ analysis/       # Worker: UCI orchestration (Stockfish, Lc0), Fog computation, import pipeline
├─ packages/
│  ├─ core/           # chessops wrapper, EPD/FEN normalization, Polyglot Zobrist, domain types
│  ├─ fog/            # Fog Index v0.1: pure functions, weights, CDF calibration
│  ├─ cert-schema/    # Certificate format v0.1, JSON Schema, TS types, JCS serialization [open source]
│  ├─ db/             # Drizzle schema + migrations (PostgreSQL)
│  └─ config/         # Shared tsconfig, eslint
├─ rust/
│  ├─ verifier/       # penumbra-verify CLI [open source, standalone, publishable]
│  └─ prover/         # Internal PNS prover for fortress certificates
├─ docs/              # Methodology specs, cert format spec, verification protocol, GPL compliance
└─ infra/             # docker-compose, deploy scripts
```

**Position identity:** Polyglot-standard Zobrist (deterministic, cross-implementation reproducible) + normalized EPD (PPSCRF format, ep legality enforced). Both stored; EPD is the truth key, Zobrist the fast index.

## Local setup

**See [README.md](../README.md#quick-start--local-development) for step-by-step setup.**

### Prerequisites
- Node.js ≥ 18, pnpm ≥ 8
- Docker Desktop (provides Postgres, Redis, Minio — no native Postgres needed)
- Rust (stable) only if modifying `rust/verifier` or `rust/prover`

### Quick reference (after first setup)

```bash
# Start backing services once (postgres/redis/minio, creds all 'penumbra')
docker-compose -f infra/docker-compose.yml up -d

# Build first -- the API dev script runs compiled dist/server.js
pnpm build

# Terminal 1: API server (Fastify, :3001)
pnpm --filter @penumbra/api dev

# Terminal 2: Web app (Next.js, :3000)
pnpm --filter @penumbra/web dev

# Open http://localhost:3000
```

**Ports:** the web app (Next.js) serves on **3000**; the API (Fastify) serves on **3001** (`apiPort()` in `apps/api/src/context.ts`). `WEB_ORIGIN` defaults to `http://localhost:3000` so the API's CORS matches the web dev server.

**Note:** `pnpm dev` (no filter) attempts to run all packages in parallel, which is error-prone. Instead, run the API and web servers in separate terminals as shown above.

### Design import (Google Stitch)

There's no official Google-published Stitch MCP server; `.mcp.json` points at a community server
vendored (not committed) under `tools/stitch-mcp-server`. Treat any such server as untrusted
until reviewed — it receives a Google-account credential.

```bash
# One-time setup
mkdir tools && cd tools
git clone https://github.com/oogleyskr/stitch-mcp-server.git
cd stitch-mcp-server && npm install && npm run build   # produces dist/index.js

# Get a key: stitch.withgoogle.com -> profile menu -> API key -> Create key
cp .env.local.example .env.local   # fill in STITCH_API_KEY
```

Restart Claude Code, run `/mcp` to confirm `stitch` connects, then e.g. "List my Stitch
projects." Import a screen with `get_screen_code` + `screen_to_react` (or bulk via
`export_all_screens` / `build_site`), and drop the result into
`apps/web/src/components/stitch/`, replacing the matching route's `ScreenSlot` placeholder.

No key yet? Stitch's built-in export needs no server: open the screen, click the code icon
(`< >`), choose React, and paste the same way.

## Conventions

### Commit messages
- Imperative, specific subjects: "add zobrist keys for ep squares" (not "add ep handling").
- Max 72 characters.
- Body only for decisions requiring explanation; plain prose, no lists or "This commit…" phrasing.
- Natural commit cadence — small, frequent commits reflecting realistic development.
- **No trailers, no attribution, no footers.**

### Code style
- **TypeScript**: ESLint + Prettier (workspace config in `packages/config`).
- **Rust**: `cargo fmt` + `clippy` (see `rust/Cargo.toml` for lints).
- Comments: only for the "why" of non-obvious decisions; avoid narrating "what" (code should be self-documenting).

### Two-tier truth system (everywhere)
- Every eval, score, and annotation carries a `status: "EVALUATED" | "PROVEN"` field.
- EVALUATED = engine opinion (fallible).
- PROVEN = machine-verifiable certificate exists (ground truth).
- This distinction is visual/programmatic everywhere: colors, icons, API responses, badges.

## Data model

**PostgreSQL schema (Drizzle):**

- **positions** `{id, epd UNIQUE, zobrist INDEX, piece_count, first_seen_game_id, occurrence_count}`
- **games** `{id, source, source_game_id UNIQUE, white, black, result, pgn, imported_at}`
- **game_positions** `{game_id, ply, position_id, uci, san}` — the move sequence
- **evals** `{id, position_id, engine, engine_version, net_id, nodes, depth, multipv_rank, score_cp, score_mate, wdl_w/d/l, settings, engine_fingerprint, created_at}` — **append-only (trigger enforced)**
- **fog_scores** `{position_id, formula_version, engine_fingerprint, score, components, percentile, created_at}` — append-only
- **tb_probes** `{position_id, wdl, dtz, source, probed_at}` — cache for Lichess endpoint
- **proofs** `{id, position_id, claim, value, bound, status, format_version, certificate_object_key, certificate_sha256, published_at}`
- **ledger_entries** `{seq PK, proof_id, payload, prev_hash, entry_hash, created_at}` — hash-chained
- **users** `{id, lichess_id UNIQUE, lichess_username, created_at, oauth_tokens encrypted}`
- **analyses** `{id, game_id, tier, status, fog_timeline, proof_entry_ply, missed_proofs, created_at}`
- **api_keys** `{id, user_id, key_hash, name, quota, created_at, revoked_at}`

**Key design principle:** `evals` and `fog_scores` are append-only by design. History is preserved (eval archaeology, formula tracking). Current = latest row per key, resolved at query time. Triggers block UPDATE/DELETE.

## Fog Index v0.1

**Engine settings (deterministic, pinned):**
- **Stockfish**: pin exact release + NNUE net, `Threads=1, Hash=256MB, MultiPV=4, UCI_ShowWDL=on`, record evals at 1M, 4M, 16M, 64M nodes
- **Lc0**: pin release + network, `30k nodes, MultiPV=4, GPU backend`
- **Engine fingerprint** = SHA256 of canonical settings (included in every stored score)

**Components (normalized [0,1]):**
1. Disagreement: `d = clamp(|wp_SF - wp_Lc0| / 0.35, 0, 1)`
2. Depth volatility: `v = clamp(σ(wp_SF across ladder) / 0.12, 0, 1)`
3. Move criticality: `c = (k-1)/3` where k = count of moves within 0.06 wp of best (1 only-move → 0, 4+ playable → 1)
4. Tablebase distance: `t = clamp((n-7)/9, 0, 1)` for piece count n
5. Proof gate: `g = 0` if position PROVEN, `0.85` if ≥1 child proven, else `1`

**Score:** `Fog = round(100 · g · (0.30·d + 0.25·v + 0.25·c + 0.20·t))`

**Percentile calibration:** frozen 100k-position corpus from Lichess elite (plies 10–80, 2015–2025), hand-curated 200-position QA set gates every formula release.

## Certificate format v0.1

**Proof tree:** AND/OR DAG
- OR-nodes (claiming side moves): certificate supplies one move
- AND-nodes (opponent moves): certificate must cover all legal moves
- Terminals: `checkmate`, `stalemate`, `tablebase` (n≤7, probed), `transposition` (reference to node id)

**Cycle discipline:**
- `win` certificates must be acyclic (well-founded to terminal wins)
- `at_least_draw` certificates may contain cycles (defender confined to non-losing set under 50-move/repetition rules)

**Encoding:** Canonical JSON (RFC 8785 JCS) → SHA256 → zstd container (`.pnbcert`), magic `PNBC`

**Verifier (`penumbra-verify` CLI, Rust, open source):**
- `verify cert.pnbcert [--syzygy DIR | --tb-endpoint URL | --offline]` → exit 0/1 + report
- Independent (no code shared with prover), uses `shakmaty` for move generation, fully offline mode supported
- Golden + mutation test suite (published): invalid moves, missing AND-branches, wrong TB values, tampered claims, hash mismatches — each must fail with specific error

## APIs

**Public v1 (all carry `status: "EVALUATED" | "PROVEN"`):**
- `GET /v1/fog?fen=...` → score, components, formula_version, engine_fingerprint, percentile, 202 if not yet computed
- `POST /v1/fog/batch` → multiple FENs
- `GET /v1/positions/{zobrist}` → fen, provenance, fog, evals[], proof_refs[]
- `GET /v1/proofs` → paginated claims
- `GET /v1/proofs/{id}` → claim, status, certificate_sha256, download URL
- `GET /v1/ledger?since_seq=...` → hash-chained entries
- `GET /v1/meta/methodology` → fog spec versions, engine fingerprints

Rate limiting: per-API-key + per-IP; quota tiers (free = N deep analyses/day).

## Testing

- **Unit tests** in each package (`*.test.ts`, `*.spec.rs`)
- **Integration tests** against local Postgres (Docker)
- **Verifier golden + mutation suite** (`rust/verifier/tests/golden/`)
- **Fog reproducibility** test: same FEN twice → byte-identical scores
- **End-to-end verification** per milestone (see plan)

Run all:
```bash
pnpm test
cargo test --all
```

## Deployment & infra

**Recommended stack:**
- Hosting: Hetzner dedicated (CPU + Postgres + API) + Cloudflare + R2 (object storage, free egress)
- Queue: BullMQ on Redis (Phase 1)
- Lc0 GPU: on-demand serverless (RunPod/Vast)
- Tablebase: local Syzygy 3-4-5 (~1 GB), Lichess endpoint for 6–7 pieces

**Licenses:**
- App: UNLICENSED (private)
- `verifier`, `prover`: GPL-3.0-or-later (both link `shakmaty`/`shakmaty-syzygy`, GPL-3.0-or-later crates — copyleft propagates)
- `cert-schema`, certificate spec, fog spec, calibration data: Apache-2.0 (maximum auditability)
- Engines: separate GPL processes/bundles (no code redistribution, source offer on license page)

See `docs/gpl-compliance.md` for every distribution surface and obligations.

## Phase 1 milestones

| # | Milestone | Est. |
|---|---|---|
| M0 | Foundations (git, CI, monorepo scaffold, packages/core) | 1.5 w |
| M1 | Certificate + verifier (spec, schema, CLI, golden suite) | 3 w |
| M2 | Prover + fortress seeds (PNS, ~10 certs, ledger) | 3 w |
| M3 | Engines + Fog (UCI orchestration, formula, calibration) | 4 w |
| M4 | Import + analysis (Lichess OAuth, game analysis, UI) | 4 w |
| M5 | Positions + map (pages, static Frontier map, journey) | 3 w |
| M6 | API + launch (v1, keys, docs, verifier release, deploy) | 2.5 w |

Total ≈ 21 weeks; cut lines documented in the plan if slipping.

## Resources

- Brief: [penumbra-claude-code-brief.md](../penumbra-claude-code-brief.md)
- Implementation plan: see Phase 1 section above
- Lichess API: https://lichess.org/api
- Stockfish releases: https://github.com/official-stockfish/Stockfish/releases
- Lc0 releases: https://github.com/LeelaChessZero/lc0/releases
- Syzygy tablebases: https://tablebase.lichess.org/
- chessops crate: https://crates.io/crates/shakmaty

## Future scope

See the plan file for recorded future-phase features and engagement mechanics.
