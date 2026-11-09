-- Monitor alert claims: one alert_history row per (monitor, outage, type, alert number, provider), claimed
-- before sending. Every existing row has NULL outage_key/alert_ordinal, so the partial unique index starts
-- empty (the build still scans the table once, like 0055's). It is not built CONCURRENTLY because the
-- worker's ON CONFLICT claim needs it as soon as this deploy lands. Rows written by workers that predate
-- this migration keep NULL keys and stay outside the index.
ALTER TABLE "alert_history" ADD COLUMN "outage_key" uuid;--> statement-breakpoint
ALTER TABLE "alert_history" ADD COLUMN "alert_ordinal" smallint;--> statement-breakpoint
ALTER TABLE "alert_history" ADD COLUMN "claim_attempts" smallint;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_history_monitor_claim_uidx" ON "alert_history" USING btree ("monitor_id","outage_key","type","alert_ordinal","provider") WHERE "alert_history"."outage_key" IS NOT NULL AND "alert_history"."alert_ordinal" IS NOT NULL;--> statement-breakpoint
-- Adds the ssl_renewed alert type. NOT VALID (as in 0052) keeps the swap from scanning the table; old rows
-- only use the previous types, so they satisfy the wider list.
-- migration-safety: allow-destructive issue=#999999
ALTER TABLE "alert_history" DROP CONSTRAINT IF EXISTS "alert_history_type_check";--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_type_check" CHECK ("alert_history"."type" IN ('monitor_failure', 'monitor_recovery', 'job_failed', 'job_success', 'job_timeout', 'ssl_expiring', 'ssl_renewed')) NOT VALID;
-- monitors.muted_until is no longer in the Drizzle schema but is NOT dropped here: workers from the previous
-- release still select it. The column drop ships in the next release as a hand-written migration, because the
-- snapshot no longer lists the column and drizzle-kit will not generate it.
