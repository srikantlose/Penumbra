import { FogScore, TruthStatus } from '@penumbra/core';

export const FOG_FORMULA_VERSION = '0.1';

export interface EngineEvals {
  stockfishWdl: {
    nodes: number;
    wins: number;
    draws: number;
    losses: number;
  }[];
  lc0Wdl: {
    nodes: number;
    wins: number;
    draws: number;
    losses: number;
  }[];
}

export interface FogComponents {
  disagreement: number;
  depthVolatility: number;
  moveCriticality: number;
  tablebaseDistance: number;
  proofGate: number;
}

export interface FogComputeOptions {
  pieceCount: number;
  hasProof?: boolean;
  hasChildProof?: boolean;
  moveMultiPV?: number;
}

function winProbability(wins: number, draws: number, losses: number): number {
  const total = wins + draws + losses;
  if (total === 0) return 0.5;
  return (wins + 0.5 * draws) / total;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeDisagreement(sfWp: number, lc0Wp: number): number {
  const diff = Math.abs(sfWp - lc0Wp);
  return clamp(diff / 0.35, 0, 1);
}

function computeDepthVolatility(sfWpLadder: number[]): number {
  if (sfWpLadder.length < 2) return 0;

  const mean = sfWpLadder.reduce((a, b) => a + b, 0) / sfWpLadder.length;
  const variance =
    sfWpLadder.reduce((sum, wp) => sum + Math.pow(wp - mean, 2), 0) /
    sfWpLadder.length;
  const stdDev = Math.sqrt(variance);

  return clamp(stdDev / 0.12, 0, 1);
}

function computeMoveCriticality(multiPVMoves: number): number {
  const k = Math.max(1, Math.min(multiPVMoves, 4));
  return clamp((k - 1) / 3, 0, 1);
}

function computeTablebaseDistance(pieceCount: number): number {
  const n = pieceCount;
  return clamp((n - 7) / 9, 0, 1);
}

function computeProofGate(
  hasProof: boolean,
  hasChildProof: boolean
): number {
  if (hasProof) return 0;
  if (hasChildProof) return 0.85;
  return 1;
}

export function computeFogComponents(
  evals: EngineEvals,
  options: FogComputeOptions
): FogComponents {
  const sfDeepWdl = evals.stockfishWdl[evals.stockfishWdl.length - 1];
  const sfWp = winProbability(
    sfDeepWdl.wins,
    sfDeepWdl.draws,
    sfDeepWdl.losses
  );

  const lc0Wdl = evals.lc0Wdl[evals.lc0Wdl.length - 1];
  const lc0Wp = winProbability(lc0Wdl.wins, lc0Wdl.draws, lc0Wdl.losses);

  const sfWpLadder = evals.stockfishWdl.map((wdl) =>
    winProbability(wdl.wins, wdl.draws, wdl.losses)
  );

  const disagreement = computeDisagreement(sfWp, lc0Wp);
  const depthVolatility = computeDepthVolatility(sfWpLadder);
  const moveCriticality = computeMoveCriticality(options.moveMultiPV ?? 4);
  const tablebaseDistance = computeTablebaseDistance(options.pieceCount);
  const proofGate = computeProofGate(
    options.hasProof ?? false,
    options.hasChildProof ?? false
  );

  return {
    disagreement,
    depthVolatility,
    moveCriticality,
    tablebaseDistance,
    proofGate,
  };
}

export function computeFogScore(components: FogComponents): number {
  const weighted =
    0.3 * components.disagreement +
    0.25 * components.depthVolatility +
    0.25 * components.moveCriticality +
    0.2 * components.tablebaseDistance;

  const final = components.proofGate * weighted;
  return Math.round(100 * final);
}

export function computeFogIndex(
  evals: EngineEvals,
  options: FogComputeOptions
): FogScore {
  const components = computeFogComponents(evals, options);
  const score = computeFogScore(components);

  const status: TruthStatus = options.hasProof
    ? TruthStatus.PROVEN
    : TruthStatus.EVALUATED;

  return {
    score,
    status,
    components: {
      disagreement: Math.round(components.disagreement * 100) / 100,
      depthVolatility: Math.round(components.depthVolatility * 100) / 100,
      moveCriticality: Math.round(components.moveCriticality * 100) / 100,
      tablebaseDistance: Math.round(components.tablebaseDistance * 100) / 100,
      proofGate: Math.round(components.proofGate * 100) / 100,
    },
    formulaVersion: FOG_FORMULA_VERSION,
    engineFingerprint: '', // Set by caller based on engine versions
    computedAt: new Date(),
  };
}
