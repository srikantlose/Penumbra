import { UciClient } from '../uci/client.js';
import { stockfishSettingsForTier, type Tier } from './config.js';
import { buildMultiPvLines, type MultiPvLine } from './multipv.js';

export interface StockfishRungResult {
  nodes: number;
  /** Every multipv rank reported for this rung, White perspective. */
  multiPV: MultiPvLine[];
}

export interface StockfishResult {
  /** One entry per ladder rung, ladder order. */
  rungs: StockfishRungResult[];
}

export async function runStockfishLadder(exePath: string, fen: string, tier: Tier): Promise<StockfishResult> {
  const settings = stockfishSettingsForTier(tier);
  const client = new UciClient(exePath);

  try {
    await client.init(settings.options);

    const rungs: StockfishRungResult[] = [];
    for (const nodes of settings.ladder) {
      const { infoByMultiPv } = await client.goNodes(fen, nodes);
      const multiPV = buildMultiPvLines(infoByMultiPv, fen);
      if (!multiPV.some((line) => line.rank === 1)) {
        throw new Error(`stockfish rung ${nodes} nodes: no wdl reported for multipv 1 (is UCI_ShowWDL enabled?)`);
      }
      rungs.push({ nodes, multiPV });
    }

    return { rungs };
  } finally {
    await client.quit();
  }
}
