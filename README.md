# Penumbra

Chess platform built around mapping the solved frontier of chess. The Fog Index measures unsolvedness; we attempt to push the boundary outward through AI engines and distributed community compute.

## Quick start — Local development

Postgres, Redis, and MinIO all run in Docker via `infra/docker-compose.yml` — you do **not** need a native PostgreSQL install. The compose stack creates the `penumbra` database with user/password/db all `penumbra`, and the apps default to those credentials, so there's nothing to configure for a basic run.

### Prerequisites
- **Node.js** ≥ 18, **pnpm** ≥ 8
- **Docker Desktop** (provides Postgres, Redis, MinIO)
- **Rust** (only if working on `rust/verifier` or `rust/prover`)

### Step 1: Install dependencies
```bash
pnpm install
```

### Step 2: Start the backing services (Postgres, Redis, MinIO)
```bash
docker-compose -f infra/docker-compose.yml up -d
```

Verify Postgres is healthy (all should report `Up ... (healthy)`):
```bash
docker ps
```

The container is `penumbra-postgres` on `localhost:5432`, credentials `penumbra` / `penumbra`, database `penumbra`. To open a psql shell inside it:
```bash
docker exec -it -e PGPASSWORD=penumbra penumbra-postgres psql -U penumbra -d penumbra
```

### Step 3: Run database migrations
```bash
pnpm db:migrate
pnpm db:smoke   # verify the connection works
```

### Step 4: Build the workspace (the API `dev` script runs compiled output)
```bash
pnpm build
```

### Step 5: Start the dev servers (two separate terminals)

**Terminal 1 — API server (Fastify, port 3001)**
```bash
pnpm --filter @penumbra/api dev
```
> The API reads config straight from `process.env` (no `.env.local` loader). `DATABASE_URL`, `PORT`, `WEB_ORIGIN`, and the `MINIO_*` vars all have working local-dev defaults, so nothing needs to be set for a basic run. Only the "connect Lichess account" flow needs a real `TOKEN_ENCRYPTION_KEY` exported into the shell — see `apps/api/.env.local.example`.

**Terminal 2 — Web app (Next.js, port 3000)**
```bash
pnpm --filter @penumbra/web dev
```
> The web app reads `apps/web/.env.local`. Copy `apps/web/.env.local.example` to `.env.local`; `NEXT_PUBLIC_API_URL` should point at the API on `http://localhost:3001`.

Open **http://localhost:3000** in your browser.

### Troubleshooting

**`psql` prompts for a password and rejects everything**
- You're probably hitting the Docker container, whose superuser is `penumbra`, **not** `postgres`. Connect with `-U penumbra` (password `penumbra`), or use the `docker exec` command above.

**"Cannot connect to database"**
- Confirm the container is up and healthy: `docker ps`
- If the port looks taken, check what owns 5432 — Docker/WSL port proxies can shadow a native Postgres install.

**"Cannot find module" / stale build**
- Re-run `pnpm install`, then `pnpm build`. Clear caches with `pnpm clean` if needed.

**Web page loads but doesn't connect to API**
- Verify the API is running on http://localhost:3001 and `NEXT_PUBLIC_API_URL` in `apps/web/.env.local` matches.
- Check the browser console (DevTools → Console) for errors.

## What's running

- **`apps/api`** (Fastify, **:3001**): Public v1 API, internal BFF routes, Lichess OAuth, rate limiting
- **`apps/web`** (Next.js, **:3000**): Board UI, game analysis, Fog timeline, Frontier map, position pages
- **`services/analysis`** (Node worker): UCI orchestration (Stockfish/Lc0), Fog computation, game import
- **Postgres / Redis / MinIO** (Docker): position + proof storage, job queue / PKCE state, certificate object storage

## Core concepts

- **Two-tier truth system**: Every position carries exactly one status: EVALUATED (engine opinion) or PROVEN (machine-verifiable certificate).
- **Fog Index**: 0–100 metric measuring position unsolvedness, computed from engine disagreement, depth volatility, move criticality, tablebase distance, and proof coverage.
- **The Frontier**: Interactive map of solved vs. unsolved chess territory.

## Project structure

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for full architecture, code organization, and developer conventions.
