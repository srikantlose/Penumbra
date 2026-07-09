import { describe, expect, it } from 'vitest';
import { parseTablebaseResponse } from './lichess.js';

const WHITE_TO_MOVE = '8/8/8/8/8/2k5/8/2KQ4 w - - 0 1';
const BLACK_TO_MOVE = '8/8/8/8/8/2k5/8/2KQ4 b - - 0 1';

describe('parseTablebaseResponse', () => {
  it('maps a "win" category to a White win when White is to move', () => {
    const result = parseTablebaseResponse({ category: 'win', dtz: 12 }, WHITE_TO_MOVE);
    expect(result).toEqual({ wdlWhite: { wins: 1000, draws: 0, losses: 0 }, dtz: 12 });
  });

  it('flips a "win" category to a White loss when Black is to move (side-to-move perspective)', () => {
    const result = parseTablebaseResponse({ category: 'win', dtz: 12 }, BLACK_TO_MOVE);
    expect(result).toEqual({ wdlWhite: { wins: 0, draws: 0, losses: 1000 }, dtz: 12 });
  });

  it('maps "loss" to the mover losing, flipped correctly for Black to move', () => {
    const result = parseTablebaseResponse({ category: 'loss', dtz: 5 }, BLACK_TO_MOVE);
    expect(result).toEqual({ wdlWhite: { wins: 1000, draws: 0, losses: 0 }, dtz: 5 });
  });

  it('maps "draw" to a draw regardless of side to move', () => {
    expect(parseTablebaseResponse({ category: 'draw', dtz: 0 }, WHITE_TO_MOVE)).toEqual({
      wdlWhite: { wins: 0, draws: 1000, losses: 0 },
      dtz: 0,
    });
    expect(parseTablebaseResponse({ category: 'draw', dtz: 0 }, BLACK_TO_MOVE)).toEqual({
      wdlWhite: { wins: 0, draws: 1000, losses: 0 },
      dtz: 0,
    });
  });

  it('treats "cursed-win" and "blessed-loss" as practical draws (50-move rule)', () => {
    expect(parseTablebaseResponse({ category: 'cursed-win', dtz: 120 }, WHITE_TO_MOVE)?.wdlWhite).toEqual({
      wins: 0,
      draws: 1000,
      losses: 0,
    });
    expect(parseTablebaseResponse({ category: 'blessed-loss', dtz: 120 }, WHITE_TO_MOVE)?.wdlWhite).toEqual({
      wins: 0,
      draws: 1000,
      losses: 0,
    });
  });

  it('returns null for indeterminate categories (unknown, maybe-win, maybe-loss)', () => {
    expect(parseTablebaseResponse({ category: 'unknown' }, WHITE_TO_MOVE)).toBeNull();
    expect(parseTablebaseResponse({ category: 'maybe-win' }, WHITE_TO_MOVE)).toBeNull();
    expect(parseTablebaseResponse({ category: 'maybe-loss' }, WHITE_TO_MOVE)).toBeNull();
  });

  it('returns null when category is missing entirely', () => {
    expect(parseTablebaseResponse({}, WHITE_TO_MOVE)).toBeNull();
  });

  it('defaults a missing dtz to null', () => {
    const result = parseTablebaseResponse({ category: 'draw' }, WHITE_TO_MOVE);
    expect(result?.dtz).toBeNull();
  });
});
