import type { Database } from '@penumbra/db';
import { extractPositions, type ExtractedPosition } from './pgn.js';
import { upsertGame, upsertPositions, insertGamePositions, type UpsertGameInput } from './persist.js';

export interface ImportGameResult {
  gameId: number;
  positions: ExtractedPosition[];
  epdToId: Map<string, number>;
}

/** Imports one game end-to-end: game row, every position, the ply chain linking them. */
export async function importGame(db: Database, input: UpsertGameInput): Promise<ImportGameResult> {
  const gameId = await upsertGame(db, input);
  const positions = extractPositions(input.pgn);
  const epdToId = await upsertPositions(db, gameId, positions);
  await insertGamePositions(db, gameId, positions, epdToId);
  return { gameId, positions, epdToId };
}
