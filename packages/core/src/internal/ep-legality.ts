import { Chess } from 'chessops/chess';

/**
 * Whether the position's en passant square is the target of an actually
 * legal en passant capture (a friendly pawn attacks it and playing the
 * capture doesn't leave the mover in check). This is stricter than "an
 * opponent pawn just double-pushed" -- a pinned capturing pawn, for
 * example, has no legal en passant capture even though `epSquare` is set.
 *
 * Matches shakmaty's `Position::ep_square(EnPassantMode::Legal)`, which is
 * the mode the Rust prover/verifier hash positions with. Zobrist hashing
 * and EPD normalization both need this exact gate to stay cross-implementation
 * consistent with the Rust side.
 */
export function hasLegalEnPassantCapture(pos: Chess): boolean {
  if (pos.epSquare === undefined) return false;
  const ep = pos.epSquare;

  for (const [from, dests] of pos.allDests()) {
    const piece = pos.board.get(from);
    if (piece && piece.role === 'pawn' && piece.color === pos.turn && dests.has(ep)) {
      return true;
    }
  }
  return false;
}
