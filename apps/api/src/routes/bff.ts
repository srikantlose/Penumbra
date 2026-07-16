import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { schema, SYZYGY_MAX_PIECES } from '@penumbra/db';
import {
  computeFingerprintForTier,
  streamUserGames,
  importGame,
  lichessGameToUpsertInput,
  generateCodeVerifier,
  computeCodeChallenge,
  generateOAuthState,
  buildLichessAuthorizeUrl,
  exchangeLichessCode,
  fetchLichessAccount,
  upsertLichessUser,
} from '@penumbra/analysis';
import { FOG_FORMULA_VERSION } from '@penumbra/fog';
import {
  bffStatsResponseSchema,
  bffFrontierResponseSchema,
  bffImportBodySchema,
  bffImportResponseSchema,
  bffLichessOAuthStartResponseSchema,
  bffLichessOAuthCallbackBodySchema,
  bffLichessOAuthCallbackResponseSchema,
  errorResponseSchema,
} from '../schemas.js';
import { type ApiContext, PUBLIC_FOG_TIER, lichessOAuthClientId, lichessOAuthRedirectUri } from '../context.js';
import { requireApiKey } from '../plugins/auth.js';
import { encryptOAuthToken } from '../lichessOAuth.js';

const DEFAULT_IMPORT_MAX = 20;

// How long a "connect Lichess account" attempt has to complete the round
// trip through Lichess's consent screen before its stashed code_verifier
// expires -- generous enough for a real user, short enough that a stale key
// isn't sitting in Redis for long.
const OAUTH_PENDING_TTL_SECONDS = 600;

function oauthPendingKey(state: string): string {
  return `lichess-oauth-pending:${state}`;
}

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

  // Step 1 of "connect Lichess account" (docs/ROADMAP.md deferred backlog):
  // stashes the PKCE code_verifier in Redis keyed by state (Lichess echoes
  // state back verbatim on the callback, so that's the lookup key -- no
  // cookie needed on the apps/web side for this step) and hands back the
  // URL to redirect the browser to. Called server-to-server from apps/web's
  // connectLichess Server Action.
  app.post(
    '/bff/lichess/oauth/start',
    { preHandler: requireApiKey, schema: { response: { 200: bffLichessOAuthStartResponseSchema } } },
    async () => {
      const codeVerifier = generateCodeVerifier();
      const state = generateOAuthState();

      await context.redis.set(oauthPendingKey(state), codeVerifier, 'EX', OAUTH_PENDING_TTL_SECONDS);

      const authorizeUrl = buildLichessAuthorizeUrl({
        clientId: lichessOAuthClientId(),
        redirectUri: lichessOAuthRedirectUri(),
        codeChallenge: computeCodeChallenge(codeVerifier),
        state,
      });

      return { authorizeUrl };
    }
  );

  // Step 2: apps/web's /journey/connect/callback route handler forwards
  // whatever `code`/`state` Lichess redirected back with. The Redis lookup
  // by state both recovers the matching code_verifier and doubles as CSRF
  // protection (an attacker can't have a valid state without having been
  // handed this exact redirect); it's deleted immediately so a state value
  // can't be replayed.
  app.post(
    '/bff/lichess/oauth/callback',
    {
      preHandler: requireApiKey,
      schema: { body: bffLichessOAuthCallbackBodySchema, response: { 200: bffLichessOAuthCallbackResponseSchema, 400: errorResponseSchema } },
    },
    async (request, reply) => {
      const { code, state } = request.body;
      const key = oauthPendingKey(state);
      const codeVerifier = await context.redis.get(key);

      if (!codeVerifier) {
        reply.code(400);
        return { error: 'oauth state is invalid, expired, or already used' };
      }
      await context.redis.del(key);

      try {
        const clientId = lichessOAuthClientId();
        const redirectUri = lichessOAuthRedirectUri();
        const { accessToken, tokenType } = await exchangeLichessCode({ clientId, redirectUri, code, codeVerifier });
        const account = await fetchLichessAccount(accessToken);

        const encryptedOauthTokens = encryptOAuthToken(
          JSON.stringify({ accessToken, tokenType, connectedAt: new Date().toISOString() })
        );
        const userId = await upsertLichessUser(context.db, {
          lichessId: account.id,
          lichessUsername: account.username,
          encryptedOauthTokens,
        });

        return { userId, lichessUsername: account.username };
      } catch (err) {
        reply.code(400);
        return { error: err instanceof Error ? err.message : 'lichess oauth exchange failed' };
      }
    }
  );
}
