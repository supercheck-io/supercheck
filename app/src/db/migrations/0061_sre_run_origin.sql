-- supercheck:no-transaction
-- Forward-only. Apply before deploying the app; older app versions ignore the new columns and the index.
-- Runs outside a migration transaction so the scans never hold a write lock on the tables: the check is
-- added NOT VALID then validated (SHARE UPDATE EXCLUSIVE only), and the index is built CONCURRENTLY.
-- Existing runs are all "manual", so the partial unique index cannot conflict with them.
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" ADD COLUMN IF NOT EXISTS "origin" varchar(8) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sre_investigation_runs_origin_check') THEN ALTER TABLE "sre_investigation_runs" ADD CONSTRAINT "sre_investigation_runs_origin_check" CHECK ("sre_investigation_runs"."origin" IN ('auto', 'manual')) NOT VALID; END IF; END $$;--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" VALIDATE CONSTRAINT "sre_investigation_runs_origin_check";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "sre_investigation_runs_auto_incident_unique" ON "sre_investigation_runs" USING btree ("organization_id","project_id","incident_id","agent_type") WHERE "sre_investigation_runs"."origin" = 'auto' AND "sre_investigation_runs"."status" IN ('running', 'completed') AND "sre_investigation_runs"."incident_id" IS NOT NULL;
