import { getDatabase, type Database } from '@penumbra/db';
import {
  createRedisConnection,
  createAnalyzePositionQueue,
  type AnalyzePositionJobData,
  type AnalyzePositionJobResult,
} from '@penumbra/analysis';
import type IORedis from 'ioredis';
import type { Queue } from 'bullmq';
import { Client as MinioClient } from 'minio';

// The public v1 fog endpoint always reads and enqueues onto the canonical
// tier -- quick is Stage 4's internal game-analysis speed tier, but a
// public Fog Index lookup should always resolve to the deep, authoritative
// score (docs/ROADMAP.md Stage 5 route table). Agent's call, logged in
// HANDOFF.md: the roadmap doesn't say which tier the public endpoint uses.
export const PUBLIC_FOG_TIER = 'canonical' as const;

export function databaseUrl(): string {
  return process.env.DATABASE_URL || 'postgresql://penumbra:penumbra@localhost:5432/penumbra';
}

export function apiPort(): number {
  return Number(process.env.PORT) || 3001;
}

export function webOrigin(): string {
  return process.env.WEB_ORIGIN || 'http://localhost:3000';
}

// The bucket infra/docker-compose.yml's minio service is expected to serve
// certs from -- created if missing by ensureProofsBucket (see ledger.ts).
export const PROOFS_BUCKET = 'proofs';

export function minioClient(): MinioClient {
  return new MinioClient({
    endPoint: process.env.MINIO_HOST || 'localhost',
    port: Number(process.env.MINIO_PORT) || 9000,
    useSSL: false,
    accessKey: process.env.MINIO_ROOT_USER || 'minioadmin',
    secretKey: process.env.MINIO_ROOT_PASSWORD || 'minioadmin',
  });
}

export interface ApiContext {
  db: Database;
  redis: IORedis;
  minio: MinioClient;
  fogQueue: Queue<AnalyzePositionJobData, AnalyzePositionJobResult>;
}

export async function createContext(): Promise<ApiContext> {
  const db = await getDatabase(databaseUrl());
  const redis = createRedisConnection();
  const minio = minioClient();
  const fogQueue = createAnalyzePositionQueue(PUBLIC_FOG_TIER, redis);
  return { db, redis, minio, fogQueue };
}
