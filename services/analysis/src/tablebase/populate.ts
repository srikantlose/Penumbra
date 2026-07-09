import { eq } from 'drizzle-orm';
import { schema, SYZYGY_MAX_PIECES, type Database } from '@penumbra/db';
import { probeTablebase } from './lichess.js';

/**
 * Ensures a tb_probes row exists for a position within tablebase range,
 * probing Lichess's public API on cache miss (Stage 3 punted this
 * population step to Stage 4 -- see docs/ROADMAP.md). No-op above
 * SYZYGY_MAX_PIECES, when a row already exists, or when Lichess has no
 * definite result to cache. Local Syzygy probing (<= 5 men) is deferred.
 */
export async function ensureTablebaseProbe(
  db: Database,
  positionId: number,
  fen: string,
  pieceCount: number
): Promise<void> {
  if (pieceCount > SYZYGY_MAX_PIECES) return;

  const [existing] = await db
    .select({ id: schema.tbProbes.id })
    .from(schema.tbProbes)
    .where(eq(schema.tbProbes.positionId, positionId))
    .limit(1);
  if (existing) return;

  const result = await probeTablebase(fen);
  if (!result) return;

  await db
    .insert(schema.tbProbes)
    .values({
      positionId,
      wdlW: result.wdlWhite.wins,
      wdlD: result.wdlWhite.draws,
      wdlL: result.wdlWhite.losses,
      dtz: result.dtz,
      source: 'lichess',
    })
    .onConflictDoNothing({ target: schema.tbProbes.positionId });
}
