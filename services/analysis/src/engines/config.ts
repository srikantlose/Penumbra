// Canonical engine settings contract (docs/FOG_INDEX_METHODOLOGY.md). These
// objects are inputs to computeEngineFingerprint() -- changing any value
// here (including ladder rung counts) changes the fingerprint and starts a
// new fog_scores lineage. Don't tweak casually; see docs/ENGINES.md.

export type UciOptionValue = string | number | boolean;

export interface StockfishSettings {
  options: Record<string, UciOptionValue>;
  ladder: number[];
}

export interface Lc0Settings {
  options: Record<string, UciOptionValue>;
  nodes: number;
}

export const STOCKFISH_CANONICAL: StockfishSettings = {
  options: { Threads: 1, Hash: 256, MultiPV: 4, UCI_ShowWDL: true },
  ladder: [1_000_000, 4_000_000, 16_000_000, 64_000_000],
};

export const STOCKFISH_QUICK: StockfishSettings = {
  options: { Threads: 1, Hash: 256, MultiPV: 4, UCI_ShowWDL: true },
  ladder: [100_000, 400_000, 1_600_000],
};

// nodes=2,000, not the roadmap's original 30,000: CPU inference cost
// turned out dominated by per-node backend overhead (~15ms/node on this
// machine, independent of which reasonably-sized network runs), so 30k
// nodes on CPU takes 5-8 minutes/search. 2,000 nodes (~30s/search) is a
// deliberate, documented tradeoff -- see docs/ENGINES.md and
// docs/FOG_INDEX_METHODOLOGY.md for the timing data behind it.
export const LC0_CANONICAL: Lc0Settings = {
  options: { MultiPV: 4, UCI_ShowWDL: true },
  nodes: 2_000,
};

// Lc0 v0.32.1's CUDA build has no cuda-fp32 choice (the roadmap's original
// determinism fallback), and plain `cuda` was verified non-deterministic
// (repro-test mismatched on every fixed position -- GPU batched-eval
// timing races; MinibatchSize=1 narrowed but didn't close the gap, so
// this is residual cuBLAS kernel-selection nondeterminism, not fixable
// via UCI options). Falls back to the roadmap's next contingency: a CPU
// backend. blas (OpenBLAS) was verified byte-identical across repeated
// runs. This means the engine binary is the CPU build
// (lc0-*-windows-cpu-openblas), not the CUDA build -- see docs/ENGINES.md.
export const LC0_BACKEND = 'blas';

// Version/network identifiers baked into fingerprints and evals rows.
// Mirrors scripts/fetch-engines.mjs's pins and docs/ENGINES.md's pin table
// -- the fetch script can't import this compiled package, so these three
// are kept in sync by hand. Re-pinning any of them starts a new
// fog_scores lineage (see computeEngineFingerprint).
export const STOCKFISH_VERSION = 'sf_18';
// Stockfish 18 embeds its NNUE weights directly in the binary (this is
// EvalFile's built-in default) -- there's no on-disk file to point at, so
// this is just a fixed label identifying which embedded net this pinned
// binary ships.
export const STOCKFISH_NNUE = 'nn-c288c895ea92.nnue';

export const LC0_VERSION = 'v0.32.1';
export const LC0_NETWORK_ID = 't1-256x10-distilled-swa-2432500';
export const LC0_NETWORK_FILENAME = 't1-256x10-distilled-swa-2432500.pb.gz';

export type Tier = 'quick' | 'canonical';

export function stockfishSettingsForTier(tier: Tier): StockfishSettings {
  return tier === 'canonical' ? STOCKFISH_CANONICAL : STOCKFISH_QUICK;
}

// Lc0 only has one tier in v1 -- its single deep search is cheap relative
// to the Stockfish ladder, so quick and canonical share it.
export function lc0SettingsForTier(_tier: Tier): Lc0Settings {
  return LC0_CANONICAL;
}
