export interface CertificateClaim {
  fen: string;
  zobrist: string;
  value: 'win' | 'at_least_draw';
  side: 'white' | 'black';
}

export interface CertificateMove {
  uci: string;
  child_id: string;
}

export interface CertificateTerminal {
  type: 'checkmate' | 'stalemate' | 'tablebase' | 'transposition';
  value?: 'win' | 'draw' | 'loss';
  dtm?: number;
}

export interface CertificateNode {
  id: string;
  zobrist: string;
  to_move: 'white' | 'black';
  kind: 'or-node' | 'and-node' | 'terminal';
  moves?: CertificateMove[];
  terminal?: CertificateTerminal;
}

export interface CertificateDependencies {
  tablebase?: 'syzygy';
}

export interface CertificateMetadata {
  producer: string;
  timestamp: string;
  contributors?: string[];
  work_units?: string[];
}

export interface Certificate {
  format_version: '0.1';
  claim: CertificateClaim;
  rules: 'standard';
  root_id: string;
  nodes: CertificateNode[];
  dependencies: CertificateDependencies;
  metadata: CertificateMetadata;
}

export interface CertificateWithSignature extends Certificate {
  signature?: string;
  certificate_sha256?: string;
}
