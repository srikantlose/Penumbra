import { asc, eq } from 'drizzle-orm';
import { QueueEvents } from 'bullmq';
import { normalizeEPD, type TruthStatus } from '@penumbra/core';
import { schema, isPositionProven, type Database } from '@penumbra/db';
import type { Tier as EngineTier } from '../engines/config.js';
import { computeFingerprintForTier } from '../fingerprint.js';
import {
  createAnalyzePositionQueue,
  createRedisConnection,
  enqueueAnalyzePosition,
  queueNameForTier,
} from '../queue/queues.js';
import { detectMissedProofs, detectProofEntryPly, type AnalyzedPosition, type MissedProofEntry } from './proofEntry.js';
import { ensureTablebaseProbe } from '../tablebase/populate.js';

// analyses.tier speaks the game-analysis vocabulary ('quick' | 'deep'), not
// the engine-settings vocabulary ('quick' | 'canonical') -- 'deep' enqueues
// its per-position work at the canonical engine tier. Kept distinct because
// a future tier could map to something other than a 1:1 engine tier.
export type AnalysisTier = 'quick' | 'deep';

function engineTierFor(tier: AnalysisTier): EngineTier {
  return tier === 'deep' ? 'canonical' : 'quick';
}

// BullMQ priority: 0 (default) is highest; higher numbers run later. Deep
// analyses share the single-concurrency canonical queue with any ad hoc
// canonical request (e.g. a direct `analyze --tier canonical` call), so a
// batch game analysis shouldn't jump ahead of those -- see docs/ROADMAP.md
// Stage 4.
const DEEP_TIER_PRIORITY = 10;

// Generous per-position wait: canonical-tier searches run ~30s/position on
// this hardware (see docs/ENGINES.md), and jobs can also queue behind other
// work at concurrency 1.
const JOB_WAIT_TTL_MS = 10 * 60 * 1000;

export interface AnalyzeGameInput {
  gameId: number;
  tier: AnalysisTier;
}

export interface FogTimelineEntry {
  ply: number;
  positionId: number;
  san: string;
  fog: number;
  percentile: number | null;
  status: TruthStatus;
  fingerprint: string;
}

export interface AnalyzeGameOutput {
  analysisId: number;
  fogTimeline: FogTimelineEntry[];
  proofEntryPly: number | null;
  missedProofs: MissedProofEntry[];
}

/**
 * Runs a full game analysis: enqueues every position (ply >= 1; ply 0 is
 * the bare startpos) for engine scoring, waits for the results via BullMQ's
 * QueueEvents, assembles the fog timeline, and detects proof entry / missed
 * proofs. Assumes a worker process (queue/worker.ts) is running against the
 * same Redis instance to actually process the jobs.
 */
export async function analyzeGame(db: Database, input: AnalyzeGameInput): Promise<AnalyzeGameOutput> {
  const engineTier = engineTierFor(input.tier);
  const analysisId = await createAnalysisRow(db, input.gameId, input.tier);
  const positions = await loadGamePositions(db, input.gameId);

  const queueConnection = createRedisConnection();
  const eventsConnection = createRedisConnection();
  const queue = createAnalyzePositionQueue(engineTier, queueConnection);
  const queueEvents = new QueueEvents(queueNameForTier(engineTier), { connection: eventsConnection });

  try {
    await queueEvents.waitUntilReady();

    const priority = input.tier === 'deep' ? DEEP_TIER_PRIORITY : undefined;
    const jobIds = await Promise.all(
      positions.map((position) => enqueueAnalyzePosition(queue, epdToFen(position.epd), engineTier, { priority }))
    );

    const results = await Promise.all(
      jobIds.map(async (jobId) => {
        const job = await queue.getJob(jobId);
        if (!job) throw new Error(`analyze-position job "${jobId}" vanished before completion`);
        return job.waitUntilFinished(queueEvents, JOB_WAIT_TTL_MS);
      })
    );

    const fogTimeline: FogTimelineEntry[] = positions.map((position, i) => ({
      ply: position.ply,
      positionId: position.positionId,
      san: position.san,
      fog: results[i].score,
      percentile: results[i].percentile,
      status: results[i].status,
      fingerprint: results[i].engineFingerprint,
    }));

    const epdByPositionId = new Map(positions.map((position) => [position.positionId, position.epd]));

    const [proofEntryPly, missedProofs] = await Promise.all([
      detectProofEntryPly(positions, async (positionId, pieceCount) => {
        const epd = epdByPositionId.get(positionId);
        if (epd) await ensureTablebaseProbe(db, positionId, epdToFen(epd), pieceCount);
        return isPositionProven(db, positionId, pieceCount);
      }),
      detectMissedProofs(positions, (fen, mover) => isProvenWinForMover(db, fen, mover)),
    ]);

    await db
      .update(schema.analyses)
      .set({
        status: 'done',
        fogTimeline,
        proofEntryPly,
        missedProofs,
        engineFingerprint: computeFingerprintForTier(engineTier),
        completedAt: new Date(),
      })
      .where(eq(schema.analyses.id, analysisId));

    return { analysisId, fogTimeline, proofEntryPly, missedProofs };
  } finally {
    await queueEvents.close();
    await queue.close();
    queueConnection.disconnect();
    eventsConnection.disconnect();
  }
}

async function createAnalysisRow(db: Database, gameId: number, tier: AnalysisTier): Promise<number> {
  const [row] = await db.insert(schema.analyses).values({ gameId, tier, status: 'queued' }).returning({
    id: schema.analyses.id,
  });
  return row.id;
}

async function loadGamePositions(db: Database, gameId: number): Promise<AnalyzedPosition[]> {
  const rows = await db
    .select({
      ply: schema.gamePositions.ply,
      positionId: schema.gamePositions.positionId,
      san: schema.gamePositions.san,
      uci: schema.gamePositions.uci,
      epd: schema.positions.epd,
      pieceCount: schema.positions.pieceCount,
    })
    .from(schema.gamePositions)
    .innerJoin(schema.positions, eq(schema.gamePositions.positionId, schema.positions.id))
    .where(eq(schema.gamePositions.gameId, gameId))
    .orderBy(asc(schema.gamePositions.ply));

  // Ply 0 (the bare startpos) has no san/uci and isn't part of the fog
  // timeline or proof-entry scan -- every ply >= 1 row must have both.
  return rows
    .filter((row) => row.ply > 0)
    .map((row) => {
      if (row.san === null || row.uci === null) {
        throw new Error(`game_positions row for game ${gameId} ply ${row.ply} is missing san/uci`);
      }
      return { ...row, san: row.san, uci: row.uci };
    });
}

// EPD omits the two FEN move counters; appending neutral defaults produces
// a fully valid, analyzable FEN -- engines only need the current legal
// position, not real historical counters.
function epdToFen(epd: string): string {
  return `${epd} 0 1`;
}

async function isProvenWinForMover(db: Database, fen: string, mover: 'white' | 'black'): Promise<boolean> {
  const epd = normalizeEPD(fen);
  const [position] = await db
    .select({ id: schema.positions.id, pieceCount: schema.positions.pieceCount })
    .from(schema.positions)
    .where(eq(schema.positions.epd, epd))
    .limit(1);
  if (!position) return false;

  const [proof] = await db
    .select({ value: schema.proofs.value, claim: schema.proofs.claim })
    .from(schema.proofs)
    .where(eq(schema.proofs.positionId, position.id))
    .limit(1);
  if (proof) {
    const claim = proof.claim as { side?: string };
    if (proof.value === 'win' && claim.side === mover) return true;
  }

  // Fall back to a tablebase-cache-backed win (probing Lichess on cache
  // miss). wdlW/wdlL are stored White-perspective, so "mover wins" reads
  // wdlW for White or wdlL for Black.
  await ensureTablebaseProbe(db, position.id, fen, position.pieceCount);
  const [tbProbe] = await db
    .select({ wdlW: schema.tbProbes.wdlW, wdlL: schema.tbProbes.wdlL })
    .from(schema.tbProbes)
    .where(eq(schema.tbProbes.positionId, position.id))
    .limit(1);
  if (!tbProbe) return false;

  const moverWins = mover === 'white' ? tbProbe.wdlW : tbProbe.wdlL;
  return (moverWins ?? 0) > 0;
}
