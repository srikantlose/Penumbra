import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { normalizeEPD } from '@penumbra/core';
import type { Tier } from '../engines/config.js';
import { computeFingerprintForTier } from '../fingerprint.js';

// Quick and canonical tiers get separate BullMQ queues, not just separate
// job data on one queue, so each can carry its own Worker concurrency:
// canonical's 64M-node Stockfish rung is CPU-saturating and Lc0 shares one
// GPU, so canonical worker concurrency stays at 1; quick's ladder tops out
// at 1.6M nodes and can safely run 2 at once. See docs/ROADMAP.md Stage 3.
export function queueNameForTier(tier: Tier): string {
  return `analyze-position:${tier}`;
}

export interface AnalyzePositionJobData {
  fen: string;
  tier: Tier;
}

export function redisUrl(): string {
  return process.env.REDIS_URL || 'redis://localhost:6379';
}

// BullMQ requires this exact setting on any connection it manages.
export function createRedisConnection(): IORedis {
  return new IORedis(redisUrl(), { maxRetriesPerRequest: null });
}

export function createAnalyzePositionQueue(
  tier: Tier,
  connection: IORedis = createRedisConnection()
): Queue<AnalyzePositionJobData> {
  return new Queue<AnalyzePositionJobData>(queueNameForTier(tier), { connection });
}

/**
 * epd + ':' + fingerprint -- re-enqueuing the same position at the same
 * tier lands on the same BullMQ jobId, so it's a dedupe no-op rather than a
 * duplicate job. Computable up front since the fingerprint depends only on
 * pinned settings, not on any actual engine output.
 */
export function analyzePositionJobId(fen: string, tier: Tier): string {
  return `${normalizeEPD(fen)}:${computeFingerprintForTier(tier)}`;
}

export async function enqueueAnalyzePosition(
  queue: Queue<AnalyzePositionJobData>,
  fen: string,
  tier: Tier
): Promise<string> {
  const jobId = analyzePositionJobId(fen, tier);
  await queue.add('analyze-position', { fen, tier }, { jobId });
  return jobId;
}
