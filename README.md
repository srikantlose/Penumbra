# Penumbra

Chess platform built around mapping the solved frontier of chess. The Fog Index measures unsolvedness; we attempt to push the boundary outward through AI engines and distributed community compute.

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for architecture, how to run things, and developer conventions.

## Quick start

```bash
pnpm install
pnpm dev
```

## Core concepts

- **Two-tier truth system**: Every position carries exactly one status: EVALUATED (engine opinion) or PROVEN (machine-verifiable certificate).
- **Fog Index**: 0–100 metric measuring position unsolvedness, computed from engine disagreement, depth volatility, move criticality, tablebase distance, and proof coverage.
- **The Frontier**: Interactive map of solved vs. unsolved chess territory.

## Phase 1 scope

Foundation: Fog Index v0.1, certificate format v0.1, verifier CLI, game import + analysis, position pages, static Frontier map, public API.

See [plan](../docs/DEVELOPMENT.md#phase-1) for full milestone breakdown.
