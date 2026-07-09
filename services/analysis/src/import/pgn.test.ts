import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractGames, extractPositions } from './pgn.js';

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`../../test-fixtures/${name}`, import.meta.url));
  return readFileSync(path, 'utf8');
}

const STARTPOS_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('extractPositions', () => {
  const pgn = loadFixture('game-castling-promotion-ep.pgn');
  const positions = extractPositions(pgn);

  it('returns one entry per ply plus the ply-0 startpos entry, for a known total ply count', () => {
    // 31 played moves (verified against the committed fixture) + 1 startpos entry.
    expect(positions).toHaveLength(32);
  });

  it('ply 0 is the startpos with no move', () => {
    expect(positions[0]).toMatchObject({ ply: 0, fen: STARTPOS_FEN, uci: null, san: null });
  });

  it('captures castling (O-O) with its chessops king-takes-rook UCI encoding', () => {
    expect(positions[13]).toMatchObject({ ply: 13, san: 'O-O', uci: 'e1h1' });
  });

  it('captures the en passant capture as a diagonal pawn move onto the empty ep-target square', () => {
    // Black played 10...c5 (double push next to White's d5 pawn); White's
    // 11.dxc6 captures en passant, landing on c6 -- a square the captured
    // pawn (on c5) never actually occupied.
    expect(positions[20]).toMatchObject({ ply: 20, san: 'c5' });
    expect(positions[21]).toMatchObject({ ply: 21, san: 'dxc6', uci: 'd5c6' });
    // The en passant capture removes a pawn -- piece count drops by one.
    expect(positions[21].pieceCount).toBe(positions[20].pieceCount - 1);
  });

  it('captures pawn promotion with the lowercase promotion-piece UCI suffix', () => {
    const last = positions[positions.length - 1];
    expect(last).toMatchObject({ ply: 31, san: 'b8=Q', uci: 'b7b8q' });
  });

  it('every entry is keyed by a valid EPD and zobrist hex string', () => {
    for (const position of positions) {
      expect(position.epd).toMatch(/^[1-8pnbrqkPNBRQK/]+ [wb] [KQkqA-Ha-h-]+ [a-h1-8-]+$/);
      expect(position.zobristHex).toMatch(/^0x[0-9a-f]{16}$/);
    }
  });

  it('returns an empty array for a PGN with no games', () => {
    expect(extractPositions('')).toEqual([]);
  });
});

describe('extractGames', () => {
  it('extracts every game in a multi-game PGN file, each independently keyed from its own startpos', () => {
    const single = loadFixture('game-castling-promotion-ep.pgn');
    const multi = single + '\n' + single;

    const games = extractGames(multi);
    expect(games).toHaveLength(2);
    for (const game of games) {
      expect(game.positions).toHaveLength(32);
      expect(game.headers.get('Result')).toBe('*');
      expect(game.pgn.length).toBeGreaterThan(0);
    }
  });
});
