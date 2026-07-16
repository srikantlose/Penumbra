import { and, eq, sql } from 'drizzle-orm';
import { schema, type Database } from '@penumbra/db';
import type { ExtractedPosition } from './pgn.js';

export interface UpsertGameInput {
  source: string;
  sourceGameId: string;
  white: string | null;
  black: string | null;
  result: string | null;
  pgn: string;
}

/** Inserts a game row if one doesn't already exist for (source, source_game_id); returns its id either way. */
export async function upsertGame(db: Database, input: UpsertGameInput): Promise<number> {
  await db
    .insert(schema.games)
    .values(input)
    .onConflictDoNothing({ target: [schema.games.source, schema.games.sourceGameId] });

  const [row] = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(and(eq(schema.games.source, input.source), eq(schema.games.sourceGameId, input.sourceGameId)))
    .limit(1);

  if (!row) throw new Error(`failed to upsert game ${input.source}/${input.sourceGameId}`);
  return row.id;
}

/**
 * Upserts every extracted position, bumping occurrence_count on every
 * occurrence (including repeats within the same game, e.g. via repetition)
 * -- positions is a counter table, not append-only (see docs/ROADMAP.md
 * Stage 4). first_seen_game_id is only ever set by the initial insert; the
 * ON CONFLICT branch deliberately never touches it. Sequential per-position
 * round trips rather than one bulk statement: Postgres rejects a bulk
 * INSERT ... ON CONFLICT DO UPDATE that hits the same conflict target twice
 * in one statement, which a repeated position within a game would trigger.
 */
export async function upsertPositions(
  db: Database,
  gameId: number,
  positions: ExtractedPosition[]
): Promise<Map<string, number>> {
  const epdToId = new Map<string, number>();

  for (const position of positions) {
    await db
      .insert(schema.positions)
      .values({
        epd: position.epd,
        zobrist: position.zobristHex,
        pieceCount: position.pieceCount,
        firstSeenGameId: gameId,
        occurrenceCount: 1,
      })
      .onConflictDoUpdate({
        target: schema.positions.epd,
        set: { occurrenceCount: sql`${schema.positions.occurrenceCount} + 1` },
      });

    const [row] = await db
      .select({ id: schema.positions.id })
      .from(schema.positions)
      .where(eq(schema.positions.epd, position.epd))
      .limit(1);

    if (!row) throw new Error(`failed to upsert position for epd "${position.epd}"`);
    epdToId.set(position.epd, row.id);
  }

  return epdToId;
}

export interface UpsertLichessUserInput {
  lichessId: string;
  lichessUsername: string;
  encryptedOauthTokens: string;
}

/** Inserts or updates the users row for a connected Lichess account (identified by lichess_id); returns its id either way. */
export async function upsertLichessUser(db: Database, input: UpsertLichessUserInput): Promise<number> {
  await db
    .insert(schema.users)
    .values({
      lichessId: input.lichessId,
      lichessUsername: input.lichessUsername,
      oauthTokens: input.encryptedOauthTokens,
    })
    .onConflictDoUpdate({
      target: schema.users.lichessId,
      set: { lichessUsername: input.lichessUsername, oauthTokens: input.encryptedOauthTokens },
    });

  const [row] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.lichessId, input.lichessId)).limit(1);

  if (!row) throw new Error(`failed to upsert user for lichess id "${input.lichessId}"`);
  return row.id;
}

/** Bulk-inserts the game's ply chain into game_positions in one statement. */
export async function insertGamePositions(
  db: Database,
  gameId: number,
  positions: ExtractedPosition[],
  epdToId: Map<string, number>
): Promise<void> {
  type GamePositionInsert = typeof schema.gamePositions.$inferInsert;

  const rows: GamePositionInsert[] = positions.map((position) => {
    const positionId = epdToId.get(position.epd);
    if (positionId === undefined) throw new Error(`missing position id for epd "${position.epd}"`);
    return { gameId, ply: position.ply, positionId, uci: position.uci, san: position.san };
  });

  if (rows.length > 0) {
    await db.insert(schema.gamePositions).values(rows);
  }
}
