-- Enforce the append-only tables at the database level: evals, fog_scores,
-- and ledger_entries are archaeology/audit trails that must never be
-- updated or deleted, only inserted into. Application code respecting this
-- convention is not a substitute for the database refusing the write.

CREATE OR REPLACE FUNCTION penumbra_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER evals_append_only
  BEFORE UPDATE OR DELETE ON evals
  FOR EACH ROW EXECUTE FUNCTION penumbra_block_mutation();
--> statement-breakpoint

CREATE TRIGGER fog_scores_append_only
  BEFORE UPDATE OR DELETE ON fog_scores
  FOR EACH ROW EXECUTE FUNCTION penumbra_block_mutation();
--> statement-breakpoint

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION penumbra_block_mutation();
