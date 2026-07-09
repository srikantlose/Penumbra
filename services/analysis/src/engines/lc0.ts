import { UciClient } from '../uci/client.js';
import { LC0_BACKEND, lc0SettingsForTier, type Tier } from './config.js';
import { buildMultiPvLines, type MultiPvLine } from './multipv.js';

export interface Lc0Result {
  nodes: number;
  /** Every multipv rank reported for the single deep search, White perspective. */
  multiPV: MultiPvLine[];
}

/**
 * weightsFile is an absolute local path (from engines/manifest.json), not a
 * fingerprint input -- computeEngineFingerprint() records the network's
 * portable id instead, so the fingerprint stays stable across machines and
 * checkouts even though this path isn't.
 */
export async function runLc0(exePath: string, weightsFile: string, fen: string, tier: Tier): Promise<Lc0Result> {
  const settings = lc0SettingsForTier(tier);
  const client = new UciClient(exePath);

  try {
    await client.init({ ...settings.options, WeightsFile: weightsFile, Backend: LC0_BACKEND });

    const { infoByMultiPv } = await client.goNodes(fen, settings.nodes);
    const multiPV = buildMultiPvLines(infoByMultiPv, fen);
    if (!multiPV.some((line) => line.rank === 1)) {
      throw new Error(`lc0: no wdl reported for multipv 1 (is UCI_ShowWDL enabled?)`);
    }

    return { nodes: settings.nodes, multiPV };
  } finally {
    await client.quit();
  }
}
