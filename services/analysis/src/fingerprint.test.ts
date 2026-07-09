import { describe, expect, it } from 'vitest';
import { computeEngineFingerprint, type EngineFingerprintInput } from './fingerprint.js';

const baseInput: EngineFingerprintInput = {
  formulaVersion: '0.1',
  stockfish: {
    version: 'sf_18',
    nnue: 'nn-c288c895ea92.nnue',
    options: { Threads: 1, Hash: 256, MultiPV: 4, UCI_ShowWDL: true },
    ladder: [1_000_000, 4_000_000, 16_000_000, 64_000_000],
  },
  lc0: {
    version: 'v0.32.1',
    network: 't1-256x10-distilled-swa-2432500',
    options: { MultiPV: 4, UCI_ShowWDL: true },
    nodes: 2_000,
    backend: 'blas',
  },
};

describe('computeEngineFingerprint', () => {
  it('is deterministic for identical input', () => {
    expect(computeEngineFingerprint(baseInput)).toBe(computeEngineFingerprint(baseInput));
  });

  it('is a 0x-prefixed 64-hex-char sha256, fitting varchar(66)', () => {
    const fp = computeEngineFingerprint(baseInput);
    expect(fp).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fp).toHaveLength(66);
  });

  it('is independent of object key ordering (canonical JSON)', () => {
    const reordered: EngineFingerprintInput = {
      ...baseInput,
      stockfish: {
        ...baseInput.stockfish,
        options: { UCI_ShowWDL: true, MultiPV: 4, Hash: 256, Threads: 1 },
      },
    };
    expect(computeEngineFingerprint(reordered)).toBe(computeEngineFingerprint(baseInput));
  });

  it('changes when the ladder changes -- quick and canonical tiers must diverge', () => {
    const quick: EngineFingerprintInput = {
      ...baseInput,
      stockfish: { ...baseInput.stockfish, ladder: [100_000, 400_000, 1_600_000] },
    };
    expect(computeEngineFingerprint(quick)).not.toBe(computeEngineFingerprint(baseInput));
  });

  it('changes when the lc0 backend changes', () => {
    const altBackend: EngineFingerprintInput = {
      ...baseInput,
      lc0: { ...baseInput.lc0, backend: 'eigen' },
    };
    expect(computeEngineFingerprint(altBackend)).not.toBe(computeEngineFingerprint(baseInput));
  });

  it('changes when the formula version changes', () => {
    const altFormula: EngineFingerprintInput = { ...baseInput, formulaVersion: '0.2' };
    expect(computeEngineFingerprint(altFormula)).not.toBe(computeEngineFingerprint(baseInput));
  });
});
