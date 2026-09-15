-- Non-unique indexes accelerate existing idempotency checks without changing
-- billing behavior or rejecting historical ledger entries.
CREATE INDEX IF NOT EXISTS "usage_events_execution_run_idx"
ON "usage_events" USING btree ("organization_id", "event_type", ("metadata"->>'runId'))
WHERE ("metadata"->>'runId') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_investigation_run_idx"
ON "usage_events" USING btree ("organization_id", "event_type", ("metadata"->>'investigationRunId'))
WHERE ("metadata"->>'investigationRunId') IS NOT NULL;
