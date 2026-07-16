# Penumbra

Chess platform built around mapping the solved frontier of chess. The Fog Index measures unsolvedness; we attempt to push the boundary outward through AI engines and distributed community compute.

## Quick start — Local development (5 minutes)

### Prerequisites
- **Node.js** ≥ 18, **pnpm** ≥ 8
- **PostgreSQL** running locally (database `penumbra`, default credentials)
- **Docker** (optional; see below)
- **Rust** (only if working on `rust/verifier` or `rust/prover`)

### Step 1: Install dependencies
```bash
pnpm install
```

### Step 2: Start the database and services
**Option A: Using Docker (recommended)**
```bash
docker-compose -f infra/docker-compose.yml up -d
```

**Option B: Manual PostgreSQL setup**
```bash
# Create database (if not exists)
createdb penumbra

# Verify connection
psql -U postgres -d penumbra -c "SELECT 1"
```

Set up `.env.local` files:
```bash
# apps/api/.env.local
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/penumbra
REDIS_URL=redis://localhost:6379
```

```bash
# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Step 3: Run database migrations
```bash
pnpm db:migrate
pnpm db:smoke  # verify the connection works
```

### Step 4: Start the dev servers (two separate terminals)

**Terminal 1 — API server (Fastify, port 3000)**
```bash
pnpm --filter @penumbra/api dev
```

**Terminal 2 — Web app (Next.js, port 3001)**
```bash
pnpm --filter @penumbra/web dev
```

Open **http://localhost:3001** in your browser.

### Troubleshooting

**"Cannot connect to database"**
- Verify PostgreSQL is running: `psql -U postgres -d penumbra -c "SELECT 1"`
- Check `DATABASE_URL` in `apps/api/.env.local`

**"Port 3000 already in use"**
- Change the port in `apps/api/src/server.ts` or kill the existing process

**"Cannot find module"**
- Run `pnpm install` again
- Clear node_modules: `pnpm clean`

**Web page loads but doesn't connect to API**
- Verify API server is running on http://localhost:3000
- Check browser console (DevTools → Console) for errors
- Verify `NEXT_PUBLIC_API_URL` in `apps/web/.env.local`

## What's running

- **`apps/api`** (Fastify): Public v1 API, internal BFF routes, Lichess OAuth, rate limiting
- **`apps/web`** (Next.js): Board UI, game analysis, Fog timeline, Frontier map, position pages
- **`services/analysis`** (Node worker): UCI orchestration (Stockfish/Lc0), Fog computation, game import
- **PostgreSQL**: Positions, games, analyses, proofs, tablebase cache
- **Redis** (optional): Pending PKCE state, caching

## Core concepts

- **Two-tier truth system**: Every position carries exactly one status: EVALUATED (engine opinion) or PROVEN (machine-verifiable certificate).
- **Fog Index**: 0–100 metric measuring position unsolvedness, computed from engine disagreement, depth volatility, move criticality, tablebase distance, and proof coverage.
- **The Frontier**: Interactive map of solved vs. unsolved chess territory.

## Project structure

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for full architecture, code organization, and developer conventions.
