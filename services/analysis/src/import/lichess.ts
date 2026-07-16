import type { UpsertGameInput } from './persist.js';

const LICHESS_BASE = 'https://lichess.org';
const REQUEST_TIMEOUT_MS = 30_000;

export interface LichessGame {
  id: string;
  players: { white: string | null; black: string | null };
  winner: 'white' | 'black' | undefined;
  /** Lichess's own game-end status (e.g. "mate", "resign", "draw", "aborted", "noStart"). */
  status: string;
  pgn: string;
  variant: string;
  speed: string;
  createdAt: number;
}

interface RawLichessGame {
  id: string;
  variant: string;
  speed?: string;
  perf?: string;
  createdAt: number;
  status?: string;
  players?: {
    white?: { user?: { name?: string } };
    black?: { user?: { name?: string } };
  };
  winner?: 'white' | 'black';
  pgn?: string;
}

/**
 * Parses one raw JSON game object from Lichess's export API into the shape
 * this pipeline persists. Returns null for non-standard variants (rules:
 * "standard" invariant -- see docs/ROADMAP.md Stage 4) or games missing a
 * pgn field (the caller forgot pgnInJson=true).
 */
export function parseLichessGame(raw: unknown): LichessGame | null {
  const game = raw as RawLichessGame;
  if (game.variant !== 'standard') return null;
  if (!game.pgn) return null;

  return {
    id: game.id,
    players: {
      white: game.players?.white?.user?.name ?? null,
      black: game.players?.black?.user?.name ?? null,
    },
    winner: game.winner,
    status: game.status ?? 'unknown',
    pgn: game.pgn,
    variant: game.variant,
    speed: game.speed ?? game.perf ?? 'unknown',
    createdAt: game.createdAt,
  };
}

// The only Lichess end statuses that mean "no winner, but a genuine draw".
// Every other no-winner status (aborted, noStart, cheat, unknownFinish, ...)
// has no well-defined game result, so it maps to null rather than silently
// becoming a draw.
const DRAW_STATUSES = new Set(['draw', 'stalemate']);

/** '1-0' / '0-1' / '1/2-1/2' / null (no well-defined result), from Lichess's own winner + status fields. */
export function deriveResult(winner: 'white' | 'black' | undefined, status: string): string | null {
  if (winner === 'white') return '1-0';
  if (winner === 'black') return '0-1';
  return DRAW_STATUSES.has(status) ? '1/2-1/2' : null;
}

/** Shared by the CLI import path and the /bff/import route so the two never drift. */
export function lichessGameToUpsertInput(game: LichessGame): UpsertGameInput {
  return {
    source: 'lichess',
    sourceGameId: game.id,
    white: game.players.white,
    black: game.players.black,
    result: deriveResult(game.winner, game.status),
    pgn: game.pgn,
  };
}

export function parseLichessGameLine(line: string): LichessGame | null {
  return parseLichessGame(JSON.parse(line));
}

async function* streamNdjsonLines(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line.length > 0) yield line;
      }
    }
    const last = buffer.trim();
    if (last.length > 0) yield last;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Streams a Lichess user's public games via the NDJSON export API -- no
 * OAuth needed for public games. Callers must not run more than one of
 * these concurrently (Lichess etiquette: one export stream at a time, no
 * hammering); the CLI import path only ever drives one at once.
 */
export async function* streamUserGames(username: string, opts: { max: number }): AsyncGenerator<LichessGame> {
  const url = new URL(`${LICHESS_BASE}/api/games/user/${encodeURIComponent(username)}`);
  url.searchParams.set('max', String(opts.max));
  url.searchParams.set('moves', 'true');
  url.searchParams.set('pgnInJson', 'true');

  const response = await fetch(url, {
    headers: { Accept: 'application/x-ndjson' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`lichess games export failed for "${username}": ${response.status} ${response.statusText}`);
  }

  for await (const line of streamNdjsonLines(response)) {
    const game = parseLichessGameLine(line);
    if (game) yield game;
  }
}

/** Fetches a single game by id (manual re-import / backfill). */
export async function fetchGame(gameId: string): Promise<LichessGame> {
  const url = new URL(`${LICHESS_BASE}/game/export/${encodeURIComponent(gameId)}`);
  url.searchParams.set('pgnInJson', 'true');

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`lichess game export failed for "${gameId}": ${response.status} ${response.statusText}`);
  }

  const game = parseLichessGame(await response.json());
  if (!game) {
    throw new Error(`game "${gameId}" is not a standard-variant game with a pgn field`);
  }
  return game;
}
