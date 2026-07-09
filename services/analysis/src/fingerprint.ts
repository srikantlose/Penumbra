import crypto from 'node:crypto';
import { canonicalizeJSON } from '@penumbra/cert-schema';
import { FOG_FORMULA_VERSION } from '@penumbra/fog';
import {
  LC0_BACKEND,
  LC0_NETWORK_ID,
  LC0_VERSION,
  STOCKFISH_NNUE,
  STOCKFISH_VERSION,
  lc0SettingsForTier,
  stockfishSettingsForTier,
  type Tier,
  type UciOptionValue,
} from './engines/config.js';

export interface EngineFingerprintInput {
  formulaVersion: string;
  stockfish: {
    version: string;
    nnue: string;
    options: Record<string, UciOptionValue>;
    ladder: number[];
  };
  lc0: {
    version: string;
    network: string;
    options: Record<string, UciOptionValue>;
    nodes: number;
    backend: string;
  };
}

/**
 * '0x' + sha256(canonical JSON) of the exact settings that produced an
 * eval, so any change to engine version, network, options, or ladder
 * shape is reflected in a different fingerprint. 66 chars, fits
 * evals.engine_fingerprint / fog_scores.engine_fingerprint varchar(66).
 * Reuses cert-schema's canonicalizeJSON so this stays byte-for-byte
 * consistent with how certificate hashes are computed.
 */
export function computeEngineFingerprint(input: EngineFingerprintInput): string {
  const canonical = canonicalizeJSON(input);
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return '0x' + hash;
}

/**
 * The fingerprint for a tier depends only on pinned version/settings
 * constants, not on any actual engine output -- so it's computable before
 * running anything. Used to build the queue's dedupe jobId up front, and
 * reused by the pipeline so both sides agree on the same value.
 */
export function computeFingerprintForTier(tier: Tier): string {
  const stockfishSettings = stockfishSettingsForTier(tier);
  const lc0Settings = lc0SettingsForTier(tier);
  return computeEngineFingerprint({
    formulaVersion: FOG_FORMULA_VERSION,
    stockfish: {
      version: STOCKFISH_VERSION,
      nnue: STOCKFISH_NNUE,
      options: stockfishSettings.options,
      ladder: stockfishSettings.ladder,
    },
    lc0: {
      version: LC0_VERSION,
      network: LC0_NETWORK_ID,
      options: lc0Settings.options,
      nodes: lc0Settings.nodes,
      backend: LC0_BACKEND,
    },
  });
}
