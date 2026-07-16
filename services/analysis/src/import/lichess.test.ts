import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLichessGame, parseLichessGameLine, deriveResult, lichessGameToUpsertInput } from './lichess.js';

function loadFixtureLines(name: string): string[] {
  const path = fileURLToPath(new URL(`../../test-fixtures/${name}`, import.meta.url));
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0);
}

describe('parseLichessGameLine', () => {
  const lines = loadFixtureLines('lichess-games.ndjson');

  it('parses a standard rated game with a winner', () => {
    const game = parseLichessGameLine(lines[0]);
    expect(game).toEqual({
      id: 'aBcD1234',
      players: { white: 'alice', black: 'bob' },
      winner: 'white',
      status: 'mate',
      pgn: '[Event "Rated blitz game"]\n[White "alice"]\n[Black "bob"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
      variant: 'standard',
      speed: 'blitz',
      createdAt: 1700000000000,
    });
  });

  it('parses a standard casual draw with no winner field as winner: undefined', () => {
    const game = parseLichessGameLine(lines[1]);
    expect(game?.winner).toBeUndefined();
    expect(game?.status).toBe('draw');
    expect(game?.players).toEqual({ white: 'carol', black: 'dave' });
  });

  it('filters out non-standard variants (crazyhouse)', () => {
    expect(parseLichessGameLine(lines[2])).toBeNull();
  });

  it('filters out games missing a pgn field (pgnInJson was not requested)', () => {
    expect(parseLichessGameLine(lines[3])).toBeNull();
  });

  it('parses an aborted game with no winner and a non-draw status', () => {
    const game = parseLichessGameLine(lines[4]);
    expect(game?.winner).toBeUndefined();
    expect(game?.status).toBe('aborted');
  });

  it('parses every fixture line without throwing, yielding exactly 3 standard games with pgn', () => {
    const parsed = lines.map(parseLichessGameLine).filter((g) => g !== null);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((g) => g.id)).toEqual(['aBcD1234', 'eFgH5678', 'qRsT7890']);
  });
});

describe('deriveResult', () => {
  it('maps a white winner to "1-0"', () => {
    expect(deriveResult('white', 'mate')).toBe('1-0');
  });

  it('maps a black winner to "0-1"', () => {
    expect(deriveResult('black', 'resign')).toBe('0-1');
  });

  it('maps no winner + a draw status to "1/2-1/2"', () => {
    expect(deriveResult(undefined, 'draw')).toBe('1/2-1/2');
    expect(deriveResult(undefined, 'stalemate')).toBe('1/2-1/2');
  });

  it('maps no winner + a non-draw status (aborted, noStart, ...) to null rather than assuming a draw', () => {
    expect(deriveResult(undefined, 'aborted')).toBeNull();
    expect(deriveResult(undefined, 'noStart')).toBeNull();
  });
});

describe('lichessGameToUpsertInput', () => {
  it('builds an UpsertGameInput with the derived result', () => {
    const game = parseLichessGameLine(loadFixtureLines('lichess-games.ndjson')[0])!;
    expect(lichessGameToUpsertInput(game)).toEqual({
      source: 'lichess',
      sourceGameId: 'aBcD1234',
      white: 'alice',
      black: 'bob',
      result: '1-0',
      pgn: game.pgn,
    });
  });

  it('carries a null result through for an aborted game', () => {
    const game = parseLichessGameLine(loadFixtureLines('lichess-games.ndjson')[4])!;
    expect(lichessGameToUpsertInput(game).result).toBeNull();
  });
});

describe('parseLichessGame', () => {
  it('falls back speed to perf when speed is absent', () => {
    const game = parseLichessGame({
      id: 'x',
      variant: 'standard',
      perf: 'bullet',
      createdAt: 1,
      pgn: '1. e4 *',
    });
    expect(game?.speed).toBe('bullet');
  });

  it('falls back to "unknown" speed when neither speed nor perf is present', () => {
    const game = parseLichessGame({ id: 'x', variant: 'standard', createdAt: 1, pgn: '1. e4 *' });
    expect(game?.speed).toBe('unknown');
  });

  it('defaults missing player names to null rather than throwing', () => {
    const game = parseLichessGame({ id: 'x', variant: 'standard', createdAt: 1, pgn: '1. e4 *' });
    expect(game?.players).toEqual({ white: null, black: null });
  });
});
