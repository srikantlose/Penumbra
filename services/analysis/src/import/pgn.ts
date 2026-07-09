import { parsePgn, startingPosition, makePgn, type Game, type PgnNodeData } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeFen } from 'chessops/fen';
import { makeUci } from 'chessops/util';
import type { Position } from 'chessops/chess';
import { normalizeEPD, getPieceCount, computeZobristHash, zobristToHexString } from '@penumbra/core';

export interface ExtractedPosition {
  ply: number;
  fen: string;
  epd: string;
  zobristHex: string;
  pieceCount: number;
  uci: string | null;
  san: string | null;
}

export interface ParsedGame {
  headers: Map<string, string>;
  positions: ExtractedPosition[];
  pgn: string;
}

function makeEntry(pos: Position, ply: number, uci: string | null, san: string | null): ExtractedPosition {
  const fen = makeFen(pos.toSetup());
  return {
    ply,
    fen,
    epd: normalizeEPD(fen),
    pieceCount: getPieceCount(fen),
    zobristHex: zobristToHexString(computeZobristHash(fen)),
    uci,
    san,
  };
}

function extractPositionsFromGame(game: Game<PgnNodeData>): ExtractedPosition[] {
  const posResult = startingPosition(game.headers);
  if (posResult.isErr) return [];
  const pos = posResult.value;

  const positions: ExtractedPosition[] = [makeEntry(pos, 0, null, null)];

  let ply = 0;
  for (const node of game.moves.mainline()) {
    const move = parseSan(pos, node.san);
    if (!move) break; // illegal SAN (variant leak or bad annotation) -- stop, keep what we have
    const uci = makeUci(move);
    pos.play(move);
    ply += 1;
    positions.push(makeEntry(pos, ply, uci, node.san));
  }

  return positions;
}

/**
 * Extracts every position in a single game's PGN mainline, keyed the same
 * way positions are keyed everywhere else in the pipeline (EPD + Polyglot
 * zobrist). If the PGN text contains multiple games, only the first is used
 * -- see extractGames() for multi-game files.
 *
 * Convention (reused by every caller that enumerates positions from a
 * game): ply 0 is the position before White's first move (uci/san null);
 * entry N holds the position after ply N and the move that produced it.
 */
export function extractPositions(pgn: string): ExtractedPosition[] {
  const games = parsePgn(pgn);
  if (games.length === 0) return [];
  return extractPositionsFromGame(games[0]);
}

/**
 * Extracts every game in a (possibly multi-game) PGN file -- used by the
 * manual `--pgn <file>` import path. Each game's `pgn` field is chessops's
 * own re-serialization (`makePgn`), not a raw slice of the input text, so
 * storage always gets a normalized single-game PGN blob.
 */
export function extractGames(pgn: string): ParsedGame[] {
  return parsePgn(pgn).map((game) => ({
    headers: game.headers,
    positions: extractPositionsFromGame(game),
    pgn: makePgn(game),
  }));
}
