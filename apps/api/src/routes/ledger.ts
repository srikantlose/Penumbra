import { asc, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { schema } from '@penumbra/db';
import { ledgerQuerySchema, ledgerResponseSchema } from '../schemas.js';
import type { ApiContext } from '../context.js';

export async function registerLedgerRoutes(fastify: FastifyInstance, context: ApiContext): Promise<void> {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/v1/ledger',
    { schema: { querystring: ledgerQuerySchema, response: { 200: ledgerResponseSchema } } },
    async (request) => {
      // since_seq is exclusive: a client polls with the last seq it already
      // has and gets only newer entries, so the default 0 returns the full
      // chain from seq 1 (bigserial starts at 1).
      const rows = await context.db
        .select()
        .from(schema.ledgerEntries)
        .where(gt(schema.ledgerEntries.seq, request.query.since_seq))
        .orderBy(asc(schema.ledgerEntries.seq));

      return {
        entries: rows.map((row) => ({
          seq: row.seq,
          proofId: row.proofId,
          payload: row.payload,
          prevHash: row.prevHash,
          entryHash: row.entryHash,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    }
  );
}
