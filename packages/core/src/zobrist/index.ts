import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSquare } from 'chessops/util';
import { POLYGLOT_RANDOM } from './polyglot-random.js';
import { hasLegalEnPassantCapture } from '../internal/ep-legality.js';

const ROLE_INDEX: Record<string, number> = {
  pawn: 0,
  knight: 1,
  bishop: 2,
  rook: 3,
  queen: 4,
  king: 5
};

const CASTLING_SQUARES = {
  whiteKing: parseSquare('h1')!,
  whiteQueen: parseSquare('a1')!,
  blackKing: parseSquare('h8')!,
  blackQueen: parseSquare('a8')!
};

// Offsets into POLYGLOT_RANDOM -- see polyglot-random.ts for the full layout.
const CASTLING_OFFSET = 768; // white king-side, white queen-side, black king-side, black queen-side
const EP_FILE_OFFSET = 772;
const TURN_INDEX = 780;

/**
 * Polyglot-compatible Zobrist hash of a position, matching shakmaty's
 * `zobrist_hash::<Zobrist64>(EnPassantMode::Legal)` -- the call the Rust
 * prover and verifier use when they stamp a certificate's `zobrist` field.
 * Both implementations must agree bit-for-bit; see
 * `test-fixtures/zobrist-vectors.json` for the cross-checked vectors.
 */
export function computeZobristHash(fen: string): bigint {
  const parsed = parseFen(fen);
  if (parsed.isErr) {
    throw new Error(`Invalid FEN: ${fen}`);
  }
  const setup = parsed.value;

  const posResult = Chess.fromSetup(setup);
  if (posResult.isErr) {
    throw new Error(`Illegal position: ${fen}`);
  }
  const pos = posResult.value;

  let hash = 0n;

  for (let sq = 0; sq < 64; sq++) {
    const piece = setup.board.get(sq);
    if (piece) {
      const roleIdx = ROLE_INDEX[piece.role];
      const pieceIdx = roleIdx * 2 + (piece.color === 'white' ? 1 : 0);
      hash ^= POLYGLOT_RANDOM[64 * pieceIdx + sq];
    }
  }

  if (setup.castlingRights.has(CASTLING_SQUARES.whiteKing)) hash ^= POLYGLOT_RANDOM[CASTLING_OFFSET];
  if (setup.castlingRights.has(CASTLING_SQUARES.whiteQueen)) hash ^= POLYGLOT_RANDOM[CASTLING_OFFSET + 1];
  if (setup.castlingRights.has(CASTLING_SQUARES.blackKing)) hash ^= POLYGLOT_RANDOM[CASTLING_OFFSET + 2];
  if (setup.castlingRights.has(CASTLING_SQUARES.blackQueen)) hash ^= POLYGLOT_RANDOM[CASTLING_OFFSET + 3];

  // Only XOR the en passant file when a legal en passant capture actually
  // exists -- an ep square with no legal capturing pawn (e.g. pinned) must
  // hash identically to a position with no ep square at all.
  if (hasLegalEnPassantCapture(pos) && setup.epSquare !== undefined) {
    const file = setup.epSquare & 0x7;
    hash ^= POLYGLOT_RANDOM[EP_FILE_OFFSET + file];
  }

  if (setup.turn === 'white') {
    hash ^= POLYGLOT_RANDOM[TURN_INDEX];
  }

  return hash;
}

export function zobristToHexString(hash: bigint): string {
  return '0x' + hash.toString(16).padStart(16, '0');
}

export function zobristFromHexString(hex: string): bigint {
  return BigInt(hex);
}
