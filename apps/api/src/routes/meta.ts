import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { FOG_FORMULA_VERSION, FOG_WEIGHTS, FOG_CALIBRATION_V0_1 } from '@penumbra/fog';
import {
  computeFingerprintForTier,
  STOCKFISH_VERSION,
  STOCKFISH_NNUE,
  LC0_VERSION,
  LC0_NETWORK_ID,
  LC0_BACKEND,
  LC0_CANONICAL,
} from '@penumbra/analysis';
import { methodologyResponseSchema } from '../schemas.js';
import type { ApiContext } from '../context.js';

export async function registerMetaRoutes(fastify: FastifyInstance, _context: ApiContext): Promise<void> {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/v1/meta/methodology',
    { schema: { response: { 200: methodologyResponseSchema } } },
    async () => ({
      formulaVersion: FOG_FORMULA_VERSION,
      weights: FOG_WEIGHTS,
      engines: {
        stockfish: { version: STOCKFISH_VERSION, nnue: STOCKFISH_NNUE },
        lc0: { version: LC0_VERSION, network: LC0_NETWORK_ID, backend: LC0_BACKEND, nodes: LC0_CANONICAL.nodes },
      },
      fingerprints: {
        quick: computeFingerprintForTier('quick'),
        canonical: computeFingerprintForTier('canonical'),
      },
      calibration: {
        corpus: 'provisional-placeholder' as const,
        corpusSize: FOG_CALIBRATION_V0_1.corpusSize,
        formulaVersion: FOG_CALIBRATION_V0_1.formulaVersion,
      },
    })
  );
}
