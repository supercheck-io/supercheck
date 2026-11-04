-- Attribute job alerts to a run and make (job, run, provider) claimable once. Not CONCURRENTLY: every
-- existing row has a NULL run_id, so the partial index starts empty, and the worker's ON CONFLICT claim
-- needs it to exist as soon as this deploy lands.
ALTER TABLE "alert_history" ADD COLUMN "run_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_history_job_run_provider_uidx" ON "alert_history" USING btree ("job_id","run_id","provider") WHERE "alert_history"."type" IN ('job_failed', 'job_timeout') AND "alert_history"."run_id" IS NOT NULL;