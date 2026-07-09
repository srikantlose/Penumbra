import { Worker, type Job } from 'bullmq';
import { getDatabase, type Database } from '@penumbra/db';
import type { Tier } from '../engines/config.js';
import { killAllActiveEngines } from '../uci/client.js';
import { analyzePosition } from '../pipeline/analyzePosition.js';
import {
  createRedisConnection,
  queueNameForTier,
  type AnalyzePositionJobData,
  type AnalyzePositionJobResult,
} from './queues.js';

const CONCURRENCY: Record<Tier, number> = { quick: 2, canonical: 1 };
const TIERS: Tier[] = ['quick', 'canonical'];

function databaseUrl(): string {
  return process.env.DATABASE_URL || 'postgresql://penumbra:penumbra@localhost:5432/penumbra';
}

async function processJob(db: Database, job: Job<AnalyzePositionJobData>): Promise<AnalyzePositionJobResult> {
  const { fen, tier } = job.data;
  const result = await analyzePosition(db, { fen, tier });
  return {
    positionId: result.positionId,
    score: result.fogScore.score,
    percentile: result.percentile,
    status: result.fogScore.status,
    engineFingerprint: result.engineFingerprint,
  };
}

async function main() {
  const db = await getDatabase(databaseUrl());
  const connection = createRedisConnection();

  const workers = TIERS.map(
    (tier) =>
      new Worker<AnalyzePositionJobData, AnalyzePositionJobResult>(
        queueNameForTier(tier),
        (job) => processJob(db, job),
        { connection, concurrency: CONCURRENCY[tier] }
      )
  );

  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      console.error(`${worker.name} job ${job?.id} failed:`, err.message);
    });
  }

  console.log(
    `analysis worker started (quick concurrency=${CONCURRENCY.quick}, canonical concurrency=${CONCURRENCY.canonical})`
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('shutting down analysis worker...');

    // Force-kill in-flight engine subprocesses immediately rather than
    // waiting out their search timeout -- Windows has no POSIX signals, so
    // proc.kill() (TerminateProcess) is the only reliable way to stop them.
    killAllActiveEngines();

    await Promise.all(workers.map((w) => w.close(true)));
    connection.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('analysis worker failed to start:', err);
  process.exit(1);
});
