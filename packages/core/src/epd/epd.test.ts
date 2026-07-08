import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fenToEPD, getPieceCount, normalizeEPD, parseFenToEPD } from './index.js';

test('normalizeEPD keeps a legally capturable en passant square', () => {
  const fen = 'rnbqkbnr/1pppp1pp/p7/4Pp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3';
  assert.equal(normalizeEPD(fen), 'rnbqkbnr/1pppp1pp/p7/4Pp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6');
});

test('normalizeEPD drops an uncapturable en passant square', () => {
  // Black just played d7d5, but White has no pawn on c5/e5 to capture with.
  const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
  assert.equal(normalizeEPD(fen), 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -');
});

test('normalizeEPD drops an en passant square pinned against the king', () => {
  const fen = '8/8/8/8/k2Pp2Q/8/8/4K3 b - d3 0 1';
  assert.equal(normalizeEPD(fen), '8/8/8/8/k2Pp2Q/8/8/4K3 b - -');
});

test('normalizeEPD passes through a position with no en passant square', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.equal(normalizeEPD(fen), fen.split(' ').slice(0, 4).join(' '));
});

test('parseFenToEPD splits the normalized fields', () => {
  const parts = parseFenToEPD('rnbqkbnr/1pppp1pp/p7/4Pp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  assert.deepEqual(parts, {
    piecePlacement: 'rnbqkbnr/1pppp1pp/p7/4Pp2/8/8/PPPP1PPP/RNBQKBNR',
    activeColor: 'w',
    castlingRights: 'KQkq',
    enPassantTarget: 'f6'
  });
});

test('fenToEPD is the cheap unchecked variant (does not validate ep legality)', () => {
  const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
  assert.equal(fenToEPD(fen), 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6');
});

test('getPieceCount counts pieces on the board', () => {
  assert.equal(getPieceCount('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 32);
  assert.equal(getPieceCount('6k1/5ppp/8/8/8/8/8/R6K w - - 0 1'), 6);
});
