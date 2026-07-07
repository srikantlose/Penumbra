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

export enum ClaimValue {
  WIN = 'win',
  DRAW = 'draw',
  LOSS = 'loss'
}

export interface Claim {
  fen: string;
  zobrist: bigint;
  value: ClaimValue;
  side: 'white' | 'black';
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

export interface Certificate {
  formatVersion: string;
  claim: Claim;
  rules: string;
  rootId: string;
  nodes: CertificateNode[];
  dependencies: {
    tablebase?: string;
  };
  metadata: {
    producer: string;
    timestamp: Date;
    contributors?: string[];
    workUnits?: string[];
  };
}

export interface CertificateNode {
  id: string;
  zobrist: bigint;
  toMove: 'white' | 'black';
  kind: 'or-node' | 'and-node' | 'terminal';
  moves?: {
    uci: string;
    childId: string;
  }[];
  terminal?: {
    type: 'checkmate' | 'stalemate' | 'tablebase' | 'transposition';
    value?: ClaimValue;
  };
}
