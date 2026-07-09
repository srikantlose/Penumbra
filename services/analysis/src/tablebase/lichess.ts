import { toWhitePerspectiveWdl, type Wdl } from '../engines/perspective.js';

const LICHESS_TABLEBASE_URL = 'https://tablebase.lichess.ovh/standard';
const REQUEST_TIMEOUT_MS = 15_000;

export interface TablebaseProbeResult {
  wdlWhite: Wdl;
  dtz: number | null;
}

interface RawTablebaseResponse {
  category?: string;
  dtz?: number | null;
}

// "unknown" (no coverage) and "maybe-win"/"maybe-loss" (some 7-man
// positions only have partial WDL data) are excluded -- only a definite
// result is worth caching. "cursed-win"/"blessed-loss" (a WDL win/loss the
// 50-move rule turns into a practical draw) are stored as draws, since
// gameplay always runs under the 50-move rule.
const DEFINITE_CATEGORIES = new Set(['win', 'loss', 'draw', 'cursed-win', 'blessed-loss']);

function categoryToSideToMoveWdl(category: string): Wdl {
  if (category === 'win') return { wins: 1000, draws: 0, losses: 0 };
  if (category === 'loss') return { wins: 0, draws: 0, losses: 1000 };
  return { wins: 0, draws: 1000, losses: 0 }; // draw, cursed-win, blessed-loss
}

/**
 * Parses a raw Lichess tablebase API response into a White-perspective WDL
 * + DTZ (or null when no definite result is available). Kept separate from
 * probeTablebase() so the category mapping is unit-testable without a
 * network call.
 */
export function parseTablebaseResponse(raw: unknown, fen: string): TablebaseProbeResult | null {
  const response = raw as RawTablebaseResponse;
  if (!response.category || !DEFINITE_CATEGORIES.has(response.category)) return null;

  const sideToMoveWdl = categoryToSideToMoveWdl(response.category);
  return { wdlWhite: toWhitePerspectiveWdl(sideToMoveWdl, fen), dtz: response.dtz ?? null };
}

/**
 * Probes Lichess's public Syzygy tablebase API for a position. Local
 * Syzygy probing (<= 5 men, per docs/ROADMAP.md Stage 4) is deferred --
 * this is the Lichess-endpoint half only, covering up to 7 men.
 */
export async function probeTablebase(fen: string): Promise<TablebaseProbeResult | null> {
  const url = new URL(LICHESS_TABLEBASE_URL);
  url.searchParams.set('fen', fen);

  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`lichess tablebase probe failed for "${fen}": ${response.status} ${response.statusText}`);
  }

  return parseTablebaseResponse(await response.json(), fen);
}
