-- Exact response-sample count and a per-day response-time histogram, so a window reports a real p95 and exact
-- counts. Both nullable: rows written before this migration (or by an older app) keep working.
ALTER TABLE "monitor_aggregates" ADD COLUMN IF NOT EXISTS "response_sample_count" integer;--> statement-breakpoint
ALTER TABLE "monitor_aggregates" ADD COLUMN IF NOT EXISTS "response_histogram" jsonb;
