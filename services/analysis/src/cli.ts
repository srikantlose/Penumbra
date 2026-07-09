import { getDatabase } from '@penumbra/db';
import { analyzePosition } from './pipeline/analyzePosition.js';
import type { Tier } from './engines/config.js';

function databaseUrl(): string {
  return process.env.DATABASE_URL || 'postgresql://penumbra:penumbra@localhost:5432/penumbra';
}

function parseArgs(argv: string[]): { fen: string; tier: Tier; json: boolean } {
  let fen: string | undefined;
  let tier: Tier = 'quick';
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    // pnpm forwards a bare "--" separator through to the script in some
    // invocation forms instead of stripping it -- ignore it defensively.
    if (argv[i] === '--') continue;
    switch (argv[i]) {
      case '--fen':
        fen = argv[++i];
        break;
      case '--tier': {
        const value = argv[++i];
        if (value !== 'quick' && value !== 'canonical') {
          throw new Error(`--tier must be "quick" or "canonical", got "${value}"`);
        }
        tier = value;
        break;
      }
      case '--json':
        json = true;
        break;
      default:
        throw new Error(`unrecognized argument: "${argv[i]}"`);
    }
  }

  if (!fen) throw new Error('--fen "<fen>" is required');
  return { fen, tier, json };
}

async function main() {
  const { fen, tier, json } = parseArgs(process.argv.slice(2));
  const db = await getDatabase(databaseUrl());
  const result = await analyzePosition(db, { fen, tier });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`epd: ${result.epd}`);
    console.log(`fog score: ${result.fogScore.score} (${result.fogScore.status})`);
    console.log(`percentile: ${result.percentile ?? 'n/a'}`);
    console.log(`engine fingerprint: ${result.engineFingerprint}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('analyze failed:', err.message);
  process.exit(1);
});
