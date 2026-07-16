import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { normalizeEPD } from '@penumbra/core';
import { schema, isPositionProven } from '@penumbra/db';
import { enqueueAnalyzePosition, computeFingerprintForTier } from '@penumbra/analysis';
import { FOG_FORMULA_VERSION, type FogComponents } from '@penumbra/fog';
import {
  fogQuerySchema,
  fogBatchBodySchema,
  fogReadySchema,
  fogPendingSchema,
  fogBatchResponseSchema,
  errorResponseSchema,
} from '../schemas.js';
import { type ApiContext, PUBLIC_FOG_TIER } from '../context.js';

const RETRY_AFTER_MS = 5000;

type FogResult =
  | { ready: true; score: number; components: FogComponents; percentile: number | null; status: 'EVALUATED' | 'PROVEN'; fingerprint: string }
  | { ready: false };

/**
 * Latest canonical fog_scores hit for this FEN, or a miss that has already
 * enqueued the canonical analyze-position job (idempotent jobId, so a
 * flurry of requests for the same position dedupes onto one job).
 */
async function resolveFog(context: ApiContext, fen: string): Promise<FogResult> {
  const epd = normalizeEPD(fen);

  const [position] = await context.db
    .select({ id: schema.positions.id, pieceCount: schema.positions.pieceCount })
    .from(schema.positions)
    .where(eq(schema.positions.epd, epd))
    .limit(1);

  const fingerprint = computeFingerprintForTier(PUBLIC_FOG_TIER);

  if (position) {
    const [row] = await context.db
      .select()
      .from(schema.fogScores)
      .where(
        and(
          eq(schema.fogScores.positionId, position.id),
          eq(schema.fogScores.formulaVersion, FOG_FORMULA_VERSION),
          eq(schema.fogScores.engineFingerprint, fingerprint)
        )
      )
      .orderBy(desc(schema.fogScores.createdAt))
      .limit(1);

    if (row) {
      const proven = await isPositionProven(context.db, position.id, position.pieceCount);
      return {
        ready: true,
        score: row.score,
        // fog_scores.components is exactly what computeFogIndex() produced
        // at write time (analyzePosition.ts) -- the json column types as
        // unknown at the drizzle level, so this cast just restores that
        // known shape; the zod response schema is the real runtime guard.
        components: row.components as FogComponents,
        percentile: row.percentile,
        status: proven ? 'PROVEN' : 'EVALUATED',
        fingerprint: row.engineFingerprint,
      };
    }
  }

  await enqueueAnalyzePosition(context.fogQueue, fen, PUBLIC_FOG_TIER);
  return { ready: false };
}

/** Cheap pre-check reusing normalizeEPD's own validation, so bad input 400s instead of 500ing inside resolveFog. */
function isValidFen(fen: string): boolean {
  try {
    normalizeEPD(fen);
    return true;
  } catch {
    return false;
  }
}

export async function registerFogRoutes(fastify: FastifyInstance, context: ApiContext): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/v1/fog',
    { schema: { querystring: fogQuerySchema, response: { 200: fogReadySchema, 202: fogPendingSchema, 400: errorResponseSchema } } },
    async (request, reply) => {
      if (!isValidFen(request.query.fen)) {
        reply.code(400);
        return { error: `invalid fen: "${request.query.fen}"` };
      }
      const result = await resolveFog(context, request.query.fen);
      if (result.ready) {
        return {
          score: result.score,
          components: result.components,
          percentile: result.percentile,
          percentile_provisional: true as const,
          status: result.status,
          fingerprint: result.fingerprint,
        };
      }
      reply.code(202);
      return { status: 'pending' as const, retry_after_ms: RETRY_AFTER_MS };
    }
  );

  app.post(
    '/v1/fog/batch',
    { schema: { body: fogBatchBodySchema, response: { 200: fogBatchResponseSchema, 400: errorResponseSchema } } },
    async (request, reply) => {
      const invalidIndex = request.body.fens.findIndex((fen) => !isValidFen(fen));
      if (invalidIndex !== -1) {
        reply.code(400);
        return { error: `invalid fen at index ${invalidIndex}: "${request.body.fens[invalidIndex]}"` };
      }

      const results = await Promise.all(
        request.body.fens.map(async (fen) => {
          const result = await resolveFog(context, fen);
          if (result.ready) {
            return {
              fen,
              score: result.score,
              components: result.components,
              percentile: result.percentile,
              percentile_provisional: true as const,
              status: result.status,
              fingerprint: result.fingerprint,
            };
          }
          return { fen, status: 'pending' as const, retry_after_ms: RETRY_AFTER_MS };
        })
      );
      return { results };
    }
  );
}
