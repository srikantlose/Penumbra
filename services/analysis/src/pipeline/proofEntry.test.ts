import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeEPD } from '@penumbra/core';
import { extractPositions } from '../import/pgn.js';
import { detectMissedProofs, detectProofEntryPly, type AnalyzedPosition, type ChildMove } from './proofEntry.js';

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`../../test-fixtures/${name}`, import.meta.url));
  return readFileSync(path, 'utf8');
}

function toAnalyzedPositions(pgn: string): AnalyzedPosition[] {
  return extractPositions(pgn)
    .filter((p) => p.ply > 0)
    .map((p) => ({
      ply: p.ply,
      positionId: p.ply, // synthetic -- these tests never touch a real DB
      epd: p.epd,
      pieceCount: p.pieceCount,
      san: p.san as string,
      uci: p.uci as string,
    }));
}

describe('detectProofEntryPly', () => {
  const positions = toAnalyzedPositions(loadFixture('endgame-proof-entry.pgn'));

  it('skips positions above the piece-count threshold and returns the first ply that crosses it', async () => {
    // Fixture (verified against chessops directly): ply 1-2 sit at 6 men,
    // ply 3 (Rxe1) drops to 5. Mocking "TB probe found" as pieceCount <= 5
    // (standing in for a real tb_probes cache hit) should land on ply 3,
    // proving the walk skips non-matching earlier plies rather than always
    // returning the first entry.
    const isProven = async (_positionId: number, pieceCount: number) => pieceCount <= 5;
    expect(await detectProofEntryPly(positions, isProven)).toBe(3);
  });

  it('returns null when no position ever satisfies the predicate', async () => {
    const neverProven = async () => false;
    expect(await detectProofEntryPly(positions, neverProven)).toBeNull();
  });
});

describe('detectMissedProofs', () => {
  const positions = toAnalyzedPositions(loadFixture('endgame-proof-entry.pgn'));

  // Mimics analyzeGame.ts's findProvenWinningMoves shape: given the batch of
  // legal children for a ply, returns the subset of ucis matching one FEN
  // mocked as a proven win for `winningMover`.
  function mockFindProvenWinningMoves(winningFen: string, winningMover: 'white' | 'black') {
    return async (children: ChildMove[], mover: 'white' | 'black'): Promise<Set<string>> => {
      if (mover !== winningMover) return new Set();
      const match = children.find((child) => normalizeEPD(child.fen) === normalizeEPD(winningFen));
      return match ? new Set([match.uci]) : new Set();
    };
  }

  it('flags a ply where an untried alternative was a proven win but the played move was not', async () => {
    // At ply 1 ("Ke4", Black to move), the fixture actually played 1...Kb8.
    // 1...Kb7 is a distinct, verified-legal alternative from that same
    // position -- mocked here as "proven win for Black" to simulate a
    // missed proof (standing in for a real proofs-table hit).
    const provenWinFen = '8/1k5p/8/8/4K3/2B5/8/4n2R w - - 2 2'; // position after 1...Kb7

    expect(await detectMissedProofs(positions, mockFindProvenWinningMoves(provenWinFen, 'black'))).toEqual([
      { ply: 1, uci: 'a8b7' },
    ]);
  });

  it('returns no entries when nothing is ever mocked as a proven win', async () => {
    const neverWinning = async () => new Set<string>();
    expect(await detectMissedProofs(positions, neverWinning)).toEqual([]);
  });

  it('does not flag a ply when the move actually played was itself the proven win', async () => {
    const playedFen = '1k6/7p/8/8/4K3/2B5/8/4n2R w - - 2 2'; // position after the real 1...Kb8
    expect(await detectMissedProofs(positions, mockFindProvenWinningMoves(playedFen, 'black'))).toEqual([]);
  });

  it('checks every ply exactly once, regardless of piece count', async () => {
    // v1 gated this on a parent-side piece-count cutoff; that's gone now
    // (a proof can apply at any material count), so every ply with a legal
    // reply gets exactly one batched lookup call -- not zero, not one per
    // candidate move.
    let calls = 0;
    await detectMissedProofs(positions, async () => {
      calls++;
      return new Set<string>();
    });
    expect(calls).toBe(positions.length - 1);
  });
});
