import { parseFen } from 'chessops/fen';
import { parseSquare } from 'chessops/util';

const CASTLING_SQUARES = {
  whiteKing: parseSquare('h1')!,
  whiteQueen: parseSquare('a1')!,
  blackKing: parseSquare('h8')!,
  blackQueen: parseSquare('a8')!
};

const ZOBRIST_PIECE_SQUARE = initPieceSquareTable();
const ZOBRIST_CASTLING = initCastlingTable();
const ZOBRIST_EN_PASSANT = initEnPassantTable();
const ZOBRIST_SIDE = 0x823c73137e1786efn;

function initPieceSquareTable(): bigint[][] {
  const table: bigint[][] = [];
  for (let i = 0; i < 12; i++) {
    table[i] = [];
    for (let j = 0; j < 64; j++) {
      table[i][j] = pseudoRandomBigInt(i * 64 + j);
    }
  }
  return table;
}

function initCastlingTable(): bigint[] {
  const table: bigint[] = [];
  for (let i = 0; i < 16; i++) {
    table[i] = pseudoRandomBigInt(768 + i);
  }
  return table;
}

function initEnPassantTable(): bigint[] {
  const table: bigint[] = [];
  for (let i = 0; i < 8; i++) {
    table[i] = pseudoRandomBigInt(784 + i);
  }
  return table;
}

function pseudoRandomBigInt(index: number): bigint {
  let seed = BigInt(index) * 6364136223846793005n + 1442695040888963407n;
  const high = seed >> 32n;
  const low = seed & 0xffffffffn;
  return (high << 32n) | low;
}

export function computeZobristHash(fen: string): bigint {
  const board = parseFen(fen);
  if (board.isErr) {
    throw new Error(`Invalid FEN: ${fen}`);
  }

  const setup = board.value;
  let hash = 0n;

  for (let sq = 0; sq < 64; sq++) {
    const piece = setup.board.get(sq);
    if (piece) {
      const pieceIndex = getPieceIndex(piece);
      hash ^= ZOBRIST_PIECE_SQUARE[pieceIndex][sq];
    }
  }

  const castlingIndex = computeCastlingIndex(setup.castlingRights);
  hash ^= ZOBRIST_CASTLING[castlingIndex];

  if (setup.epSquare !== undefined && setup.epSquare >= 0) {
    const file = setup.epSquare % 8;
    hash ^= ZOBRIST_EN_PASSANT[file];
  }

  if (setup.turn === 'black') {
    hash ^= ZOBRIST_SIDE;
  }

  return hash;
}

function getPieceIndex(piece: { role: string; color: string }): number {
  const roleMap: Record<string, number> = {
    pawn: 0,
    knight: 1,
    bishop: 2,
    rook: 3,
    queen: 4,
    king: 5
  };

  const baseIndex = roleMap[piece.role] ?? 0;
  const colorOffset = piece.color === 'white' ? 0 : 6;
  return baseIndex + colorOffset;
}

function computeCastlingIndex(castlingRights: { has(square: number): boolean }): number {
  let index = 0;
  if (castlingRights.has(CASTLING_SQUARES.whiteKing)) index |= 1;
  if (castlingRights.has(CASTLING_SQUARES.whiteQueen)) index |= 2;
  if (castlingRights.has(CASTLING_SQUARES.blackKing)) index |= 4;
  if (castlingRights.has(CASTLING_SQUARES.blackQueen)) index |= 8;
  return index;
}

export function zobristToHexString(hash: bigint): string {
  return '0x' + hash.toString(16).padStart(16, '0');
}

export function zobristFromHexString(hex: string): bigint {
  return BigInt(hex);
}
