-- Monitor alert claims: the columns behind one alert_history row per (monitor, outage, type, alert number,
-- provider), claimed before sending. The unique index that enforces it is built CONCURRENTLY in 0069, so
-- this transaction stays short. Until 0069 has run the worker's claim cannot be made and it sends unclaimed,
-- as before claims existed. Rows written by workers that predate this migration keep NULL keys.
ALTER TABLE "alert_history" ADD COLUMN "outage_key" uuid;--> statement-breakpoint
ALTER TABLE "alert_history" ADD COLUMN "alert_ordinal" smallint;--> statement-breakpoint
ALTER TABLE "alert_history" ADD COLUMN "claim_attempts" smallint;--> statement-breakpoint
-- Adds the ssl_renewed alert type. NOT VALID (as in 0052) keeps the swap from scanning the table; old rows
-- only use the previous types, so they satisfy the wider list.
-- migration-safety: allow-destructive issue=#852
ALTER TABLE "alert_history" DROP CONSTRAINT IF EXISTS "alert_history_type_check";--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_type_check" CHECK ("alert_history"."type" IN ('monitor_failure', 'monitor_recovery', 'job_failed', 'job_success', 'job_timeout', 'ssl_expiring', 'ssl_renewed')) NOT VALID;
-- monitors.muted_until leaves the Drizzle schema in this release; the column itself is dropped in 0070.
