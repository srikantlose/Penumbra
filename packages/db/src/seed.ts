// Minimal local-dev seed: one dev user, one dev API key (printed once), and
// a two-ply demo game, so a fresh dev database has something to look at
// before any real Lichess import runs. Idempotent -- safe to re-run.
//
// Usage: node dist/seed.js (after `pnpm build`), or import { seed } and call
// it with an already-open Database.

import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { normalizeEPD, getPieceCount, computeZobristHash, zobristToHexString } from '@penumbra/core';
import { getDatabase, type Database } from './index.js';
import * as schema from './schema.js';

const DEV_USER_LICHESS_ID = 'seed-dev-user';
const DEV_API_KEY_NAME = 'dev-seed';
const DEMO_GAME_SOURCE_ID = 'demo-e4';

// Same '0x' + sha256(hex) convention as apps/api/src/plugins/auth.ts's
// hashApiKey -- duplicated rather than imported, since packages/db must not
// depend on apps/api (wrong direction in the workspace dependency graph).
function hashApiKey(key: string): string {
  return '0x' + crypto.createHash('sha256').update(key).digest('hex');
}

interface DemoPosition {
  fen: string;
  uci: string | null;
  san: string | null;
}

// Two plies: the startpos and the position after 1. e4. Hardcoded rather
// than PGN-parsed so this module doesn't need a move-generation dependency
// beyond what @penumbra/core already re-exports.
const DEMO_POSITIONS: DemoPosition[] = [
  { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', uci: null, san: null },
  { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', uci: 'e2e4', san: 'e4' },
];

export interface SeedResult {
  userId: number;
  gameId: number;
  /** Only set the first time this runs -- the raw key is never recoverable after that. */
  apiKey: string | null;
}

/** Idempotent: safe to run against an already-seeded database. */
export async function seed(db: Database): Promise<SeedResult> {
  const userId = await seedDevUser(db);
  const apiKey = await seedDevApiKey(db, userId);
  const gameId = await seedDemoGame(db, userId);
  return { userId, gameId, apiKey };
}

async function seedDevUser(db: Database): Promise<number> {
  await db
    .insert(schema.users)
    .values({ lichessId: DEV_USER_LICHESS_ID, lichessUsername: DEV_USER_LICHESS_ID })
    .onConflictDoNothing({ target: schema.users.lichessId });

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.lichessId, DEV_USER_LICHESS_ID))
    .limit(1);
  if (!user) throw new Error('failed to seed dev user');
  return user.id;
}

async function seedDevApiKey(db: Database, userId: number): Promise<string | null> {
  const [existing] = await db
    .select({ id: schema.apiKeys.id })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.name, DEV_API_KEY_NAME))
    .limit(1);
  if (existing) return null;

  const rawKey = 'pnb_' + crypto.randomBytes(32).toString('hex');
  await db.insert(schema.apiKeys).values({ userId, keyHash: hashApiKey(rawKey), name: DEV_API_KEY_NAME });
  return rawKey;
}

/** Inserts the demo game's positions/game_positions only the first time the game itself is inserted. */
async function seedDemoGame(db: Database, userId: number): Promise<number> {
  const [inserted] = await db
    .insert(schema.games)
    .values({
      source: 'seed',
      sourceGameId: DEMO_GAME_SOURCE_ID,
      white: 'Dev White',
      black: 'Dev Black',
      result: null,
      pgn: '1. e4 *',
      importedByUserId: userId,
    })
    .onConflictDoNothing({ target: [schema.games.source, schema.games.sourceGameId] })
    .returning({ id: schema.games.id });

  if (inserted) {
    for (const [ply, demo] of DEMO_POSITIONS.entries()) {
      const positionId = await upsertDemoPosition(db, demo.fen, inserted.id);
      await db.insert(schema.gamePositions).values({ gameId: inserted.id, ply, positionId, uci: demo.uci, san: demo.san });
    }
    return inserted.id;
  }

  const [existing] = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(and(eq(schema.games.source, 'seed'), eq(schema.games.sourceGameId, DEMO_GAME_SOURCE_ID)))
    .limit(1);
  if (!existing) throw new Error('failed to seed demo game');
  return existing.id;
}

async function upsertDemoPosition(db: Database, fen: string, gameId: number): Promise<number> {
  const epd = normalizeEPD(fen);
  await db
    .insert(schema.positions)
    .values({
      epd,
      zobrist: zobristToHexString(computeZobristHash(fen)),
      pieceCount: getPieceCount(fen),
      firstSeenGameId: gameId,
    })
    .onConflictDoNothing({ target: schema.positions.epd });

  const [position] = await db.select({ id: schema.positions.id }).from(schema.positions).where(eq(schema.positions.epd, epd)).limit(1);
  if (!position) throw new Error(`failed to seed position for epd "${epd}"`);
  return position.id;
}

function databaseUrl(): string {
  return process.env.DATABASE_URL || 'postgresql://penumbra:penumbra@localhost:5432/penumbra';
}

async function main(): Promise<void> {
  const db = await getDatabase(databaseUrl());
  const result = await seed(db);

  console.log(`seeded dev user ${result.userId}, demo game ${result.gameId}`);
  if (result.apiKey) {
    console.log('created a local-dev api key. Paste this into apps/web/.env.local:');
    console.log(`PENUMBRA_API_KEY=${result.apiKey}`);
  } else {
    console.log(`a "${DEV_API_KEY_NAME}" api key already exists -- the raw key was only printed once at creation.`);
  }
  process.exit(0);
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error('seed failed:', err.message);
    process.exit(1);
  });
}
