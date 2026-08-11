// Builds the position corpus for a Fog Index calibration run
// (docs/FOG_INDEX_METHODOLOGY.md's "Calibration and percentiles" section):
// streams real games from a curated set of elite Lichess accounts, extracts
// positions at plies 10-80 (the methodology's stated range -- early opening
// theory and late drawn-out endgames aren't representative middlegame/
// endgame fog samples), dedupes by EPD, and writes the result as one JSON
// object per line so the corpus is a frozen, inspectable, versionable file
// -- not something re-derived from a live query every time the calibration
// runner reads it.
//
// This approximates, but does not reproduce, the "Lichess elite database"
// named in docs/ROADMAP.md (a specific third-party curated PGN dump hosted
// outside Lichess itself, at database.nikonoel.fr) -- that dataset isn't
// something this repo fetches. Using real games from a hand-picked set of
// verifiably elite players via Lichess's own public export API instead is a
// deliberate substitution, not an oversight; see PROGRESS.md for the
// rationale. ELITE_USERNAMES below is intentionally a small, easy-to-extend
// starting set, not a definitive roster.
//
// Usage: node dist/scripts/build-calibration-corpus.js [--target N]
//   [--max-games-per-user N] [--min-ply N] [--max-ply N] [--out <path>]
//   [--usernames a,b,c]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { streamUserGames } from '../import/lichess.js';
import { extractPositions } from '../import/pgn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');

// Real, verifiably elite (super-GM, 2700+) Lichess accounts, chosen only for
// ones this doesn't need to guess at. Extend freely -- one username per
// line keeps future diffs to this list reviewable.
const ELITE_USERNAMES = ['DrNykterstein', 'penguingim1', 'LyonBeast', 'Zhigalko_Sergei'];

const DEFAULT_TARGET = 100_000;
const DEFAULT_MAX_GAMES_PER_USER = 3_000;
const DEFAULT_MIN_PLY = 10;
const DEFAULT_MAX_PLY = 80;
const DEFAULT_OUT = path.join(repoRoot, 'corpus', 'calibration', 'positions.jsonl');

interface Args {
  target: number;
  maxGamesPerUser: number;
  minPly: number;
  maxPly: number;
  out: string;
  usernames: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    target: DEFAULT_TARGET,
    maxGamesPerUser: DEFAULT_MAX_GAMES_PER_USER,
    minPly: DEFAULT_MIN_PLY,
    maxPly: DEFAULT_MAX_PLY,
    out: DEFAULT_OUT,
    usernames: ELITE_USERNAMES,
  };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') continue;
    switch (argv[i]) {
      case '--target':
        args.target = Number(argv[++i]);
        break;
      case '--max-games-per-user':
        args.maxGamesPerUser = Number(argv[++i]);
        break;
      case '--min-ply':
        args.minPly = Number(argv[++i]);
        break;
      case '--max-ply':
        args.maxPly = Number(argv[++i]);
        break;
      case '--out':
        args.out = path.resolve(argv[++i]);
        break;
      case '--usernames':
        args.usernames = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
        break;
      default:
        throw new Error(`unrecognized argument: "${argv[i]}"`);
    }
  }

  return args;
}

// A game that ends in checkmate (or, less commonly, stalemate) has its final
// position among the plies extracted from it. An engine has nothing to
// analyze there -- no legal moves means no fog of choice -- and Stockfish
// reports it as `bestmove (none)` with no WDL, which the analysis pipeline
// correctly treats as a failure. Filtered out at corpus-build time rather
// than in extractPositions() itself, since other callers of that function
// (e.g. full-game analysis) do want the final position.
function hasLegalMoves(fen: string): boolean {
  const parsed = parseFen(fen);
  if (parsed.isErr) return true;
  const posResult = Chess.fromSetup(parsed.value);
  if (posResult.isErr) return true;
  return posResult.value.hasDests();
}

interface CorpusEntry {
  fen: string;
  epd: string;
  ply: number;
  pieceCount: number;
  sourceGameId: string;
  sourceUsername: string;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `building calibration corpus: target=${args.target} plies=[${args.minPly},${args.maxPly}] ` +
      `usernames=${args.usernames.join(',')}`
  );

  const seenEpd = new Set<string>();
  const entries: CorpusEntry[] = [];
  let gamesScanned = 0;

  outer: for (const username of args.usernames) {
    console.log(`  streaming games for ${username} (max ${args.maxGamesPerUser})...`);
    let userGames = 0;
    try {
      for await (const game of streamUserGames(username, { max: args.maxGamesPerUser })) {
        userGames += 1;
        gamesScanned += 1;
        const positions = extractPositions(game.pgn);
        for (const pos of positions) {
          if (pos.ply < args.minPly || pos.ply > args.maxPly) continue;
          if (seenEpd.has(pos.epd)) continue;
          if (!hasLegalMoves(pos.fen)) continue;
          seenEpd.add(pos.epd);
          entries.push({
            fen: pos.fen,
            epd: pos.epd,
            ply: pos.ply,
            pieceCount: pos.pieceCount,
            sourceGameId: game.id,
            sourceUsername: username,
          });
          if (entries.length >= args.target) break outer;
        }
        if (userGames % 100 === 0) {
          console.log(`    ${username}: ${userGames} games scanned, ${entries.length} positions so far`);
        }
      }
      console.log(`  ${username}: done, ${userGames} games scanned`);
    } catch (err) {
      // A renamed/private/nonexistent account shouldn't abort the whole
      // corpus build -- skip it and keep going with whatever's already
      // collected plus the remaining usernames.
      console.warn(`  ${username}: failed after ${userGames} games (${(err as Error).message}) -- skipping`);
    }
  }

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

  console.log(
    `\ndone. ${entries.length} unique positions from ${gamesScanned} games written to ` +
      `${path.relative(repoRoot, args.out)}`
  );
  if (entries.length < args.target) {
    console.warn(
      `warning: reached the end of ${args.usernames.length} username(s)' games before hitting the ` +
        `${args.target} target -- add more usernames or raise --max-games-per-user`
    );
  }
}

main().catch((err) => {
  console.error('build-calibration-corpus failed:', err);
  process.exit(1);
});
