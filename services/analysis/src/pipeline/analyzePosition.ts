import { eq } from 'drizzle-orm';
import { parseFen, makeFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import type { Move, Role } from 'chessops/types';
import {
  computeZobristHash,
  getPieceCount,
  normalizeEPD,
  zobristToHexString,
  type FogScore,
} from '@penumbra/core';
import { computeFogIndex, getCalibration, winProbability, type EngineEvals } from '@penumbra/fog';
import { schema, type Database } from '@penumbra/db';
import { runStockfishLadder, type StockfishResult } from '../engines/stockfish.js';
import { runLc0, type Lc0Result } from '../engines/lc0.js';
import { locateEngines } from '../engines/locate.js';
import {
  LC0_NETWORK_ID,
  LC0_VERSION,
  STOCKFISH_NNUE,
  STOCKFISH_VERSION,
  lc0SettingsForTier,
  stockfishSettingsForTier,
  type Lc0Settings,
  type StockfishSettings,
  type Tier,
} from '../engines/config.js';
import { computeFingerprintForTier } from '../fingerprint.js';
import type { MultiPvLine } from '../engines/multipv.js';

// Fog Index's tablebase-distance component only means something inside
// actual Syzygy coverage; a tb_probes cache hit outside that range would be
// a bug elsewhere, but this gate is defensive either way.
const SYZYGY_MAX_PIECES = 7;
// v1 scope for hasChildProof (see docs/ROADMAP.md Stage 3): only direct
// children of positions this shallow are checked, keeping child-position
// enumeration cheap and bounding it to the tablebase boundary the formula
// actually cares about.
const CHILD_PROOF_MAX_PIECES = 8;
// A move is "critical" (counted into moveMultiPV) if its White-perspective
// win probability is within this of the best move's -- see
// docs/FOG_INDEX_METHODOLOGY.md.
const CRITICAL_MOVE_WP_THRESHOLD = 0.06;

export interface AnalyzePositionInput {
  fen: string;
  tier: Tier;
}

export interface AnalyzePositionOutput {
  positionId: number;
  epd: string;
  fogScore: FogScore;
  percentile: number | null;
  engineFingerprint: string;
}

export async function analyzePosition(db: Database, input: AnalyzePositionInput): Promise<AnalyzePositionOutput> {
  const { fen, tier } = input;
  const epd = normalizeEPD(fen);
  const pieceCount = getPieceCount(fen);
  const zobrist = zobristToHexString(computeZobristHash(fen));

  const positionId = await upsertPosition(db, epd, zobrist, pieceCount);

  const engines = locateEngines();
  const stockfish = await runStockfishLadder(engines.stockfishExePath, fen, tier);
  const lc0 = await runLc0(engines.lc0ExePath, engines.lc0WeightsFile, fen, tier);

  const stockfishSettings = stockfishSettingsForTier(tier);
  const lc0Settings = lc0SettingsForTier(tier);
  const engineFingerprint = computeFingerprintForTier(tier);

  await insertEvalRows(db, positionId, engineFingerprint, stockfish, lc0, stockfishSettings, lc0Settings);

  const [hasProof, hasChildProof] = await Promise.all([
    isPositionIdProven(db, positionId, pieceCount),
    hasProvenDirectChild(db, fen, pieceCount),
  ]);

  const engineEvals: EngineEvals = {
    stockfishWdl: stockfish.rungs.map((rung) => ({ nodes: rung.nodes, ...requireRank1(rung.multiPV).wdl })),
    lc0Wdl: [{ nodes: lc0.nodes, ...requireRank1(lc0.multiPV).wdl }],
  };

  const deepestRung = stockfish.rungs[stockfish.rungs.length - 1];
  const moveMultiPV = countCriticalMoves(deepestRung.multiPV);

  const fogScore = computeFogIndex(engineEvals, { pieceCount, hasProof, hasChildProof, moveMultiPV });
  fogScore.engineFingerprint = engineFingerprint;

  const percentileRaw = getCalibration(fogScore.formulaVersion).getPercentile(fogScore.score);
  const percentile = percentileRaw === null ? null : Math.round(percentileRaw);

  await db
    .insert(schema.fogScores)
    .values({
      positionId,
      formulaVersion: fogScore.formulaVersion,
      engineFingerprint,
      score: fogScore.score,
      components: fogScore.components,
      percentile,
    })
    .onConflictDoNothing({
      target: [schema.fogScores.positionId, schema.fogScores.formulaVersion, schema.fogScores.engineFingerprint],
    });

  return { positionId, epd, fogScore, percentile, engineFingerprint };
}

async function upsertPosition(db: Database, epd: string, zobrist: string, pieceCount: number): Promise<number> {
  await db.insert(schema.positions).values({ epd, zobrist, pieceCount }).onConflictDoNothing({
    target: schema.positions.epd,
  });

  const [position] = await db
    .select({ id: schema.positions.id })
    .from(schema.positions)
    .where(eq(schema.positions.epd, epd))
    .limit(1);

  if (!position) {
    throw new Error(`failed to upsert position for epd "${epd}"`);
  }
  return position.id;
}

async function insertEvalRows(
  db: Database,
  positionId: number,
  engineFingerprint: string,
  stockfish: StockfishResult,
  lc0: Lc0Result,
  stockfishSettings: StockfishSettings,
  lc0Settings: Lc0Settings
): Promise<void> {
  type EvalInsert = typeof schema.evals.$inferInsert;
  const rows: EvalInsert[] = [];

  for (const rung of stockfish.rungs) {
    for (const line of rung.multiPV) {
      rows.push({
        positionId,
        engine: 'stockfish',
        engineVersion: STOCKFISH_VERSION,
        netId: STOCKFISH_NNUE,
        nodes: rung.nodes,
        depth: line.depth ?? null,
        multiPVRank: line.rank,
        scoreCp: line.scoreCp ?? null,
        scoreMate: line.scoreMate ?? null,
        wdlW: line.wdl.wins,
        wdlD: line.wdl.draws,
        wdlL: line.wdl.losses,
        settings: stockfishSettings,
        engineFingerprint,
      });
    }
  }

  for (const line of lc0.multiPV) {
    rows.push({
      positionId,
      engine: 'lc0',
      engineVersion: LC0_VERSION,
      netId: LC0_NETWORK_ID,
      nodes: lc0.nodes,
      depth: line.depth ?? null,
      multiPVRank: line.rank,
      scoreCp: line.scoreCp ?? null,
      scoreMate: line.scoreMate ?? null,
      wdlW: line.wdl.wins,
      wdlD: line.wdl.draws,
      wdlL: line.wdl.losses,
      settings: lc0Settings,
      engineFingerprint,
    });
  }

  if (rows.length > 0) {
    await db.insert(schema.evals).values(rows);
  }
}

function requireRank1(multiPV: MultiPvLine[]): MultiPvLine {
  const rank1 = multiPV.find((line) => line.rank === 1);
  if (!rank1) throw new Error('expected multipv rank 1 in engine output');
  return rank1;
}

function countCriticalMoves(multiPV: MultiPvLine[]): number {
  const best = requireRank1(multiPV);
  const bestWp = winProbability(best.wdl.wins, best.wdl.draws, best.wdl.losses);
  return multiPV.filter((line) => {
    const wp = winProbability(line.wdl.wins, line.wdl.draws, line.wdl.losses);
    return Math.abs(bestWp - wp) <= CRITICAL_MOVE_WP_THRESHOLD;
  }).length;
}

async function isPositionIdProven(db: Database, positionId: number, pieceCount: number): Promise<boolean> {
  const [proof] = await db
    .select({ id: schema.proofs.id })
    .from(schema.proofs)
    .where(eq(schema.proofs.positionId, positionId))
    .limit(1);
  if (proof) return true;

  if (pieceCount > SYZYGY_MAX_PIECES) return false;

  const [tbProbe] = await db
    .select({ id: schema.tbProbes.id })
    .from(schema.tbProbes)
    .where(eq(schema.tbProbes.positionId, positionId))
    .limit(1);
  return !!tbProbe;
}

async function isFenProven(db: Database, fen: string): Promise<boolean> {
  const epd = normalizeEPD(fen);
  const [position] = await db
    .select({ id: schema.positions.id })
    .from(schema.positions)
    .where(eq(schema.positions.epd, epd))
    .limit(1);
  if (!position) return false;

  return isPositionIdProven(db, position.id, getPieceCount(fen));
}

async function hasProvenDirectChild(db: Database, fen: string, pieceCount: number): Promise<boolean> {
  if (pieceCount > CHILD_PROOF_MAX_PIECES) return false;

  for (const childFen of enumerateChildFens(fen)) {
    if (await isFenProven(db, childFen)) return true;
  }
  return false;
}

const PROMOTION_ROLES: Role[] = ['queen', 'rook', 'bishop', 'knight'];

function isBackRank(square: number, color: 'white' | 'black'): boolean {
  const rank = square >> 3;
  return color === 'white' ? rank === 7 : rank === 0;
}

/** Enumerates every legal child position's FEN, expanding pawn promotions into all four choices. */
function enumerateChildFens(fen: string): string[] {
  const parsed = parseFen(fen);
  if (parsed.isErr) return [];
  const posResult = Chess.fromSetup(parsed.value);
  if (posResult.isErr) return [];
  const pos = posResult.value;

  const childFens: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    const piece = pos.board.get(from);
    for (const to of dests) {
      const promotions: (Role | undefined)[] =
        piece?.role === 'pawn' && isBackRank(to, pos.turn) ? PROMOTION_ROLES : [undefined];
      for (const promotion of promotions) {
        const child = pos.clone();
        const move: Move = { from, to, promotion };
        child.play(move);
        childFens.push(makeFen(child.toSetup()));
      }
    }
  }
  return childFens;
}
