import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { schema, type Database } from '@penumbra/db';

export type ApiKeyRow = typeof schema.apiKeys.$inferSelect;

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyRow;
  }
}

// Keys are issued out-of-band (format `pnb_` + 32 random bytes hex, per
// docs/ROADMAP.md Stage 5) -- only the hash below is ever stored or
// compared, matching the fingerprint/certificate-hash '0x' + sha256 hex
// convention used everywhere else in this codebase.
export function hashApiKey(key: string): string {
  return '0x' + crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Global onRequest hook: attaches request.apiKey when a valid X-API-Key is
 * presented, 401s on a present-but-invalid/revoked key, and otherwise lets
 * the request through anonymously -- individual routes decide whether
 * anonymous access is allowed via requireApiKey.
 */
export function createAuthHook(db: Database) {
  return async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers['x-api-key'];
    if (header === undefined) return;
    if (Array.isArray(header)) {
      reply.code(401).send({ error: 'invalid api key' });
      return;
    }

    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, hashApiKey(header)))
      .limit(1);

    if (!row || row.revokedAt) {
      reply.code(401).send({ error: 'invalid api key' });
      return;
    }

    request.apiKey = row;
  };
}

/** preHandler for routes that must not be reachable anonymously (mutating BFF routes). */
export async function requireApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.apiKey) {
    reply.code(401).send({ error: 'API key required' });
  }
}
