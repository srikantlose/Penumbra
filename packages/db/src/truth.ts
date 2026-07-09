import { eq } from 'drizzle-orm';
import { TruthStatus } from '@penumbra/core';
import * as schema from './schema.js';
import type { Database } from './index.js';

// Tablebase-backed proof only means something inside actual Syzygy/Lichess
// TB coverage -- mirrors the Fog Index's own tablebase-distance component
// boundary (docs/FOG_INDEX_METHODOLOGY.md).
export const SYZYGY_MAX_PIECES = 7;

export interface TruthInputs {
  pieceCount: number;
  hasProof: boolean;
  hasTablebaseProbe: boolean;
}

/**
 * The single source of truth for EVALUATED vs. PROVEN -- web, the API, and
 * the analysis worker must not disagree, so nobody re-derives this decision
 * independently (docs/ROADMAP.md Stage 4). Pure and DB-free by design,
 * unlike fetchTruthInputs, so it's directly unit-testable without mocking a
 * database.
 */
export function deriveTruthStatus(input: TruthInputs): TruthStatus {
  if (input.hasProof) return TruthStatus.PROVEN;
  if (input.pieceCount <= SYZYGY_MAX_PIECES && input.hasTablebaseProbe) return TruthStatus.PROVEN;
  return TruthStatus.EVALUATED;
}

/** Fetches the raw signals deriveTruthStatus() needs for a given position. */
export async function fetchTruthInputs(db: Database, positionId: number, pieceCount: number): Promise<TruthInputs> {
  const [proof] = await db
    .select({ id: schema.proofs.id })
    .from(schema.proofs)
    .where(eq(schema.proofs.positionId, positionId))
    .limit(1);

  let hasTablebaseProbe = false;
  if (!proof && pieceCount <= SYZYGY_MAX_PIECES) {
    const [tbProbe] = await db
      .select({ id: schema.tbProbes.id })
      .from(schema.tbProbes)
      .where(eq(schema.tbProbes.positionId, positionId))
      .limit(1);
    hasTablebaseProbe = !!tbProbe;
  }

  return { pieceCount, hasProof: !!proof, hasTablebaseProbe };
}

/** Convenience wrapper: fetches the signals and derives the status in one round trip pattern. */
export async function isPositionProven(db: Database, positionId: number, pieceCount: number): Promise<boolean> {
  return deriveTruthStatus(await fetchTruthInputs(db, positionId, pieceCount)) === TruthStatus.PROVEN;
}
