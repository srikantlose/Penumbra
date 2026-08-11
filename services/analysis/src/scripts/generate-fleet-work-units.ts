// Generates Fleet work units (docs/FLEET_DESIGN.md) from real imported
// games: a game whose analyses.proof_entry_ply stayed null all the way
// through a real checkmate above the tablebase-covered range never had its
// mating sequence machine-certified as forced (see FLEET_DESIGN.md §3.1 for
// the full reasoning, and for what this deliberately does NOT do).
//
// The candidate FEN is a fixed lookback from the actual mate, not the mate
// position itself (trivially "proven" by the game already having reached
// it) and not any attempt to locate the "true" critical branching point --
// finding that precisely is undecidable without already doing the search
// this is meant to generate work for. This is a documented, bounded
// simplification: some candidates will be trivially easy, some may exceed
// any reasonable search budget and simply never get proven. Unlike the
// hand-curated fortress seeds (rust/prover/examples/fortress/), nothing
// here pre-filters for actual provability.
//
// Usage: node dist/scripts/generate-fleet-work-units.js [--lookback-plies N] [--limit N]

import { and, desc, eq, isNull } from 'drizzle-orm';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { getDatabase, schema, SYZYGY_MAX_PIECES } from '@penumbra/db';

const DEFAULT_LOOKBACK_PLIES = 10;
const DEFAULT_LIMIT = 500;

function databaseUrl(): string {
  return process.env.DATABASE_URL || 'postgresql://penumbra:penumbra@localhost:5432/penumbra';
}

// Matches services/analysis/src/pipeline/analyzeGame.ts's own epdToFen --
// halfmove/fullmove counters don't affect whether a forced win exists, so
// the same "0 1" placeholder is fine for a search input.
function epdToFen(epd: string): string {
  return `${epd} 0 1`;
}

interface Args {
  lookbackPlies: number;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { lookbackPlies: DEFAULT_LOOKBACK_PLIES, limit: DEFAULT_LIMIT };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--lookback-plies':
        args.lookbackPlies = Number(argv[++i]);
        break;
      case '--limit':
        args.limit = Number(argv[++i]);
        break;
      default:
        throw new Error(`unrecognized argument: "${argv[i]}"`);
    }
  }
  return args;
}

/** Real checkmate, not stalemate and not just "the game ended here" (resignation/timeout/draw agreement never reach an actual mated position on the board). */
function isRealCheckmate(fen: string): boolean {
  const parsed = parseFen(fen);
  if (parsed.isErr) return false;
  const posResult = Chess.fromSetup(parsed.value);
  if (posResult.isErr) return false;
  return posResult.value.isCheckmate();
}

/** The side to move at a checkmate position is the one who got mated -- the claim side (the winner) is the other color. */
function winnerOf(fen: string): 'white' | 'black' | null {
  const parsed = parseFen(fen);
  if (parsed.isErr) return null;
  return parsed.value.turn === 'white' ? 'black' : 'white';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = await getDatabase(databaseUrl());

  console.log(`scanning for candidate games (lookback=${args.lookbackPlies} plies, limit=${args.limit})...`);

  const candidateRows = await db
    .select({ gameId: schema.analyses.gameId })
    .from(schema.analyses)
    .where(and(eq(schema.analyses.status, 'done'), isNull(schema.analyses.proofEntryPly)))
    .limit(args.limit);
  // A game can have more than one 'done' analysis (re-analyzed, or run at
  // both tiers); dedupe so each game is only considered once per run.
  const gameIds = [...new Set(candidateRows.map((r) => r.gameId))];

  let inserted = 0;
  let skipped = 0;

  for (const gameId of gameIds) {
    const [finalPosition] = await db
      .select({ ply: schema.gamePositions.ply, epd: schema.positions.epd, pieceCount: schema.positions.pieceCount })
      .from(schema.gamePositions)
      .innerJoin(schema.positions, eq(schema.positions.id, schema.gamePositions.positionId))
      .where(eq(schema.gamePositions.gameId, gameId))
      .orderBy(desc(schema.gamePositions.ply))
      .limit(1);

    if (!finalPosition || finalPosition.pieceCount <= SYZYGY_MAX_PIECES) {
      skipped++;
      continue;
    }

    const finalFen = epdToFen(finalPosition.epd);
    if (!isRealCheckmate(finalFen)) {
      skipped++;
      continue;
    }

    const claimSide = winnerOf(finalFen);
    if (!claimSide) {
      skipped++;
      continue;
    }

    const candidatePly = Math.max(0, finalPosition.ply - args.lookbackPlies);
    const [candidatePosition] = await db
      .select({ epd: schema.positions.epd })
      .from(schema.gamePositions)
      .innerJoin(schema.positions, eq(schema.positions.id, schema.gamePositions.positionId))
      .where(and(eq(schema.gamePositions.gameId, gameId), eq(schema.gamePositions.ply, candidatePly)))
      .limit(1);

    if (!candidatePosition) {
      skipped++;
      continue;
    }

    const [row] = await db
      .insert(schema.workUnits)
      .values({
        fen: epdToFen(candidatePosition.epd),
        claimValue: 'win',
        claimSide,
        notes: `pipeline-generated: game ${gameId}, mate at ply ${finalPosition.ply}, candidate ${args.lookbackPlies} plies earlier -- no provability pre-filter, see docs/FLEET_DESIGN.md §3.1`,
        sourceGameId: gameId,
        status: 'open',
      })
      .onConflictDoNothing({ target: [schema.workUnits.fen, schema.workUnits.claimValue, schema.workUnits.claimSide] })
      .returning({ id: schema.workUnits.id });

    if (row) {
      inserted++;
      console.log(`  game ${gameId}: work unit ${row.id} (mate at ply ${finalPosition.ply}, candidate ply ${candidatePly})`);
    } else {
      skipped++;
    }
  }

  console.log(
    `\ndone. ${inserted} work unit(s) inserted, ${skipped} game(s) skipped ` +
      `(not a real checkmate, <=${SYZYGY_MAX_PIECES} pieces, or already present).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('generate-fleet-work-units failed:', err);
  process.exit(1);
});
