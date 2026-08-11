CREATE TABLE IF NOT EXISTS "work_units" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fen" text NOT NULL,
	"claim_value" varchar(20) NOT NULL,
	"claim_side" varchar(10) NOT NULL,
	"notes" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"source_game_id" bigint,
	"proved_by_proof_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_units" ADD CONSTRAINT "work_units_source_game_id_games_id_fk" FOREIGN KEY ("source_game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_units" ADD CONSTRAINT "work_units_proved_by_proof_id_proofs_id_fk" FOREIGN KEY ("proved_by_proof_id") REFERENCES "public"."proofs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_units_status_idx" ON "work_units" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_units_fen_claim_idx" ON "work_units" USING btree ("fen","claim_value","claim_side");