-- Forward-only. 0061 is a no-transaction file whose failure is non-fatal (retried next deploy), but the app
-- needs these columns. Repeat them here transactionally so the main run guarantees them; a no-op where 0061
-- already succeeded. The unique index stays in 0061 (CONCURRENTLY).
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" ADD COLUMN IF NOT EXISTS "origin" varchar(8) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sre_investigation_runs_origin_check') THEN ALTER TABLE "sre_investigation_runs" ADD CONSTRAINT "sre_investigation_runs_origin_check" CHECK ("sre_investigation_runs"."origin" IN ('auto', 'manual')) NOT VALID; END IF; END $$;--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" VALIDATE CONSTRAINT "sre_investigation_runs_origin_check";
