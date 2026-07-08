import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeZobristHash, zobristFromHexString, zobristToHexString } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Vector {
  label: string;
  fen: string;
  zobrist_hex: string;
}

function loadVectors(): Vector[] {
  const fixturePath = join(__dirname, '..', '..', 'test-fixtures', 'zobrist-vectors.json');
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

test('matches shakmaty (Rust reference) on every cross-implementation vector', () => {
  const vectors = loadVectors();
  assert.ok(vectors.length > 0);

  for (const v of vectors) {
    const hash = computeZobristHash(v.fen);
    const hex = zobristToHexString(hash);
    assert.equal(
      hex,
      v.zobrist_hex,
      `${v.label}: fen "${v.fen}" hashed to ${hex}, fixture declares ${v.zobrist_hex}`
    );
  }
});

test('startpos hash matches the well-known Polyglot constant', () => {
  const hash = computeZobristHash('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(zobristToHexString(hash), '0x463b96181691fc9c');
});

test('a legally uncapturable en passant square does not affect the hash', () => {
  // Same position with and without the (uncapturable) ep field must hash
  // identically -- the ep file is only XORed in when a legal capture exists.
  const withEp = computeZobristHash('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2');
  const withoutEp = computeZobristHash('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  assert.equal(zobristToHexString(withEp), zobristToHexString(withoutEp));
});

test('a legally capturable en passant square does affect the hash', () => {
  const withEp = computeZobristHash('rnbqkbnr/1pppp1pp/p7/4Pp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  const withoutEp = computeZobristHash('rnbqkbnr/1pppp1pp/p7/4Pp2/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3');
  assert.notEqual(zobristToHexString(withEp), zobristToHexString(withoutEp));
});

test('hex round-trip is exact', () => {
  const hash = computeZobristHash('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const hex = zobristToHexString(hash);
  assert.equal(hex.length, 18);
  assert.equal(zobristFromHexString(hex), hash);
});
