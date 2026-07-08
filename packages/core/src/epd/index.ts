import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { makeSquare } from 'chessops/util';
import type { Setup } from 'chessops/setup';
import { hasLegalEnPassantCapture } from '../internal/ep-legality.js';

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

  const parsed = parseFen(fen);
  if (parsed.isErr) {
    throw new Error(`Invalid FEN: ${fen}`);
  }
  const setup = parsed.value;

  const piecePlacement = parts[0];
  const activeColor = parts[1] as 'w' | 'b';

  const castlingRights = normalizeCastling(parts[2]);

  const epTarget = normalizeEnPassant(setup);

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

function normalizeCastling(castling: string): string {
  if (castling === '-') return '-';
  return castling;
}

/**
 * Keeps the ep field only when it is the target of an actually legal en
 * passant capture, matching the Rust side's `EnPassantMode::Legal` hashing.
 * A double-pushed pawn with no legal capturing reply (e.g. the only
 * adjacent pawn is pinned) normalizes to `-`, since that position is
 * identical to one with no ep square at all for every downstream purpose
 * (hashing, repetition, engine evaluation).
 */
function normalizeEnPassant(setup: Setup): string {
  if (setup.epSquare === undefined) return '-';

  const posResult = Chess.fromSetup(setup);
  if (posResult.isErr || !hasLegalEnPassantCapture(posResult.value)) {
    return '-';
  }

  return makeSquare(setup.epSquare);
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
  return piecePlacement.replace(/[\d/]/g, '').length;
}
