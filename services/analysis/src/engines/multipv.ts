import type { UciInfo } from '../uci/parse.js';
import { fromUciWdl, toWhitePerspectiveWdl, type Wdl } from './perspective.js';

export interface EngineWdl extends Wdl {
  nodes: number;
}

export interface MultiPvLine {
  rank: number;
  move: string;
  wdl: Wdl;
  depth?: number;
  scoreCp?: number;
  scoreMate?: number;
}

/**
 * Flattens a goNodes() infoByMultiPv map into rank-ordered lines, in White
 * perspective. Drops any rank that never received a WDL/pv (e.g. a MultiPV
 * slot the engine hadn't gotten to yet when bestmove arrived).
 */
export function buildMultiPvLines(infoByMultiPv: Map<number, UciInfo>, fen: string): MultiPvLine[] {
  const lines: MultiPvLine[] = [];
  for (const [rank, info] of [...infoByMultiPv.entries()].sort((a, b) => a[0] - b[0])) {
    if (!info.wdl || !info.pv?.[0]) continue;
    lines.push({
      rank,
      move: info.pv[0],
      wdl: toWhitePerspectiveWdl(fromUciWdl(info.wdl), fen),
      depth: info.depth,
      scoreCp: info.scoreCp,
      scoreMate: info.scoreMate,
    });
  }
  return lines;
}
