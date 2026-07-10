import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { getDatabase, schema } from '@penumbra/db';
import { createRedisConnection } from '@penumbra/analysis';
import type { Certificate } from '@penumbra/cert-schema';
import { buildServer } from './server.js';
import { databaseUrl, minioClient, type ApiContext } from './context.js';
import { publishProof, computeEntryHash, LEDGER_GENESIS_PREV_HASH } from './ledger.js';

// These are fastify.inject() integration tests against the real docker
// Postgres/Redis (docs/ROADMAP.md Stage 5) -- this repo has no disposable
// test database, so the FENs/certs below are deliberately synthetic and
// unique to avoid colliding with real imported games; the handful of rows
// they insert are an accepted permanent fixture in local dev, same as
// running scripts/publish-proofs.mjs by hand.
const FOG_TEST_FEN = '8/8/8/6pk/8/8/6PK/8 w - - 0 1';
const PROOF_TEST_EPD = '7k/8/8/8/8/8/8/K6R w - -';
const PROOF_TEST_FEN = `${PROOF_TEST_EPD} 0 1`;

function fakeFogQueue(): Queue<unknown, unknown> {
  // The roadmap's Stage 5 test list calls for exercising the fog 200/202
  // path "with a mocked queue" -- a live worker takes minutes on the
  // canonical tier, which would make this suite impossibly slow.
  return { add: async () => undefined } as unknown as Queue<unknown, unknown>;
}

describe('apps/api', () => {
  let app: FastifyInstance;
  let context: ApiContext;

  beforeAll(async () => {
    const db = await getDatabase(databaseUrl());
    const redis = createRedisConnection();
    const minio = minioClient();

    // @fastify/rate-limit's redis store persists across process restarts
    // (unlike an in-memory store), so a prior test run's bucket for this
    // same loopback IP can still be live -- clear it first so this suite
    // doesn't inherit another run's counter.
    const staleRateLimitKeys = await redis.keys('fastify-rate-limit-*');
    if (staleRateLimitKeys.length > 0) await redis.del(...staleRateLimitKeys);

    context = { db, redis, minio, fogQueue: fakeFogQueue() };
    app = await buildServer(context);
    await app.ready();

    await db
      .insert(schema.positions)
      .values({ epd: PROOF_TEST_EPD, zobrist: '0xaaaaaaaaaaaaaaaa', pieceCount: 3 })
      .onConflictDoNothing({ target: schema.positions.epd });
  });

  afterAll(async () => {
    await app.close();
    context.redis.disconnect();
  });

  describe('GET /v1/fog', () => {
    it('returns 202 pending on a cache miss and enqueues onto the (mocked) queue', async () => {
      const response = await app.inject({ method: 'GET', url: `/v1/fog?fen=${encodeURIComponent(FOG_TEST_FEN)}` });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ status: 'pending', retry_after_ms: 5000 });
    });

    it('400s a missing fen', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/fog' });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /v1/fog/batch', () => {
    it('returns one pending result per fen', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/fog/batch',
        payload: { fens: [FOG_TEST_FEN] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().results).toEqual([{ fen: FOG_TEST_FEN, status: 'pending', retry_after_ms: 5000 }]);
    });
  });

  describe('GET /v1/positions/:zobrist', () => {
    it('404s an unknown zobrist', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/positions/0xffffffffffffff01' });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: expect.stringContaining('0xffffffffffffff01') });
    });

    it('finds a seeded position by zobrist', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/positions/0xaaaaaaaaaaaaaaaa' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.epd).toBe(PROOF_TEST_EPD);
      // Not asserting EVALUATED specifically: this fixture's proof gets
      // published later in this same suite and proofs are permanent, so a
      // second run against the same live dev DB (no disposable test DB in
      // this repo) finds it already PROVEN. The proof-publishing describe
      // block below asserts the EVALUATED->PROVEN transition itself.
      expect(['EVALUATED', 'PROVEN']).toContain(body.truthStatus);
      expect(body.fog).toBeNull();
    });
  });

  describe('proof publishing + ledger', () => {
    const certificate: Certificate = {
      format_version: '0.1',
      claim: { fen: PROOF_TEST_FEN, zobrist: '0xaaaaaaaaaaaaaaaa', value: 'win', side: 'white' },
      rules: 'standard',
      root_id: 'root',
      nodes: [
        { id: 'root', zobrist: '0xaaaaaaaaaaaaaaaa', to_move: 'white', kind: 'terminal', terminal: { type: 'checkmate', value: 'win' } },
      ],
      dependencies: {},
      metadata: { producer: 'apps/api server.test.ts fixture', timestamp: new Date().toISOString() },
    };

    beforeAll(async () => {
      await publishProof(context.db, context.minio, PROOF_TEST_EPD, certificate);
    });

    it('re-publishing the same certificate is idempotent', async () => {
      const result = await publishProof(context.db, context.minio, PROOF_TEST_EPD, certificate);
      expect(result.alreadyPublished).toBe(true);
    });

    it('lists the published proof with truthStatus flipped to PROVEN', async () => {
      const proofsResponse = await app.inject({ method: 'GET', url: '/v1/proofs?limit=200' });
      expect(proofsResponse.statusCode).toBe(200);
      const { proofs } = proofsResponse.json();
      const published = proofs.find((p: { value: string; status: string }) => p.value === 'win' && p.status === 'published');
      expect(published).toBeDefined();
      expect(published.downloadUrl).toMatch(/^http/);

      const positionResponse = await app.inject({ method: 'GET', url: '/v1/positions/0xaaaaaaaaaaaaaaaa' });
      expect(positionResponse.json().truthStatus).toBe('PROVEN');
    });

    it('every ledger entry recomputes to its stored hash, chained from genesis', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/ledger' });
      expect(response.statusCode).toBe(200);
      const { entries } = response.json();
      expect(entries.length).toBeGreaterThan(0);

      let expectedPrevHash = LEDGER_GENESIS_PREV_HASH;
      for (const entry of entries) {
        expect(entry.prevHash).toBe(expectedPrevHash);
        expect(computeEntryHash(expectedPrevHash, entry.payload)).toBe(entry.entryHash);
        expectedPrevHash = entry.entryHash;
      }
    });

    it('since_seq excludes entries at or before the given seq', async () => {
      const all = (await app.inject({ method: 'GET', url: '/v1/ledger' })).json().entries;
      const lastSeq = all[all.length - 1].seq;
      const response = await app.inject({ method: 'GET', url: `/v1/ledger?since_seq=${lastSeq}` });
      expect(response.json().entries.every((e: { seq: number }) => e.seq > lastSeq)).toBe(true);
    });
  });

  describe('auth', () => {
    it('401s a mutating BFF route with no API key', async () => {
      const response = await app.inject({ method: 'POST', url: '/bff/import', payload: { username: 'anyone' } });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'API key required' });
    });

    it('401s any route when an invalid X-API-Key is presented', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/meta/methodology',
        headers: { 'x-api-key': 'pnb_not_a_real_key' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid api key' });
    });

    it('allows anonymous GETs', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/meta/methodology' });
      expect(response.statusCode).toBe(200);
    });
  });

  // Last on purpose: this burns through the 60/min anonymous per-IP budget
  // shared with every request above (fastify.inject() requests all share
  // one default remote address), so nothing after it in this file could
  // rely on getting a clean 200 anymore.
  describe('rate limiting', () => {
    it('429s once the anonymous per-IP limit is exceeded', async () => {
      const responses = await Promise.all(
        Array.from({ length: 65 }, () => app.inject({ method: 'GET', url: '/v1/meta/methodology' }))
      );
      expect(responses.map((r) => r.statusCode)).toContain(429);
    });
  });
});
