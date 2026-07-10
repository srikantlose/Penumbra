import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { createContext, apiPort, webOrigin, type ApiContext } from './context.js';
import { createAuthHook } from './plugins/auth.js';
import { registerRateLimit } from './plugins/rateLimit.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerFogRoutes } from './routes/fog.js';
import { registerPositionsRoutes } from './routes/positions.js';
import { registerProofsRoutes } from './routes/proofs.js';
import { registerLedgerRoutes } from './routes/ledger.js';
import { registerBffRoutes } from './routes/bff.js';

export async function buildServer(context: ApiContext): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: !process.env.VITEST }).withTypeProvider<ZodTypeProvider>();

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(cors, { origin: webOrigin() });

  // Order matters: auth must populate request.apiKey before rate-limit
  // picks its bucket key, and both must run before any route handler.
  fastify.addHook('onRequest', createAuthHook(context.db));
  await registerRateLimit(fastify, context.redis);

  await registerMetaRoutes(fastify, context);
  await registerFogRoutes(fastify, context);
  await registerPositionsRoutes(fastify, context);
  await registerProofsRoutes(fastify, context);
  await registerLedgerRoutes(fastify, context);
  await registerBffRoutes(fastify, context);

  return fastify;
}

async function main(): Promise<void> {
  const context = await createContext();
  const fastify = await buildServer(context);
  await fastify.listen({ port: apiPort(), host: '0.0.0.0' });
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error('api failed to start:', err);
    process.exit(1);
  });
}
