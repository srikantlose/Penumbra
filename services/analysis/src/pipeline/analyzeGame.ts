import { asc, eq, inArray } from 'drizzle-orm';
import { QueueEvents } from 'bullmq';
import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { normalizeEPD, TruthStatus } from '@penumbra/core';
import { schema, isPositionProven, SYZYGY_MAX_PIECES, type Database } from '@penumbra/db';
import type { Tier as EngineTier } from '../engines/config.js';
import { computeFingerprintForTier } from '../fingerprint.js';
import {
  createAnalyzePositionQueue,
  createRedisConnection,
  enqueueAnalyzePosition,
  queueNameForTier,
} from '../queue/queues.js';
import {
  detectMissedProofs,
  detectProofEntryPly,
  type AnalyzedPosition,
  type ChildMove,
  type MissedProofEntry,
} from './proofEntry.js';
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

// Per-job wait budgets, multiplied by the game's own position count below.
// waitUntilFinished's ttl counts from the moment it's called (right after
// enqueueing), not from when the worker picks the job up -- so for a game
// with many positions, a job near the back of the queue can legitimately
// still be *waiting* its turn when a flat per-job ttl would already have
// expired. A 49-ply game at quick tier (concurrency 2, ~50s/position
// observed) needs ~20 minutes of real wall time; a flat 10-minute ttl timed
// out on positions still queued behind their peers, not on anything actually
// stuck. Budgeting per position (ignoring concurrency, so this only ever
// over-estimates) fixes that without coupling this module to worker.ts's
// concurrency settings.
const QUICK_PER_POSITION_BUDGET_MS = 90 * 1000;
const CANONICAL_PER_POSITION_BUDGET_MS = 10 * 60 * 1000;

function jobWaitTtlMs(engineTier: EngineTier, positionCount: number): number {
  const perPosition = engineTier === 'canonical' ? CANONICAL_PER_POSITION_BUDGET_MS : QUICK_PER_POSITION_BUDGET_MS;
  return positionCount * perPosition;
}

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

  // A position with zero legal moves is checkmate or stalemate. Chess rules
  // forbid any move after that, so it can only ever be the game's last
  // recorded position -- and an engine has nothing to search there (Stockfish
  // emits no info/wdl lines, which is what runStockfishLadder's "no wdl
  // reported" error is guarding against). The outcome is already fully
  // determined by the rules rather than by search, so this position is
  // excluded from engine analysis and given a certain, zero-fog entry
  // directly. detectProofEntryPly/detectMissedProofs still see the full
  // `positions` list -- they already handle the last position correctly on
  // their own terms.
  const lastPosition = positions[positions.length - 1];
  const terminal = lastPosition && !hasLegalMoves(lastPosition.epd) ? lastPosition : null;
  const enginePositions = terminal ? positions.slice(0, -1) : positions;

  const queueConnection = createRedisConnection();
  const eventsConnection = createRedisConnection();
  const queue = createAnalyzePositionQueue(engineTier, queueConnection);
  const queueEvents = new QueueEvents(queueNameForTier(engineTier), { connection: eventsConnection });

  try {
    await queueEvents.waitUntilReady();

    // Each in-flight job.waitUntilFinished() below adds a 'closing' listener
    // to this queue for the duration of its wait, so a full game's worth of
    // concurrent waits routinely exceeds EventEmitter's default limit of 10 --
    // harmless (BullMQ removes each listener as its job settles), but the
    // resulting MaxListenersExceededWarning is noise worth silencing.
    queue.setMaxListeners(enginePositions.length + 10);

    // Marks the row as no longer just sitting in the create-time default --
    // anything that fails past this point should end at 'failed', not linger
    // at 'queued' forever (see the catch block below).
    await db.update(schema.analyses).set({ status: 'running' }).where(eq(schema.analyses.id, analysisId));

    const priority = input.tier === 'deep' ? DEEP_TIER_PRIORITY : undefined;
    const jobIds = await Promise.all(
      enginePositions.map((position) => enqueueAnalyzePosition(queue, epdToFen(position.epd), engineTier, { priority }))
    );

    const ttl = jobWaitTtlMs(engineTier, enginePositions.length);
    const results = await Promise.all(
      jobIds.map(async (jobId) => {
        const job = await queue.getJob(jobId);
        if (!job) throw new Error(`analyze-position job "${jobId}" vanished before completion`);
        return job.waitUntilFinished(queueEvents, ttl);
      })
    );

    const fogTimeline: FogTimelineEntry[] = enginePositions.map((position, i) => ({
      ply: position.ply,
      positionId: position.positionId,
      san: position.san,
      fog: results[i].score,
      percentile: results[i].percentile,
      status: results[i].status,
      fingerprint: results[i].engineFingerprint,
    }));

    if (terminal) {
      fogTimeline.push({
        ply: terminal.ply,
        positionId: terminal.positionId,
        san: terminal.san,
        fog: 0,
        percentile: null,
        status: TruthStatus.PROVEN,
        fingerprint: computeFingerprintForTier(engineTier),
      });
    }

    const epdByPositionId = new Map(positions.map((position) => [position.positionId, position.epd]));

    const [proofEntryPly, missedProofs] = await Promise.all([
      detectProofEntryPly(positions, async (positionId, pieceCount) => {
        const epd = epdByPositionId.get(positionId);
        if (epd) await ensureTablebaseProbe(db, positionId, epdToFen(epd), pieceCount);
        return isPositionProven(db, positionId, pieceCount);
      }),
      detectMissedProofs(positions, (children, mover) => findProvenWinningMoves(db, children, mover)),
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
  } catch (err) {
    // Best-effort: don't let a failure to mark the row 'failed' mask the
    // real error that caused this catch in the first place.
    await db
      .update(schema.analyses)
      .set({ status: 'failed' })
      .where(eq(schema.analyses.id, analysisId))
      .catch(() => {});
    throw err;
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

// Defensive on parse/setup failure: treat as "has legal moves" so an
// unparseable epd falls through to the normal engine path (and whatever
// error that path already raises) rather than being silently skipped here.
function hasLegalMoves(epd: string): boolean {
  const parsed = parseFen(epdToFen(epd));
  if (parsed.isErr) return true;
  const posResult = Chess.fromSetup(parsed.value);
  if (posResult.isErr) return true;
  return posResult.value.hasDests();
}

// Backs detectMissedProofs' per-ply batch predicate. Deliberately not
// bounded by piece count on the parent side -- a `proofs` row can apply at
// any material count (e.g. a transposition into an already-proven
// fortress), so the only piece-count cutoff that belongs here is
// ensureTablebaseProbe's own internal SYZYGY_MAX_PIECES check, which keeps
// this from ever issuing a network probe for a child outside TB coverage.
// Batches both the positions/proofs lookups and the tb_probes lookup into
// one query each (per ply) instead of one round trip per candidate move,
// since a single ply's legal moves can otherwise number in the dozens
// during the opening/middlegame.
async function findProvenWinningMoves(
  db: Database,
  children: ChildMove[],
  mover: 'white' | 'black'
): Promise<Set<string>> {
  const ucisByEpd = new Map<string, string[]>();
  for (const child of children) {
    const epd = normalizeEPD(child.fen);
    const ucis = ucisByEpd.get(epd);
    if (ucis) ucis.push(child.uci);
    else ucisByEpd.set(epd, [child.uci]);
  }
  const epds = [...ucisByEpd.keys()];

  const positionRows = await db
    .select({ id: schema.positions.id, epd: schema.positions.epd, pieceCount: schema.positions.pieceCount })
    .from(schema.positions)
    .where(inArray(schema.positions.epd, epds));
  if (positionRows.length === 0) return new Set();

  const epdById = new Map(positionRows.map((row) => [row.id, row.epd]));
  const winningEpds = new Set<string>();
  const provenIds = new Set<number>();

  const proofRows = await db
    .select({ positionId: schema.proofs.positionId, value: schema.proofs.value, claim: schema.proofs.claim })
    .from(schema.proofs)
    .where(inArray(schema.proofs.positionId, positionRows.map((row) => row.id)));
  for (const row of proofRows) {
    const claim = row.claim as { side?: string };
    if (row.value !== 'win' || claim.side !== mover) continue;
    provenIds.add(row.positionId);
    const epd = epdById.get(row.positionId);
    if (epd) winningEpds.add(epd);
  }

  // Tablebase fallback, only for candidates not already settled by a proof
  // and within TB coverage -- ensureTablebaseProbe no-ops above
  // SYZYGY_MAX_PIECES, so this never probes the network for material
  // outside its range.
  const tbCandidates = positionRows.filter((row) => !provenIds.has(row.id) && row.pieceCount <= SYZYGY_MAX_PIECES);
  if (tbCandidates.length > 0) {
    const tbCandidateIds = tbCandidates.map((row) => row.id);
    await Promise.all(tbCandidates.map((row) => ensureTablebaseProbe(db, row.id, epdToFen(row.epd), row.pieceCount)));

    const tbRows = await db
      .select({ positionId: schema.tbProbes.positionId, wdlW: schema.tbProbes.wdlW, wdlL: schema.tbProbes.wdlL })
      .from(schema.tbProbes)
      .where(inArray(schema.tbProbes.positionId, tbCandidateIds));
    for (const row of tbRows) {
      const moverWins = mover === 'white' ? row.wdlW : row.wdlL;
      if ((moverWins ?? 0) <= 0) continue;
      const epd = epdById.get(row.positionId);
      if (epd) winningEpds.add(epd);
    }
  }

  const winningUcis = new Set<string>();
  for (const [epd, ucis] of ucisByEpd) {
    if (!winningEpds.has(epd)) continue;
    for (const uci of ucis) winningUcis.add(uci);
  }
  return winningUcis;
}
