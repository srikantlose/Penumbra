import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  text,
  json,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// Users
export const users = pgTable(
  'users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    lichessId: varchar('lichess_id', { length: 255 }).unique(),
    lichessUsername: varchar('lichess_username', { length: 255 }),
    chesscomUsername: varchar('chesscom_username', { length: 255 }),
    oauthTokens: text('oauth_tokens'), // JSON, encrypted at rest
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    lichessIdx: uniqueIndex('users_lichess_id_idx').on(table.lichessId),
  })
);

// Games
export const games = pgTable(
  'games',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    source: varchar('source', { length: 50 }).notNull(), // 'lichess', 'chesscom', 'manual'
    sourceGameId: varchar('source_game_id', { length: 255 }),
    white: varchar('white', { length: 255 }),
    black: varchar('black', { length: 255 }),
    result: varchar('result', { length: 10 }), // '1-0', '0-1', '1/2-1/2'
    pgn: text('pgn'),
    importedByUserId: bigint('imported_by_user_id', { mode: 'number' }).references(() => users.id),
    importedAt: timestamp('imported_at').notNull().defaultNow(),
  },
  (table) => ({
    sourceGameIdx: uniqueIndex('games_source_game_id_idx').on(
      table.source,
      table.sourceGameId
    ),
  })
);

// Positions
export const positions = pgTable(
  'positions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    epd: varchar('epd', { length: 256 }).notNull().unique(),
    zobrist: varchar('zobrist', { length: 18 }).notNull(),
    pieceCount: integer('piece_count').notNull(),
    firstSeenGameId: bigint('first_seen_game_id', { mode: 'number' }).references(() => games.id),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    zobristIdx: index('positions_zobrist_idx').on(table.zobrist),
  })
);

// Game positions (move sequence)
export const gamePositions = pgTable(
  'game_positions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameId: bigint('game_id', { mode: 'number' }).notNull().references(() => games.id),
    ply: integer('ply').notNull(),
    positionId: bigint('position_id', { mode: 'number' }).notNull().references(() => positions.id),
    uci: varchar('uci', { length: 5 }),
    san: varchar('san', { length: 20 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    gameIdx: index('game_positions_game_id_idx').on(table.gameId),
    positionIdx: index('game_positions_position_id_idx').on(table.positionId),
  })
);

// Evaluations (append-only)
export const evals = pgTable(
  'evals',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    positionId: bigint('position_id', { mode: 'number' }).notNull().references(() => positions.id),
    engine: varchar('engine', { length: 50 }).notNull(), // 'stockfish', 'lc0'
    engineVersion: varchar('engine_version', { length: 50 }).notNull(),
    netId: varchar('net_id', { length: 100 }),
    nodes: integer('nodes'),
    depth: integer('depth'),
    multiPVRank: integer('multipv_rank'),
    scoreCp: integer('score_cp'),
    scoreMate: integer('score_mate'),
    wdlW: integer('wdl_w'),
    wdlD: integer('wdl_d'),
    wdlL: integer('wdl_l'),
    settings: json('settings'),
    engineFingerprint: varchar('engine_fingerprint', { length: 66 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    positionIdx: index('evals_position_id_idx').on(table.positionId),
    fingerprintIdx: index('evals_fingerprint_idx').on(
      table.positionId,
      table.engineFingerprint
    ),
  })
);

// Fog scores (append-only)
export const fogScores = pgTable(
  'fog_scores',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    positionId: bigint('position_id', { mode: 'number' }).notNull().references(() => positions.id),
    formulaVersion: varchar('formula_version', { length: 20 }).notNull(),
    engineFingerprint: varchar('engine_fingerprint', { length: 66 }).notNull(),
    score: integer('score').notNull(),
    components: json('components').notNull(),
    percentile: integer('percentile'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    positionVersionIdx: uniqueIndex('fog_scores_position_version_idx').on(
      table.positionId,
      table.formulaVersion,
      table.engineFingerprint
    ),
    createdIdx: index('fog_scores_created_idx').on(table.createdAt),
  })
);

// Tablebase probes (cache)
export const tbProbes = pgTable(
  'tb_probes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    positionId: bigint('position_id', { mode: 'number' }).notNull().unique().references(() => positions.id),
    wdlW: integer('wdl_w'),
    wdlD: integer('wdl_d'),
    wdlL: integer('wdl_l'),
    dtz: integer('dtz'),
    source: varchar('source', { length: 50 }), // 'syzygy', 'lichess'
    probedAt: timestamp('probed_at').notNull().defaultNow(),
  }
);

// Proofs
export const proofs = pgTable(
  'proofs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    positionId: bigint('position_id', { mode: 'number' }).notNull().references(() => positions.id),
    claim: json('claim').notNull(),
    value: varchar('value', { length: 20 }).notNull(), // 'win', 'draw'
    bound: varchar('bound', { length: 20 }), // 'at_least_draw', etc.
    status: varchar('status', { length: 20 }).notNull().default('draft'), // 'draft', 'published'
    formatVersion: varchar('format_version', { length: 20 }).notNull(),
    certificateObjectKey: varchar('certificate_object_key', { length: 255 }),
    certificateSha256: varchar('certificate_sha256', { length: 66 }).unique(),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    positionIdx: index('proofs_position_id_idx').on(table.positionId),
    sha256Idx: uniqueIndex('proofs_sha256_idx').on(table.certificateSha256),
  })
);

// Ledger entries (hash-chained, append-only)
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    proofId: bigint('proof_id', { mode: 'number' }).references(() => proofs.id),
    payload: json('payload').notNull(),
    prevHash: varchar('prev_hash', { length: 66 }),
    entryHash: varchar('entry_hash', { length: 66 }).notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    createdIdx: index('ledger_entries_created_idx').on(table.createdAt),
  })
);

// Analyses
export const analyses = pgTable(
  'analyses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameId: bigint('game_id', { mode: 'number' }).notNull().references(() => games.id),
    tier: varchar('tier', { length: 20 }).notNull(), // 'quick', 'deep'
    status: varchar('status', { length: 20 }).notNull(), // 'queued', 'running', 'done'
    fogTimeline: json('fog_timeline'),
    proofEntryPly: integer('proof_entry_ply'),
    missedProofs: json('missed_proofs'),
    engineFingerprint: varchar('engine_fingerprint', { length: 66 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    gameIdx: index('analyses_game_id_idx').on(table.gameId),
  })
);

// API Keys
export const apiKeys = pgTable(
  'api_keys',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id),
    keyHash: varchar('key_hash', { length: 66 }).notNull().unique(),
    name: varchar('name', { length: 255 }),
    quota: integer('quota').notNull().default(1000),
    rateLimit: integer('rate_limit').notNull().default(100), // per minute
    createdAt: timestamp('created_at').notNull().defaultNow(),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => ({
    userIdx: index('api_keys_user_id_idx').on(table.userId),
  })
);
