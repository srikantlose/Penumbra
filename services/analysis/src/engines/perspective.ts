export interface Wdl {
  wins: number;
  draws: number;
  losses: number;
}

/** Maps the UCI wire format's terse `wdl w d l` fields onto Wdl's names. */
export function fromUciWdl(wdl: { w: number; d: number; l: number }): Wdl {
  return { wins: wdl.w, draws: wdl.d, losses: wdl.l };
}

/**
 * UCI `wdl` is reported from the side-to-move's perspective. Every WDL
 * triple this pipeline stores or feeds to computeFogIndex() is normalized
 * to White's perspective instead, so Stockfish and Lc0 numbers stay
 * directly comparable across positions regardless of whose turn it is.
 * This is the one place that flip happens -- callers must not re-flip.
 */
export function toWhitePerspectiveWdl(wdl: Wdl, fen: string): Wdl {
  const sideToMove = fen.split(/\s+/)[1];
  if (sideToMove !== 'w' && sideToMove !== 'b') {
    throw new Error(`cannot determine side to move from FEN: "${fen}"`);
  }
  if (sideToMove === 'w') return wdl;
  return { wins: wdl.losses, draws: wdl.draws, losses: wdl.wins };
}
