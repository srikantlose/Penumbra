import { describe, expect, it } from 'vitest';
import { fromUciWdl, toWhitePerspectiveWdl } from './perspective.js';

describe('toWhitePerspectiveWdl', () => {
  const whiteToMoveFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const blackToMoveFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

  it('passes WDL through unchanged when White is to move', () => {
    const wdl = { wins: 700, draws: 250, losses: 50 };
    expect(toWhitePerspectiveWdl(wdl, whiteToMoveFen)).toEqual(wdl);
  });

  it('swaps wins and losses when Black is to move', () => {
    const wdl = { wins: 700, draws: 250, losses: 50 };
    expect(toWhitePerspectiveWdl(wdl, blackToMoveFen)).toEqual({ wins: 50, draws: 250, losses: 700 });
  });

  it('leaves draws untouched by the flip', () => {
    const wdl = { wins: 100, draws: 800, losses: 100 };
    expect(toWhitePerspectiveWdl(wdl, blackToMoveFen).draws).toBe(800);
  });

  it('throws on a FEN with no parseable side-to-move field', () => {
    expect(() => toWhitePerspectiveWdl({ wins: 1, draws: 1, losses: 1 }, 'not a fen')).toThrow();
  });
});

describe('fromUciWdl', () => {
  it('maps the UCI wire format w/d/l fields onto wins/draws/losses', () => {
    expect(fromUciWdl({ w: 94, d: 902, l: 4 })).toEqual({ wins: 94, draws: 902, losses: 4 });
  });
});
