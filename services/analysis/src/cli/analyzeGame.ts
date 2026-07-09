import { getDatabase } from '@penumbra/db';
import { analyzeGame, type AnalysisTier } from '../pipeline/analyzeGame.js';

interface AnalyzeGameArgs {
  gameId: number;
  tier: AnalysisTier;
}

function parseAnalyzeGameArgs(argv: string[]): AnalyzeGameArgs {
  let gameId: number | undefined;
  let tier: AnalysisTier = 'quick';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') continue;
    switch (argv[i]) {
      case '--game-id':
        gameId = Number(argv[++i]);
        break;
      case '--tier': {
        const value = argv[++i];
        if (value !== 'quick' && value !== 'deep') {
          throw new Error(`--tier must be "quick" or "deep", got "${value}"`);
        }
        tier = value;
        break;
      }
      default:
        throw new Error(`unrecognized argument: "${argv[i]}"`);
    }
  }

  if (gameId === undefined || !Number.isFinite(gameId)) {
    throw new Error('--game-id <id> is required');
  }
  return { gameId, tier };
}

export async function runAnalyzeGameCommand(argv: string[], databaseUrl: string): Promise<void> {
  const { gameId, tier } = parseAnalyzeGameArgs(argv);
  const db = await getDatabase(databaseUrl);
  const result = await analyzeGame(db, { gameId, tier });

  console.log(`analysis ${result.analysisId}: ${result.fogTimeline.length} position(s) scored`);
  console.log(`proof entry ply: ${result.proofEntryPly ?? 'none'}`);
  console.log(`missed proofs: ${result.missedProofs.length}`);
}
