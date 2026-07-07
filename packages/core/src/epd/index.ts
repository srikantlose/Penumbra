import { parseFen, makeFen } from 'chessops';

export interface EPDParts {
  piecePlacement: string;
  activeColor: 'w' | 'b';
  castlingRights: string;
  enPassantTarget: string | '-';
}

export function normalizeEPD(fen: string): string {
  const parts = fen.split(/\s+/);
  if (parts.length < 4) {
    throw new Error(`Invalid FEN: ${fen}`);
  }

  const board = parseFen(fen);
  if (board.isErr()) {
    throw new Error(`Invalid FEN: ${fen}`);
  }

  const setup = board.value;

  const piecePlacement = parts[0];
  const activeColor = parts[1] as 'w' | 'b';

  const castlingRights = normalizeCastling(parts[2], setup.turn);

  const epTarget = normalizeEnPassant(parts[3], setup.turn);

  return `${piecePlacement} ${activeColor} ${castlingRights} ${epTarget}`;
}

export function parseFenToEPD(fen: string): EPDParts {
  const normalized = normalizeEPD(fen);
  const parts = normalized.split(/\s+/);
  return {
    piecePlacement: parts[0],
    activeColor: parts[1] as 'w' | 'b',
    castlingRights: parts[2],
    enPassantTarget: parts[3]
  };
}

function normalizeCastling(castling: string, turn: 'white' | 'black'): string {
  if (castling === '-') return '-';
  return castling;
}

function normalizeEnPassant(ep: string, turn: 'white' | 'black'): string {
  if (ep === '-') return '-';

  const file = ep.charCodeAt(0) - 97;
  const rank = parseInt(ep[1], 10);

  if (file < 0 || file > 7 || rank < 1 || rank > 8) {
    return '-';
  }

  return ep.toLowerCase();
}

export function fenToEPD(fen: string): string {
  const parts = fen.split(/\s+/);
  if (parts.length < 4) {
    throw new Error(`Invalid FEN: ${fen}`);
  }

  return parts.slice(0, 4).join(' ');
}

export function getPieceCount(fen: string): number {
  const piecePlacement = fen.split(/\s+/)[0];
  return piecePlacement.replace(/\d/g, '').length;
}
