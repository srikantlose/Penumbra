CREATE TABLE IF NOT EXISTS "analyses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_id" bigserial NOT NULL,
	"tier" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"fog_timeline" json,
	"proof_entry_ply" integer,
	"missed_proofs" json,
	"engine_fingerprint" varchar(66),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigserial NOT NULL,
	"key_hash" varchar(66) NOT NULL,
	"name" varchar(255),
	"quota" integer DEFAULT 1000 NOT NULL,
	"rate_limit" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"position_id" bigserial NOT NULL,
	"engine" varchar(50) NOT NULL,
	"engine_version" varchar(50) NOT NULL,
	"net_id" varchar(100),
	"nodes" integer,
	"depth" integer,
	"multipv_rank" integer,
	"score_cp" integer,
	"score_mate" integer,
	"wdl_w" integer,
	"wdl_d" integer,
	"wdl_l" integer,
	"settings" json,
	"engine_fingerprint" varchar(66) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fog_scores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"position_id" bigserial NOT NULL,
	"formula_version" varchar(20) NOT NULL,
	"engine_fingerprint" varchar(66) NOT NULL,
	"score" integer NOT NULL,
	"components" json NOT NULL,
	"percentile" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_id" bigserial NOT NULL,
	"ply" integer NOT NULL,
	"position_id" bigserial NOT NULL,
	"uci" varchar(5),
	"san" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "games" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" varchar(50) NOT NULL,
	"source_game_id" varchar(255),
	"white" varchar(255),
	"black" varchar(255),
	"result" varchar(10),
	"pgn" text,
	"imported_by_user_id" bigserial NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_entries" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"proof_id" bigserial NOT NULL,
	"payload" json NOT NULL,
	"prev_hash" varchar(66),
	"entry_hash" varchar(66) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_entry_hash_unique" UNIQUE("entry_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"epd" varchar(256) NOT NULL,
	"zobrist" varchar(18) NOT NULL,
	"piece_count" integer NOT NULL,
	"first_seen_game_id" bigserial NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "positions_epd_unique" UNIQUE("epd")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proofs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"position_id" bigserial NOT NULL,
	"claim" json NOT NULL,
	"value" varchar(20) NOT NULL,
	"bound" varchar(20),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"format_version" varchar(20) NOT NULL,
	"certificate_object_key" varchar(255),
	"certificate_sha256" varchar(66),
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proofs_certificate_sha256_unique" UNIQUE("certificate_sha256")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tb_probes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"position_id" bigserial NOT NULL,
	"wdl_w" integer,
	"wdl_d" integer,
	"wdl_l" integer,
	"dtz" integer,
	"source" varchar(50),
	"probed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tb_probes_position_id_unique" UNIQUE("position_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"lichess_id" varchar(255),
	"lichess_username" varchar(255),
	"chesscom_username" varchar(255),
	"oauth_tokens" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_lichess_id_unique" UNIQUE("lichess_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analyses_game_id_idx" ON "analyses" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evals_position_id_idx" ON "evals" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evals_fingerprint_idx" ON "evals" USING btree ("position_id","engine_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fog_scores_position_version_idx" ON "fog_scores" USING btree ("position_id","formula_version","engine_fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fog_scores_created_idx" ON "fog_scores" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_positions_game_id_idx" ON "game_positions" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_positions_position_id_idx" ON "game_positions" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "games_source_game_id_idx" ON "games" USING btree ("source","source_game_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_created_idx" ON "ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_zobrist_idx" ON "positions" USING btree ("zobrist");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proofs_position_id_idx" ON "proofs" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proofs_sha256_idx" ON "proofs" USING btree ("certificate_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_lichess_id_idx" ON "users" USING btree ("lichess_id");