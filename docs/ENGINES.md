# Engine Pins

Stage 3 (`services/analysis`) runs two fixed engine binaries against a fixed network
file to produce deterministic, reproducible evals. This document is the source of
truth for exactly which builds, and records the determinism/performance findings
that shaped the Lc0 backend, network, and node-count choices. `scripts/fetch-engines.mjs`
downloads and verifies these exact files; `services/analysis/src/engines/config.ts`
bakes the version/network/backend identifiers into `computeEngineFingerprint()`.

Re-pinning any row below is a deliberate act: a different engine build changes
evaluation output, which changes the fingerprint, which starts a new `fog_scores`
lineage. Update the pin in both `scripts/fetch-engines.mjs` and
`services/analysis/src/engines/config.ts` together, and re-run `repro-test` before
merging.

## Pin table

| Component | Version | Asset | sha256 | Pinned |
|---|---|---|---|---|
| Stockfish | sf_18 | `stockfish-windows-x86-64-avx2.zip` | `6f6c272ebd6ea594377715235c8a7326f75940ef4f4f856f45106028fe6ae900` | 2026-07-09 |
| Lc0 | v0.32.1 | `lc0-v0.32.1-windows-cpu-openblas.zip` | `b2caa8443f0e0cb15cf76c335c53985f2973cd6438e77d3e2366cd21d2effa38` | 2026-07-09 |
| Lc0 network | t1-256x10-distilled-swa-2432500 | `t1-256x10-distilled-swa-2432500.pb.gz` | `bc27a6cae8ad36f2b9a80a6ad9dabb0d6fda25b1e7f481a79bc359e14f563406` | 2026-07-09 |

Stockfish and Lc0 release URLs and the Lc0 network URL are in
`scripts/fetch-engines.mjs`. The network file's hash isn't published upstream
(lczero.org doesn't hash its network storage), so it was pinned from this script's
own first verified download rather than an upstream-published value.

## Stockfish settings

- `Threads=1`, `Hash=256`, `MultiPV=4`, `UCI_ShowWDL=true`
- Canonical ladder: `1,000,000 / 4,000,000 / 16,000,000 / 64,000,000` nodes
- Quick ladder: `100,000 / 400,000 / 1,600,000` nodes
- NNUE: Stockfish 18 embeds its weights directly in the binary (`EvalFile`'s
  built-in default, `nn-c288c895ea92.nnue`) — there's no on-disk net file to point
  at or re-pin separately from the binary itself.
- Threads=1 was verified fully deterministic: `repro-test` (quick tier) produced
  byte-identical canonicalized output across two runs on all 3 fixed positions,
  every time, with no exceptions, at every backend/network combination tried below.

## Lc0: backend, network, and node count

These three were originally spec'd as `GPU backend` / "the current best network" /
`30,000 nodes` (see `docs/FOG_INDEX_METHODOLOGY.md`'s earlier draft). All three
changed after hitting real, measured problems — recorded here in the order they
were found, since each finding shaped the next decision.

**Final pin: `Backend=blas` (OpenBLAS, CPU) + `t1-256x10-distilled-swa-2432500` net
+ `2,000` nodes, fixed for both tiers.**

### 1. GPU (CUDA) is non-deterministic on this build

The plan was an explicit, non-auto CUDA backend for determinism. In practice:

- **`cuda-fp32` doesn't exist.** This build's `Backend` UCI option only offers
  `cuda-auto`, `cuda`, `cuda-fp16`, plus test/meta backends (`trivial`, `random`,
  `check`, `roundrobin`, `recordreplay`, `multiplexing`, `demux`) — checked
  directly against live `uci` output, not assumed from docs.
- **`cuda` (explicit, non-auto, non-fp16) is non-deterministic.** `repro-test`
  against the CUDA build with `Backend=cuda` mismatched on every one of the 3
  fixed positions — different `scoreCp`/`wdl`/`depth` between two back-to-back
  runs of the same position at the same fixed node count.
- **`MinibatchSize=1` narrows but doesn't close the gap.** Forcing serial,
  unbatched evaluation (ruling out cross-position batching races as the cause)
  reduced the mismatch to single-digit WDL differences (e.g. `wins: 204` vs.
  `203`) but did not reach byte-identical. This is residual cuBLAS
  kernel-selection nondeterminism internal to a single position's evaluation,
  not fixable via UCI options short of an engine-level deterministic-algorithm
  flag Lc0 doesn't expose.

### 2. CPU (`blas`, OpenBLAS) is deterministic, but per-node cost is high

The `lc0-v0.32.1-windows-cpu-openblas` release asset exposes `blas` (default) and
`eigen` backends. `blas` was verified byte-identical across repeated runs at every
node count tested (500, 2,000, and eventually the full `repro-test` suite).
However: a single 30,000-node search on this machine's CPU took **over 10
minutes** (timed out) with both the original strong network and a mid-size
"distilled" network — i.e., the roadmap's "30k nodes is CPU-feasible" assumption
didn't hold on this hardware.

### 3. Per-node cost is dominated by backend overhead, not network size

Direct timing comparison at 30,000 nodes:

| Network | Size | Time (single search) |
|---|---|---|
| BT4-1024x15x32h-swa-6147500-policytune-332 (top contrib net) | ~380 MB | >10 min (timed out) |
| 791556 (Lc0's bundled legacy default net) | ~19 MB | ~223 s |
| t1-256x10-distilled-swa-2432500 | ~37 MB | ~300 s |

A ~20x size difference (380MB → 19MB) didn't produce a proportional speed
difference — per-node overhead on this CPU/OpenBLAS combination is roughly
constant (~15ms/node) across reasonably-sized networks, not FLOPs-bound the way
GPU inference is. This ruled out "just pick a smaller network" as a full fix and
pointed at node count as the real lever.

### 4. Final node count: 2,000 (not 30,000)

Direct timing at lower node counts on `t1-256x10-distilled-swa-2432500`:

| Nodes | Time | Determinism |
|---|---|---|
| 500 | ~9.5 s | byte-identical (2 runs) |
| 2,000 | ~30 s | byte-identical (2 runs) |
| 30,000 | ~300 s | not tested to completion pre-repro-test (timed out earlier at 10 min on other networks) |

**2,000 nodes was chosen as a deliberate, documented tradeoff**: ~30s/search is
practical for a real pipeline (Stockfish's own canonical ladder already costs
more than this per position); 30,000 nodes would cost 5-8 minutes per Lc0 search,
which is impractical at any real analysis volume. This is a real deviation from
the original methodology spec, not a bug — `docs/FOG_INDEX_METHODOLOGY.md` has
been updated to match. Quick and canonical tiers share this node count (Lc0's
policy/value search has no iterative-deepening concept, so quick/canonical
sharing one Lc0 setting was already the v1 design regardless of the exact number).

The network choice (a "distilled" net — trained to approximate a much larger
net's output at a fraction of the size, not an old/weak legacy net) was picked to
preserve as much positional understanding as practical within the size range that
turned out not to matter much for CPU speed anyway.

The `Backend` value (`blas`) and network id are fingerprint inputs
(`lc0.backend` / `lc0.network` in `computeEngineFingerprint()`), so all of this is
baked into every eval's provenance — any future change (GPU determinism fix,
faster hardware, different network) starts a new `fog_scores` lineage, same as
any other re-pin.

## `repro-test` results

- **Quick tier:** `pnpm --filter @penumbra/analysis run repro-test` — **REPRO OK**,
  byte-identical across all 3 fixed positions (startpos, a dense middlegame, a
  king+pawn endgame), verified 2026-07-09 on the final pin (Stockfish `Threads=1`
  + Lc0 `blas` backend, `t1-256x10-distilled-swa-2432500` net, 2,000 nodes).
- **Canonical tier:** `pnpm --filter @penumbra/analysis run repro-test:canonical`
  — not yet run (manual). Record the result here the next time it's run; expect
  it to pass given quick tier's clean result used the same Lc0 settings and only
  Stockfish's ladder differs between tiers.

## WDL perspective

UCI's `wdl` triple is reported from the side-to-move's perspective. This pipeline
normalizes every WDL triple to **White's perspective** before storing it or feeding
it to `computeFogIndex()`, so Stockfish and Lc0 numbers stay directly comparable
regardless of whose turn it is in the position being analyzed. The flip happens in
exactly one place: `services/analysis/src/engines/perspective.ts`
(`toWhitePerspectiveWdl`), unit-tested against both a White-to-move and a
Black-to-move fixture.
