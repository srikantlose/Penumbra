import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { schema, SYZYGY_MAX_PIECES } from '@penumbra/db';
import { computeFingerprintForTier, streamUserGames, importGame, lichessGameToUpsertInput } from '@penumbra/analysis';
import { FOG_FORMULA_VERSION } from '@penumbra/fog';
import {
  bffStatsResponseSchema,
  bffFrontierResponseSchema,
  bffImportBodySchema,
  bffImportResponseSchema,
} from '../schemas.js';
import { type ApiContext, PUBLIC_FOG_TIER } from '../context.js';
import { requireApiKey } from '../plugins/auth.js';

const DEFAULT_IMPORT_MAX = 20;

export async function registerBffRoutes(fastify: FastifyInstance, context: ApiContext): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const fingerprint = computeFingerprintForTier(PUBLIC_FOG_TIER);

  app.get('/bff/stats', { schema: { response: { 200: bffStatsResponseSchema } } }, async () => {
    const [[{ positions }], [{ proofs }], [{ ledgerHeight }], [{ medianFog }]] = await Promise.all([
      context.db.select({ positions: sql<number>`count(*)::int` }).from(schema.positions),
      context.db
        .select({ proofs: sql<number>`count(*)::int` })
        .from(schema.proofs)
        .where(eq(schema.proofs.status, 'published')),
      context.db.select({ ledgerHeight: sql<number>`coalesce(max(seq), 0)::int` }).from(schema.ledgerEntries),
      context.db
        .select({ medianFog: sql<number | null>`percentile_cont(0.5) within group (order by score)` })
        .from(schema.fogScores)
        .where(
          and(eq(schema.fogScores.formulaVersion, FOG_FORMULA_VERSION), eq(schema.fogScores.engineFingerprint, fingerprint))
        ),
    ]);

    return {
      positions,
      proofs,
      ledgerHeight,
      medianFog: medianFog === null ? null : Math.round(medianFog),
    };
  });

  app.get('/bff/frontier', { schema: { response: { 200: bffFrontierResponseSchema } } }, async () => {
    // "proven" mirrors packages/db/src/truth.ts's deriveTruthStatus exactly:
    // a formal proof, or (within tablebase range) a cached tablebase probe.
    // EXISTS subqueries rather than LEFT JOINs against proofs/tb_probes --
    // proofs.position_id isn't unique (a position can carry more than one
    // proof row), so joining it directly would fan out that position's
    // fog_scores row too, skewing percentile_cont(medianFog). The remaining
    // fog_scores join stays 1:1 per position (its own unique index is on
    // position_id + formula_version + engine_fingerprint), so no fan-out
    // survives here.
    const rows = await context.db
      .select({
        pieceCount: schema.positions.pieceCount,
        positions: sql<number>`count(*)::int`,
        proven: sql<number>`count(*) filter (where exists (
          select 1 from ${schema.proofs} where ${schema.proofs.positionId} = ${schema.positions.id}
        ) or (
          ${schema.positions.pieceCount} <= ${SYZYGY_MAX_PIECES}
          and exists (select 1 from ${schema.tbProbes} where ${schema.tbProbes.positionId} = ${schema.positions.id})
        ))::int`,
        medianFog: sql<number | null>`percentile_cont(0.5) within group (order by ${schema.fogScores.score})`,
      })
      .from(schema.positions)
      .leftJoin(
        schema.fogScores,
        and(
          eq(schema.fogScores.positionId, schema.positions.id),
          eq(schema.fogScores.formulaVersion, FOG_FORMULA_VERSION),
          eq(schema.fogScores.engineFingerprint, fingerprint)
        )
      )
      .groupBy(schema.positions.pieceCount)
      .orderBy(schema.positions.pieceCount);

    return {
      bands: rows.map((row) => ({
        pieceCount: row.pieceCount,
        positions: row.positions,
        proven: row.proven,
        medianFog: row.medianFog === null ? null : Math.round(row.medianFog),
      })),
    };
  });

  // Synchronous for v1: bounded by max (default 20, cap 100) and reuses
  // Stage 4's proven importGame/streamUserGames path as-is. Stage 6's
  // /journey page (docs/ROADMAP.md) wants a "progress" UX during import --
  // if real usage shows this blocking too long, that's the point to add a
  // background import queue, not before. Agent's call, logged in HANDOFF.md.
  app.post(
    '/bff/import',
    { preHandler: requireApiKey, schema: { body: bffImportBodySchema, response: { 200: bffImportResponseSchema } } },
    async (request) => {
      const { username, max } = request.body;
      const gameIds: number[] = [];

      for await (const game of streamUserGames(username, { max: max ?? DEFAULT_IMPORT_MAX })) {
        const { gameId } = await importGame(context.db, lichessGameToUpsertInput(game));
        gameIds.push(gameId);
      }

      return { username, imported: gameIds.length, gameIds };
    }
  );
}
