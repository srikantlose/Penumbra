import { parseFen, makeFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { makeUci } from 'chessops/util';
import type { Move, Role } from 'chessops/types';

export interface AnalyzedPosition {
  ply: number;
  positionId: number;
  epd: string;
  pieceCount: number;
  san: string;
  uci: string;
}

export interface MissedProofEntry {
  ply: number;
  uci: string;
}

/**
 * First ply whose position is PROVEN, per the injected predicate (backed by
 * packages/db/src/truth.ts's isPositionProven in production). Kept
 * DB-free/injectable here so it's directly unit-testable without mocking a
 * database -- see proofEntry.test.ts's synthetic endgame fixture.
 */
export async function detectProofEntryPly(
  positions: AnalyzedPosition[],
  isProven: (positionId: number, pieceCount: number) => Promise<boolean>
): Promise<number | null> {
  for (const position of positions) {
    if (await isProven(position.positionId, position.pieceCount)) return position.ply;
  }
  return null;
}

function moverColorFromEpd(epd: string): 'white' | 'black' {
  return epd.split(' ')[1] === 'w' ? 'white' : 'black';
}

// EPD omits the two FEN move counters; appending neutral defaults produces
// a fully valid, analyzable FEN -- move generation only needs the current
// legal position, not real historical counters.
function epdToFen(epd: string): string {
  return `${epd} 0 1`;
}

const PROMOTION_ROLES: Role[] = ['queen', 'rook', 'bishop', 'knight'];

function isBackRank(square: number, color: 'white' | 'black'): boolean {
  const rank = square >> 3;
  return color === 'white' ? rank === 7 : rank === 0;
}

export interface ChildMove {
  uci: string;
  fen: string;
}

/** Enumerates every legal (move, resulting fen) pair, expanding pawn promotions into all four choices. */
function enumerateChildMoves(fen: string): ChildMove[] {
  const parsed = parseFen(fen);
  if (parsed.isErr) return [];
  const posResult = Chess.fromSetup(parsed.value);
  if (posResult.isErr) return [];
  const pos = posResult.value;

  const children: ChildMove[] = [];
  for (const [from, dests] of pos.allDests()) {
    const piece = pos.board.get(from);
    for (const to of dests) {
      const promotions: (Role | undefined)[] =
        piece?.role === 'pawn' && isBackRank(to, pos.turn) ? PROMOTION_ROLES : [undefined];
      for (const promotion of promotions) {
        const move: Move = { from, to, promotion };
        const child = pos.clone();
        child.play(move);
        children.push({ uci: makeUci(move), fen: makeFen(child.toSetup()) });
      }
    }
  }
  return children;
}

/**
 * For each ply, checks whether some legal move leads to a child already
 * proven as a win for the side to move, while the move actually played does
 * not. `ply` anchors to the position where the choice existed (before the
 * move); `uci` is one such missed winning move -- not necessarily the only
 * one, and not the move that was actually played.
 *
 * Unlike proof-entry detection, this isn't bounded to a tablebase-adjacent
 * piece count: a `proofs` row can apply to a position at any material count
 * (e.g. a transposition into an already-proven fortress), so a parent-side
 * piece-count cutoff would silently miss those. The predicate is called once
 * per ply with every legal child in one batch rather than once per child, so
 * the caller can look all of them up in a single query instead of one round
 * trip per candidate move -- see analyzeGame.ts's findProvenWinningMoves.
 */
export async function detectMissedProofs(
  positions: AnalyzedPosition[],
  findProvenWinningMoves: (children: ChildMove[], mover: 'white' | 'black') => Promise<Set<string>>
): Promise<MissedProofEntry[]> {
  const missed: MissedProofEntry[] = [];

  for (let i = 0; i < positions.length - 1; i++) {
    const position = positions[i];
    const mover = moverColorFromEpd(position.epd);
    const fen = epdToFen(position.epd);
    const playedUci = positions[i + 1].uci;

    const children = enumerateChildMoves(fen);
    if (children.length === 0) continue;

    const winningUcis = await findProvenWinningMoves(children, mover);
    if (winningUcis.size === 0 || winningUcis.has(playedUci)) continue;

    const winningAlternative = children.find((child) => winningUcis.has(child.uci));
    if (winningAlternative) missed.push({ ply: position.ply, uci: winningAlternative.uci });
  }

  return missed;
}
