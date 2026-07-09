// Determinism check for the raw engine adapters -- no DB/queue involved.
// Runs Stockfish + Lc0 twice per fixed FEN at a given tier and asserts the
// two runs' canonicalized output is byte-identical. Quick tier is fast
// enough to run as part of routine acceptance testing; canonical tier
// (2x ~90s/position) is a manual, occasionally-run check -- see
// docs/ENGINES.md for the last recorded result.
//
// Usage: node dist/scripts/repro-test.js [--tier quick|canonical]

import { canonicalizeJSON } from '@penumbra/cert-schema';
import { runStockfishLadder } from '../engines/stockfish.js';
import { runLc0 } from '../engines/lc0.js';
import { locateEngines } from '../engines/locate.js';
import type { Tier } from '../engines/config.js';

const FIXED_FENS = [
  // Standard starting position.
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  // "Kiwipete" -- a dense, tactically sharp middlegame widely used as a
  // move-generation test position, chosen here for the same reason: it
  // exercises castling, en passant adjacency, and heavy piece activity.
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  // King and pawn endgame, near the tablebase boundary.
  '8/8/8/8/8/4k3/4P3/4K3 w - - 0 1',
];

function parseTier(argv: string[]): Tier {
  const idx = argv.indexOf('--tier');
  if (idx === -1) return 'quick';
  const value = argv[idx + 1];
  if (value !== 'quick' && value !== 'canonical') {
    throw new Error(`--tier must be "quick" or "canonical", got "${value}"`);
  }
  return value;
}

async function runOnce(fen: string, tier: Tier): Promise<string> {
  const engines = locateEngines();
  const stockfish = await runStockfishLadder(engines.stockfishExePath, fen, tier);
  const lc0 = await runLc0(engines.lc0ExePath, engines.lc0WeightsFile, fen, tier);
  return canonicalizeJSON({ stockfish: stockfish.rungs, lc0: lc0.multiPV });
}

async function main() {
  const tier = parseTier(process.argv.slice(2));
  console.log(`repro-test: ${tier} tier, ${FIXED_FENS.length} fixed positions`);
  if (tier === 'canonical') {
    console.log('canonical tier: this runs the full ladder twice per position and will take a while.');
  }

  let allMatched = true;
  for (const fen of FIXED_FENS) {
    const first = await runOnce(fen, tier);
    const second = await runOnce(fen, tier);
    const matched = first === second;
    allMatched = allMatched && matched;
    console.log(`  ${fen}: ${matched ? 'match' : 'MISMATCH'}`);
    if (!matched) {
      console.error(`    run 1: ${first}`);
      console.error(`    run 2: ${second}`);
    }
  }

  if (!allMatched) {
    console.error('REPRO FAILED: engine output was not byte-identical across repeated runs');
    process.exit(1);
  }

  console.log('REPRO OK (byte-identical)');
  process.exit(0);
}

main().catch((err) => {
  console.error('repro-test failed:', err);
  process.exit(1);
});
