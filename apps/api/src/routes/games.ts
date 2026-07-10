import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { schema } from '@penumbra/db';
import { gameIdParamSchema, gameResponseSchema, errorResponseSchema } from '../schemas.js';
import type { ApiContext } from '../context.js';

// Not in the original Stage 5 route table -- added for Stage 6's /journey
// page, which needs a game's analysis (fog timeline, proof-entry ply) after
// /bff/import brings the raw game in. importGame() only imports; analysis
// is still a separate step (services/analysis's analyze-game CLI), so
// `analysis` is null until that's run for a given game.
export async function registerGamesRoutes(fastify: FastifyInstance, context: ApiContext): Promise<void> {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/v1/games/:id',
    { schema: { params: gameIdParamSchema, response: { 200: gameResponseSchema, 404: errorResponseSchema } } },
    async (request, reply) => {
      const [game] = await context.db.select().from(schema.games).where(eq(schema.games.id, request.params.id)).limit(1);
      if (!game) {
        reply.code(404);
        return { error: `no game found for id ${request.params.id}` };
      }

      const [analysis] = await context.db
        .select()
        .from(schema.analyses)
        .where(eq(schema.analyses.gameId, game.id))
        .orderBy(desc(schema.analyses.createdAt))
        .limit(1);

      return {
        id: game.id,
        source: game.source,
        sourceGameId: game.sourceGameId,
        white: game.white,
        black: game.black,
        result: game.result,
        importedAt: game.importedAt.toISOString(),
        analysis: analysis
          ? {
              id: analysis.id,
              tier: analysis.tier,
              status: analysis.status,
              fogTimeline: analysis.fogTimeline,
              proofEntryPly: analysis.proofEntryPly,
              missedProofs: analysis.missedProofs,
              completedAt: analysis.completedAt ? analysis.completedAt.toISOString() : null,
            }
          : null,
      };
    }
  );
}
