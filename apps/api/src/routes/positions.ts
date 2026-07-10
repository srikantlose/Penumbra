import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { schema, isPositionProven } from '@penumbra/db';
import { computeFingerprintForTier } from '@penumbra/analysis';
import { FOG_FORMULA_VERSION, type FogComponents } from '@penumbra/fog';
import { zobristParamSchema, positionResponseSchema, errorResponseSchema } from '../schemas.js';
import { type ApiContext, PUBLIC_FOG_TIER } from '../context.js';

// positions.zobrist is stored as zobristToHexString()'s output: '0x' + 16
// lowercase hex digits (packages/core/src/zobrist/index.ts). Accepting a
// bare hex string too (no "0x") is a cheap convenience for API callers.
function normalizeZobrist(raw: string): string {
  const lower = raw.toLowerCase();
  return lower.startsWith('0x') ? lower : `0x${lower}`;
}

export async function registerPositionsRoutes(fastify: FastifyInstance, context: ApiContext): Promise<void> {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/v1/positions/:zobrist',
    {
      schema: {
        params: zobristParamSchema,
        response: { 200: positionResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const zobrist = normalizeZobrist(request.params.zobrist);

      const [position] = await context.db
        .select()
        .from(schema.positions)
        .where(eq(schema.positions.zobrist, zobrist))
        .limit(1);

      if (!position) {
        reply.code(404);
        return { error: `no position found for zobrist ${zobrist}` };
      }

      const fingerprint = computeFingerprintForTier(PUBLIC_FOG_TIER);

      const [evalRows, proofRows, fogRows, proven] = await Promise.all([
        context.db.select().from(schema.evals).where(eq(schema.evals.positionId, position.id)).orderBy(schema.evals.createdAt),
        context.db.select().from(schema.proofs).where(eq(schema.proofs.positionId, position.id)),
        context.db
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
          .limit(1),
        isPositionProven(context.db, position.id, position.pieceCount),
      ]);
      const fogRow = fogRows[0];
      const truthStatus = proven ? ('PROVEN' as const) : ('EVALUATED' as const);

      return {
        epd: position.epd,
        zobrist: position.zobrist,
        pieceCount: position.pieceCount,
        provenance: {
          firstSeenGameId: position.firstSeenGameId,
          occurrenceCount: position.occurrenceCount,
          createdAt: position.createdAt.toISOString(),
        },
        truthStatus,
        fog: fogRow
          ? {
              score: fogRow.score,
              components: fogRow.components as FogComponents,
              percentile: fogRow.percentile,
              percentileProvisional: true as const,
              status: truthStatus,
              fingerprint: fogRow.engineFingerprint,
            }
          : null,
        evals: evalRows.map((row) => ({
          engine: row.engine,
          engineVersion: row.engineVersion,
          netId: row.netId,
          nodes: row.nodes,
          depth: row.depth,
          multiPvRank: row.multiPVRank,
          scoreCp: row.scoreCp,
          scoreMate: row.scoreMate,
          wdl: { wins: row.wdlW, draws: row.wdlD, losses: row.wdlL },
          settings: row.settings,
          engineFingerprint: row.engineFingerprint,
          createdAt: row.createdAt.toISOString(),
        })),
        proofRefs: proofRows.map((row) => ({
          id: row.id,
          value: row.value,
          bound: row.bound,
          status: row.status,
          certificateSha256: row.certificateSha256,
          publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        })),
      };
    }
  );
}
