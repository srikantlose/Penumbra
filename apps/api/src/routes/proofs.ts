import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { schema } from '@penumbra/db';
import {
  proofListQuerySchema,
  proofIdParamSchema,
  proofListResponseSchema,
  proofSummarySchema,
  errorResponseSchema,
} from '../schemas.js';
import { type ApiContext, PROOFS_BUCKET } from '../context.js';

const DOWNLOAD_URL_EXPIRY_SECONDS = 3600;

type ProofRow = typeof schema.proofs.$inferSelect;

async function toProofSummary(context: ApiContext, row: ProofRow, epd: string) {
  // presignedGetObject signs locally with the stored credentials -- no
  // network round trip to minio, so this is cheap even across a full page.
  const downloadUrl = row.certificateObjectKey
    ? await context.minio.presignedGetObject(PROOFS_BUCKET, row.certificateObjectKey, DOWNLOAD_URL_EXPIRY_SECONDS)
    : null;

  return {
    id: row.id,
    positionEpd: epd,
    claim: row.claim,
    value: row.value,
    bound: row.bound,
    status: row.status,
    formatVersion: row.formatVersion,
    certificateSha256: row.certificateSha256,
    downloadUrl,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerProofsRoutes(fastify: FastifyInstance, context: ApiContext): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/v1/proofs',
    { schema: { querystring: proofListQuerySchema, response: { 200: proofListResponseSchema } } },
    async (request) => {
      const { limit, offset } = request.query;

      const [rows, [{ count }]] = await Promise.all([
        context.db
          .select({ proof: schema.proofs, epd: schema.positions.epd })
          .from(schema.proofs)
          .innerJoin(schema.positions, eq(schema.proofs.positionId, schema.positions.id))
          .orderBy(desc(schema.proofs.publishedAt))
          .limit(limit)
          .offset(offset),
        context.db.select({ count: sql<number>`count(*)::int` }).from(schema.proofs),
      ]);

      const proofs = await Promise.all(rows.map((row) => toProofSummary(context, row.proof, row.epd)));
      return { proofs, total: count };
    }
  );

  app.get(
    '/v1/proofs/:id',
    { schema: { params: proofIdParamSchema, response: { 200: proofSummarySchema, 404: errorResponseSchema } } },
    async (request, reply) => {
      const [row] = await context.db
        .select({ proof: schema.proofs, epd: schema.positions.epd })
        .from(schema.proofs)
        .innerJoin(schema.positions, eq(schema.proofs.positionId, schema.positions.id))
        .where(eq(schema.proofs.id, request.params.id))
        .limit(1);

      if (!row) {
        reply.code(404);
        return { error: `no proof found for id ${request.params.id}` };
      }

      return toProofSummary(context, row.proof, row.epd);
    }
  );
}
