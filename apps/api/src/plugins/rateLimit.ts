import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type IORedis from 'ioredis';

const ANONYMOUS_LIMIT_PER_MINUTE = 60;

/**
 * Per-key api_keys.rate_limit/min when authenticated, 60/min per-IP
 * anonymous (docs/ROADMAP.md Stage 5). Runs after the auth hook so
 * request.apiKey is already populated when the bucket key/limit is chosen.
 */
export async function registerRateLimit(fastify: FastifyInstance, redis: IORedis): Promise<void> {
  await fastify.register(rateLimit, {
    global: true,
    redis,
    timeWindow: '1 minute',
    keyGenerator: (request) => (request.apiKey ? `key:${request.apiKey.id}` : `ip:${request.ip}`),
    max: async (request) => (request.apiKey ? request.apiKey.rateLimit : ANONYMOUS_LIMIT_PER_MINUTE),
  });
}
