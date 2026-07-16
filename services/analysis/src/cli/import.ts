import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getDatabase } from '@penumbra/db';
import { streamUserGames, lichessGameToUpsertInput } from '../import/lichess.js';
import { extractGames } from '../import/pgn.js';
import { importGame } from '../import/importGame.js';
import type { UpsertGameInput } from '../import/persist.js';

interface ImportArgs {
  user?: string;
  max: number;
  pgnFile?: string;
}

function parseImportArgs(argv: string[]): ImportArgs {
  let user: string | undefined;
  let max = 20;
  let pgnFile: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') continue;
    switch (argv[i]) {
      case '--user':
        user = argv[++i];
        break;
      case '--max':
        max = Number(argv[++i]);
        break;
      case '--pgn':
        pgnFile = argv[++i];
        break;
      default:
        throw new Error(`unrecognized argument: "${argv[i]}"`);
    }
  }

  if (!user && !pgnFile) throw new Error('either --user <name> or --pgn <file> is required');
  if (user && pgnFile) throw new Error('--user and --pgn are mutually exclusive');
  if (!Number.isFinite(max) || max <= 0) throw new Error(`--max must be a positive number, got "${max}"`);

  return { user, max, pgnFile };
}

// A manual PGN file has no canonical id like a Lichess game does; hashing
// the re-serialized PGN text makes reimporting the same file idempotent
// against the (source, source_game_id) unique index instead of creating a
// duplicate row on every run.
function manualGameId(pgn: string): string {
  return createHash('sha256').update(pgn).digest('hex').slice(0, 40);
}

export async function runImportCommand(argv: string[], databaseUrl: string): Promise<void> {
  const args = parseImportArgs(argv);
  const db = await getDatabase(databaseUrl);

  let imported = 0;

  if (args.user) {
    for await (const game of streamUserGames(args.user, { max: args.max })) {
      const { gameId, positions } = await importGame(db, lichessGameToUpsertInput(game));
      imported++;
      console.log(`imported game ${game.id} -> db id ${gameId} (${positions.length} positions)`);
    }
  } else if (args.pgnFile) {
    const pgnText = readFileSync(args.pgnFile, 'utf8');
    for (const parsed of extractGames(pgnText)) {
      const input: UpsertGameInput = {
        source: 'manual',
        sourceGameId: manualGameId(parsed.pgn),
        white: parsed.headers.get('White') ?? null,
        black: parsed.headers.get('Black') ?? null,
        result: parsed.headers.get('Result') ?? null,
        pgn: parsed.pgn,
      };
      const { gameId } = await importGame(db, input);
      imported++;
      console.log(`imported game -> db id ${gameId} (${parsed.positions.length} positions)`);
    }
  }

  console.log(`done: ${imported} game(s) imported`);
}
