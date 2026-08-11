// Fleet: work-unit federation (docs/FLEET_DESIGN.md). The first public
// mutating /v1 route -- deliberately anonymous (no requireApiKey), backed
// only by the existing global rate limit, matching the "permissionless by
// construction" design: no registration step, trust supplied per-submission
// by real verification, never by who's asking.

import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { normalizeEPD, computeZobristHash, zobristToHexString, getPieceCount } from '@penumbra/core';
import { schema } from '@penumbra/db';
import type { Certificate } from '@penumbra/cert-schema';
import {
  workUnitListQuerySchema,
  workUnitIdParamSchema,
  workUnitListResponseSchema,
  workUnitSummarySchema,
  fleetSubmissionBodySchema,
  fleetSubmissionResponseSchema,
  errorResponseSchema,
} from '../schemas.js';
import type { ApiContext } from '../context.js';
import { publishProof } from '../ledger.js';
import { verifyCertificateJson } from '../verifySubprocess.js';

type WorkUnitRow = typeof schema.workUnits.$inferSelect;

function toWorkUnitSummary(row: WorkUnitRow) {
  return {
    id: row.id,
    fen: row.fen,
    claimValue: row.claimValue,
    claimSide: row.claimSide,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Upserts the position row a certificate's FEN needs before publishProof
 * can reference it. A Fleet work unit's FEN is in exactly the situation
 * scripts/publish-proofs.mjs's own ensurePosition was written for --
 * synthetic (or, here, pipeline-derived from a real game but never
 * separately imported as its own position), never previously seen on its
 * own -- so this mirrors that helper rather than inventing a second one.
 */
async function ensurePosition(db: ApiContext['db'], fen: string): Promise<string> {
  const epd = normalizeEPD(fen);
  const zobrist = zobristToHexString(computeZobristHash(fen));
  const pieceCount = getPieceCount(fen);
  await db
    .insert(schema.positions)
    .values({ epd, zobrist, pieceCount })
    .onConflictDoNothing({ target: schema.positions.epd });
  return epd;
}

export async function registerFleetRoutes(fastify: FastifyInstance, context: ApiContext): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/v1/fleet/work-units',
    { schema: { querystring: workUnitListQuerySchema, response: { 200: workUnitListResponseSchema } } },
    async (request) => {
      const { status, limit, offset } = request.query;
      const where = status ? eq(schema.workUnits.status, status) : undefined;

      const [rows, [{ count }]] = await Promise.all([
        context.db
          .select()
          .from(schema.workUnits)
          .where(where)
          .orderBy(desc(schema.workUnits.createdAt))
          .limit(limit)
          .offset(offset),
        context.db.select({ count: sql<number>`count(*)::int` }).from(schema.workUnits).where(where),
      ]);

      return { workUnits: rows.map(toWorkUnitSummary), total: count };
    }
  );

  app.get(
    '/v1/fleet/work-units/:id',
    { schema: { params: workUnitIdParamSchema, response: { 200: workUnitSummarySchema, 404: errorResponseSchema } } },
    async (request, reply) => {
      const [row] = await context.db
        .select()
        .from(schema.workUnits)
        .where(eq(schema.workUnits.id, request.params.id))
        .limit(1);

      if (!row) {
        reply.code(404);
        return { error: `no work unit found for id ${request.params.id}` };
      }
      return toWorkUnitSummary(row);
    }
  );

  app.post(
    '/v1/fleet/submissions',
    {
      schema: {
        body: fleetSubmissionBodySchema,
        response: { 201: fleetSubmissionResponseSchema, 400: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { certificate, workUnitId } = request.body;

      if (workUnitId !== undefined) {
        const [workUnit] = await context.db
          .select({ id: schema.workUnits.id })
          .from(schema.workUnits)
          .where(eq(schema.workUnits.id, workUnitId))
          .limit(1);
        if (!workUnit) {
          reply.code(400);
          return { error: `no work unit found for id ${workUnitId}` };
        }
      }

      // The one gate this endpoint may never skip or lighten (docs/
      // FLEET_DESIGN.md §5.3/§5.5) -- runs before publishProof is ever
      // called, identically regardless of who submitted or whether a
      // signature was attached. A signature is attribution, not a
      // substitute for this.
      const certificateJson = JSON.stringify(certificate);
      const report = await verifyCertificateJson(certificateJson);
      if (!report.valid) {
        reply.code(400);
        return { error: report.errors.length > 0 ? report.errors.join('; ') : 'certificate failed verification' };
      }

      const epd = await ensurePosition(context.db, certificate.claim.fen);
      const result = await publishProof(context.db, context.minio, epd, certificate as unknown as Certificate);

      if (workUnitId !== undefined && !result.alreadyPublished) {
        await context.db
          .update(schema.workUnits)
          .set({ status: 'proved', provedByProofId: result.proofId })
          .where(and(eq(schema.workUnits.id, workUnitId), eq(schema.workUnits.status, 'open')));
      }

      reply.code(201);
      return {
        proofId: result.proofId,
        certificateSha256: result.certificateSha256,
        ledgerSeq: result.ledgerSeq,
        alreadyPublished: result.alreadyPublished,
        contributors: certificate.metadata?.contributors ?? null,
      };
    }
  );
}
