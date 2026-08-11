// Runs the Fog Index calibration corpus (built by build-calibration-corpus.js)
// through the canonical engine ladder and, once done, computes a real
// percentile table to replace the placeholder FOG_CALIBRATION_V0_1 in
// packages/fog/src/calibration.ts (docs/FOG_INDEX_METHODOLOGY.md's
// "Calibration status: PROVISIONAL" note).
//
// This is a long-running job by design (~90s/position at canonical tier,
// see docs/ENGINES.md) -- it's built to be safely interruptible and
// resumable: before spending engine time on a position, it checks whether a
// fog_scores row already exists for that position at this formula
// version/engine fingerprint, and skips it if so. Killing and re-running
// this script picks up wherever it left off; it never re-does finished
// work.
//
// Usage:
//   node dist/scripts/run-calibration.js run [--corpus <path>] [--concurrency N] [--tier canonical]
//   node dist/scripts/run-calibration.js report [--corpus <path>]
//     -- prints the percentile table computed from whatever's already in
//        fog_scores for the corpus, without running anything further.

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inArray, eq, and } from 'drizzle-orm';
import { getDatabase, schema, type Database } from '@penumbra/db';
import { FOG_FORMULA_VERSION } from '@penumbra/fog';
import { analyzePosition } from '../pipeline/analyzePosition.js';
import { computeFingerprintForTier } from '../fingerprint.js';
import type { Tier } from '../engines/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const DEFAULT_CORPUS = path.join(repoRoot, 'corpus', 'calibration', 'positions.jsonl');

function databaseUrl(): string {
  return process.env.DATABASE_URL || 'postgresql://penumbra:penumbra@localhost:5432/penumbra';
}

interface CorpusEntry {
  fen: string;
  epd: string;
  ply: number;
  pieceCount: number;
  sourceGameId: string;
  sourceUsername: string;
}

async function loadCorpus(corpusPath: string): Promise<CorpusEntry[]> {
  const text = await readFile(corpusPath, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CorpusEntry);
}

/** EPDs in `entries` that already have a fog_scores row for this formula/fingerprint. */
async function alreadyScoredEpds(
  db: Database,
  entries: CorpusEntry[],
  formulaVersion: string,
  engineFingerprint: string
): Promise<Set<string>> {
  const done = new Set<string>();
  const epds = entries.map((e) => e.epd);
  // positions.epd is unique, so chunking keeps a single IN-list from growing
  // unbounded across a 100k-entry corpus.
  const CHUNK = 5_000;
  for (let i = 0; i < epds.length; i += CHUNK) {
    const chunk = epds.slice(i, i + CHUNK);
    const rows = await db
      .select({ epd: schema.positions.epd })
      .from(schema.fogScores)
      .innerJoin(schema.positions, eq(schema.positions.id, schema.fogScores.positionId))
      .where(
        and(
          inArray(schema.positions.epd, chunk),
          eq(schema.fogScores.formulaVersion, formulaVersion),
          eq(schema.fogScores.engineFingerprint, engineFingerprint)
        )
      );
    for (const row of rows) done.add(row.epd);
  }
  return done;
}

/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once. Each
 * worker gets its own dedicated resource (from `makeResource`) for its
 * entire lifetime rather than sharing one across all workers -- `getDatabase`
 * wraps a single `pg.Client`, which only runs one query at a time, so N
 * workers sharing one client would serialize every DB round trip and (per
 * node-postgres) print an increasingly-not-supported deprecation warning
 * under concurrent use. Each worker owning its own client also matches how
 * this is actually meant to run: one real Postgres connection per concurrent
 * engine pipeline, not one connection fanned out across twelve.
 */
async function runPool<T, R>(
  items: T[],
  concurrency: number,
  makeResource: () => Promise<R>,
  fn: (resource: R, item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  async function worker() {
    const resource = await makeResource();
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await fn(resource, items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function runCalibration(corpusPath: string, concurrency: number, tier: Tier): Promise<void> {
  const db = await getDatabase(databaseUrl());
  const entries = await loadCorpus(corpusPath);
  const engineFingerprint = computeFingerprintForTier(tier);

  console.log(`corpus: ${entries.length} positions from ${path.relative(repoRoot, corpusPath)}`);
  console.log(`tier: ${tier}, engine fingerprint: ${engineFingerprint}, concurrency: ${concurrency}`);

  const done = await alreadyScoredEpds(db, entries, FOG_FORMULA_VERSION, engineFingerprint);
  const remaining = entries.filter((e) => !done.has(e.epd));
  console.log(`${done.size} already scored, ${remaining.length} remaining`);

  if (remaining.length === 0) {
    console.log('nothing to do -- run the "report" command to compute percentiles.');
    return;
  }

  let completed = 0;
  let failed = 0;
  const start = Date.now();

  await runPool(
    remaining,
    concurrency,
    () => getDatabase(databaseUrl()),
    async (workerDb, entry) => {
      try {
        await analyzePosition(workerDb, { fen: entry.fen, tier });
      } catch (err) {
        failed += 1;
        console.error(`  failed on ${entry.epd}: ${(err as Error).message}`);
        return;
      }
      completed += 1;
      if (completed % 25 === 0 || completed === remaining.length) {
        const elapsedS = (Date.now() - start) / 1000;
        const rate = completed / elapsedS;
        const etaS = rate > 0 ? (remaining.length - completed) / rate : NaN;
        console.log(
          `  ${completed}/${remaining.length} done (${failed} failed), ` +
            `${rate.toFixed(3)}/s, eta ${(etaS / 3600).toFixed(1)}h`
        );
      }
    }
  );

  console.log(`\ndone. ${completed} scored this run, ${failed} failed, ${done.size + completed} total scored.`);
}

function computePercentiles(scores: number[]): Record<string, number> {
  const sorted = [...scores].sort((a, b) => a - b);
  const at = (p: number): number => {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  };
  return {
    '0.1': at(0.1),
    '1': at(1),
    '5': at(5),
    '10': at(10),
    '25': at(25),
    '50': at(50),
    '75': at(75),
    '90': at(90),
    '95': at(95),
    '99': at(99),
    '99.9': at(99.9),
  };
}

async function report(corpusPath: string, tier: Tier): Promise<void> {
  const db = await getDatabase(databaseUrl());
  const entries = await loadCorpus(corpusPath);
  const engineFingerprint = computeFingerprintForTier(tier);

  const epds = entries.map((e) => e.epd);
  const scores: number[] = [];
  const CHUNK = 5_000;
  for (let i = 0; i < epds.length; i += CHUNK) {
    const chunk = epds.slice(i, i + CHUNK);
    const rows = await db
      .select({ score: schema.fogScores.score })
      .from(schema.fogScores)
      .innerJoin(schema.positions, eq(schema.positions.id, schema.fogScores.positionId))
      .where(
        and(
          inArray(schema.positions.epd, chunk),
          eq(schema.fogScores.formulaVersion, FOG_FORMULA_VERSION),
          eq(schema.fogScores.engineFingerprint, engineFingerprint)
        )
      );
    scores.push(...rows.map((r) => r.score));
  }

  console.log(`${scores.length}/${entries.length} positions scored so far.`);
  if (scores.length === 0) return;

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  const percentiles = computePercentiles(scores);

  console.log(
    JSON.stringify(
      {
        formulaVersion: FOG_FORMULA_VERSION,
        corpusSize: scores.length,
        minScore: Math.min(...scores),
        maxScore: Math.max(...scores),
        mean: Math.round(mean * 10) / 10,
        stdDev: Math.round(Math.sqrt(variance) * 10) / 10,
        percentiles,
      },
      null,
      2
    )
  );
}

function parseArgs(argv: string[]) {
  let corpus = DEFAULT_CORPUS;
  let concurrency = os.cpus().length;
  let tier: Tier = 'canonical';

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--corpus':
        corpus = path.resolve(argv[++i]);
        break;
      case '--concurrency':
        concurrency = Number(argv[++i]);
        break;
      case '--tier': {
        const value = argv[++i];
        if (value !== 'quick' && value !== 'canonical') {
          throw new Error(`--tier must be "quick" or "canonical", got "${value}"`);
        }
        tier = value;
        break;
      }
      default:
        throw new Error(`unrecognized argument: "${argv[i]}"`);
    }
  }

  return { corpus, concurrency, tier };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { corpus, concurrency, tier } = parseArgs(rest);

  if (command === 'run') {
    await runCalibration(corpus, concurrency, tier);
  } else if (command === 'report') {
    await report(corpus, tier);
  } else {
    throw new Error(`usage: run-calibration.js <run|report> [--corpus <path>] [--concurrency N] [--tier quick|canonical]`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('run-calibration failed:', err);
  process.exit(1);
});
