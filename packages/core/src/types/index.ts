export enum TruthStatus {
  EVALUATED = 'EVALUATED',
  PROVEN = 'PROVEN'
}

export interface Position {
  fen: string;
  epd: string;
  zobrist: bigint;
  pieceCount: number;
}

export interface EngineEval {
  engine: string;
  version: string;
  nodes: number;
  depth?: number;
  scoreCp?: number;
  scoreMate?: number;
  wdl: {
    wins: number;
    draws: number;
    losses: number;
  };
  timestamp: Date;
}

export interface FogScore {
  score: number;
  status: TruthStatus;
  components: {
    disagreement: number;
    depthVolatility: number;
    moveCriticality: number;
    tablebaseDistance: number;
    proofGate: number;
  };
  formulaVersion: string;
  engineFingerprint: string;
  percentile?: number;
  computedAt: Date;
}
