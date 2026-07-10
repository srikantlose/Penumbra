import { z } from 'zod';

// The response schemas below are the API contract (docs/DEVELOPMENT.md
// §APIs, docs/ROADMAP.md Stage 5 route table) -- kept in this one file so
// the shape of every route is visible at a glance and web's fetch helpers
// (Stage 6) can be typed straight off these.

export const fogComponentsSchema = z.object({
  disagreement: z.number(),
  depthVolatility: z.number(),
  moveCriticality: z.number(),
  tablebaseDistance: z.number(),
  proofGate: z.number(),
});

export const truthStatusSchema = z.enum(['EVALUATED', 'PROVEN']);

export const fogQuerySchema = z.object({
  fen: z.string().min(1),
});

export const fogBatchBodySchema = z.object({
  fens: z.array(z.string().min(1)).min(1).max(100),
});

export const fogReadySchema = z.object({
  score: z.number(),
  components: fogComponentsSchema,
  percentile: z.number().nullable(),
  percentile_provisional: z.literal(true),
  status: truthStatusSchema,
  fingerprint: z.string(),
});

export const fogPendingSchema = z.object({
  status: z.literal('pending'),
  retry_after_ms: z.number(),
});

export const fogResultSchema = z.discriminatedUnion('status', [
  fogReadySchema.extend({ status: truthStatusSchema }),
  fogPendingSchema,
]);

export const fogBatchResponseSchema = z.object({
  results: z.array(
    z.union([
      fogReadySchema.extend({ fen: z.string() }),
      fogPendingSchema.extend({ fen: z.string() }),
    ])
  ),
});

export const zobristParamSchema = z.object({
  zobrist: z.string().min(1),
});

export const evalEntrySchema = z.object({
  engine: z.string(),
  engineVersion: z.string(),
  netId: z.string().nullable(),
  nodes: z.number().nullable(),
  depth: z.number().nullable(),
  multiPvRank: z.number().nullable(),
  scoreCp: z.number().nullable(),
  scoreMate: z.number().nullable(),
  wdl: z.object({ wins: z.number().nullable(), draws: z.number().nullable(), losses: z.number().nullable() }),
  settings: z.unknown(),
  engineFingerprint: z.string(),
  createdAt: z.string(),
});

export const proofRefSchema = z.object({
  id: z.number(),
  value: z.string(),
  bound: z.string().nullable(),
  status: z.string(),
  certificateSha256: z.string().nullable(),
  publishedAt: z.string().nullable(),
});

export const positionResponseSchema = z.object({
  epd: z.string(),
  zobrist: z.string(),
  pieceCount: z.number(),
  provenance: z.object({
    firstSeenGameId: z.number().nullable(),
    occurrenceCount: z.number(),
    createdAt: z.string(),
  }),
  truthStatus: truthStatusSchema,
  fog: fogReadySchema.omit({ percentile_provisional: true }).extend({ percentileProvisional: z.literal(true) }).nullable(),
  evals: z.array(evalEntrySchema),
  proofRefs: z.array(proofRefSchema),
});

export const proofListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const proofIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const proofSummarySchema = z.object({
  id: z.number(),
  positionEpd: z.string(),
  claim: z.unknown(),
  value: z.string(),
  bound: z.string().nullable(),
  status: z.string(),
  formatVersion: z.string(),
  certificateSha256: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const proofListResponseSchema = z.object({
  proofs: z.array(proofSummarySchema),
  total: z.number(),
});

export const ledgerQuerySchema = z.object({
  since_seq: z.coerce.number().int().min(0).default(0),
});

export const ledgerEntrySchema = z.object({
  seq: z.number(),
  proofId: z.number().nullable(),
  payload: z.unknown(),
  prevHash: z.string().nullable(),
  entryHash: z.string(),
  createdAt: z.string(),
});

export const ledgerResponseSchema = z.object({
  entries: z.array(ledgerEntrySchema),
});

export const methodologyResponseSchema = z.object({
  formulaVersion: z.string(),
  weights: z.object({
    disagreement: z.number(),
    depthVolatility: z.number(),
    moveCriticality: z.number(),
    tablebaseDistance: z.number(),
  }),
  engines: z.object({
    stockfish: z.object({ version: z.string(), nnue: z.string() }),
    lc0: z.object({ version: z.string(), network: z.string(), backend: z.string(), nodes: z.number() }),
  }),
  fingerprints: z.object({
    quick: z.string(),
    canonical: z.string(),
  }),
  calibration: z.object({
    corpus: z.literal('provisional-placeholder'),
    corpusSize: z.number(),
    formulaVersion: z.string(),
  }),
});

export const bffStatsResponseSchema = z.object({
  positions: z.number(),
  proofs: z.number(),
  ledgerHeight: z.number(),
  medianFog: z.number().nullable(),
});

export const frontierBandSchema = z.object({
  pieceCount: z.number(),
  positions: z.number(),
  proven: z.number(),
  medianFog: z.number().nullable(),
});

export const bffFrontierResponseSchema = z.object({
  bands: z.array(frontierBandSchema),
});

export const bffImportBodySchema = z.object({
  username: z.string().min(1),
  max: z.coerce.number().int().min(1).max(100).optional(),
});

export const bffImportResponseSchema = z.object({
  username: z.string(),
  imported: z.number(),
  gameIds: z.array(z.number()),
});

export const errorResponseSchema = z.object({
  error: z.string(),
});
