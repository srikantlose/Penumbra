import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBestMove, parseInfoLine } from './parse.js';

function loadFixture(name: string): string[] {
  const path = fileURLToPath(new URL(`../../test-fixtures/${name}`, import.meta.url));
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0);
}

// Token-based, unlike a naive `line.indexOf('pv ')`, which also matches the
// tail of `multipv 1 pv ...` since "multipv" itself ends in "pv".
function pvFromLine(line: string): string[] {
  const tokens = line.trim().split(/\s+/);
  const pvIdx = tokens.indexOf('pv');
  return tokens.slice(pvIdx + 1);
}

describe('parseInfoLine', () => {
  it('returns null for non-info lines', () => {
    expect(parseInfoLine('id name Stockfish 18')).toBeNull();
    expect(parseInfoLine('uciok')).toBeNull();
    expect(parseInfoLine('readyok')).toBeNull();
    expect(parseInfoLine('bestmove e2e4 ponder e7e5')).toBeNull();
    expect(parseInfoLine('option name Threads type spin default 1')).toBeNull();
  });

  it('parses the final Stockfish multipv 1 line from the committed transcript', () => {
    const line =
      'info depth 17 seldepth 41 multipv 1 score cp 41 wdl 94 902 4 nodes 1000145 nps 1261216 hashfull 22 tbhits 0 time 793 pv e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f6e4 d2d4 b7b5 a4b3 d7d5 d4e5 c8e6 c2c3 f8e7 b1d2 e4c5 b3c2 d5d4 f3d4 c6d4 c3d4 d8d4 d2f3 d4d1 f1d1 a8d8';
    expect(parseInfoLine(line)).toEqual({
      depth: 17,
      seldepth: 41,
      multipv: 1,
      scoreCp: 41,
      wdl: { w: 94, d: 902, l: 4 },
      nodes: 1000145,
      nps: 1261216,
      pv: pvFromLine(line),
    });
  });

  it('parses a Lc0 line whose field order differs from Stockfish (time before nodes, multipv near the end)', () => {
    const line =
      'info depth 7 seldepth 29 time 33429 nodes 22786 score cp 11 wdl 207 636 157 nps 683 tbhits 0 multipv 1 pv d2d4 g8f6 c2c4 c7c6 g1f3 d7d5 b1c3 e7e6 c1g5 h7h6 g5h4 d5c4 e2e4 g7g5 h4g3 b7b5 h2h4';
    expect(parseInfoLine(line)).toEqual({
      depth: 7,
      seldepth: 29,
      nodes: 22786,
      scoreCp: 11,
      wdl: { w: 207, d: 636, l: 157 },
      nps: 683,
      multipv: 1,
      pv: pvFromLine(line),
    });
  });

  it('parses a mate score', () => {
    const info = parseInfoLine('info depth 5 score mate 3 nodes 100 pv e2e4');
    expect(info?.scoreMate).toBe(3);
    expect(info?.scoreCp).toBeUndefined();
  });

  it('skips unrecognized keys defensively without corrupting later fields', () => {
    const info = parseInfoLine('info depth 10 currmove e2e4 currmovenumber 1 nodes 500');
    expect(info?.depth).toBe(10);
    expect(info?.nodes).toBe(500);
  });

  it('parses every info line in the committed Stockfish transcript without throwing, including info string lines', () => {
    const lines = loadFixture('stockfish-transcript.txt');
    const infoLines = lines.filter((l) => l.startsWith('info '));
    expect(infoLines.length).toBeGreaterThan(0);
    for (const line of infoLines) {
      expect(parseInfoLine(line)).not.toBeNull();
    }

    const searchLines = lines.filter((l) => l.startsWith('info depth'));
    expect(searchLines.length).toBeGreaterThan(0);
    for (const line of searchLines) {
      const info = parseInfoLine(line);
      expect(info?.multipv).toBeGreaterThanOrEqual(1);
      expect(info?.wdl).toBeDefined();
    }
  });

  it('parses every info line in the committed Lc0 transcript without throwing', () => {
    const lines = loadFixture('lc0-transcript.txt');
    const searchLines = lines.filter((l) => l.startsWith('info depth'));
    expect(searchLines.length).toBeGreaterThan(0);
    for (const line of searchLines) {
      const info = parseInfoLine(line);
      expect(info).not.toBeNull();
      expect(info?.multipv).toBeGreaterThanOrEqual(1);
      expect(info?.wdl).toBeDefined();
    }
  });
});

describe('parseBestMove', () => {
  it('parses a bestmove line with ponder', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({
      bestMove: 'e2e4',
      ponder: 'e7e5',
    });
  });

  it('parses a bestmove line without ponder', () => {
    expect(parseBestMove('bestmove e2e4')).toEqual({ bestMove: 'e2e4' });
  });

  it('returns null for non-bestmove lines', () => {
    expect(parseBestMove('info depth 1')).toBeNull();
    expect(parseBestMove('uciok')).toBeNull();
  });

  it('parses the final bestmove line from each committed transcript', () => {
    const sfLines = loadFixture('stockfish-transcript.txt');
    const lc0Lines = loadFixture('lc0-transcript.txt');
    expect(parseBestMove(sfLines[sfLines.length - 1])).toEqual({
      bestMove: 'e2e4',
      ponder: 'e7e5',
    });
    expect(parseBestMove(lc0Lines[lc0Lines.length - 1])).toEqual({
      bestMove: 'd2d4',
      ponder: 'g8f6',
    });
  });
});
