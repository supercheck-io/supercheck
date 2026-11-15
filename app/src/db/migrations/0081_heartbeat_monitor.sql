-- Heartbeat monitor type and the monitor_warning alert type. The two type checks are swapped NOT VALID (as in
-- 0052/0068) so the swap does not scan the tables; old rows only use the previous values, and db-migrate.js
-- validates the constraints after commit. The two indexes cover new columns/rows only (all NULL / no heartbeat
-- monitors yet), so building them is cheap.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- migration-safety: allow-destructive issue=#909
ALTER TABLE "monitors" DROP CONSTRAINT IF EXISTS "monitors_type_check";--> statement-breakpoint
-- migration-safety: allow-destructive issue=#909
ALTER TABLE "alert_history" DROP CONSTRAINT IF EXISTS "alert_history_type_check";--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "heartbeat_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "heartbeat_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "heartbeat_state" jsonb;--> statement-breakpoint
CREATE INDEX "monitors_heartbeat_sweep_idx" ON "monitors" USING btree ("id") WHERE type = 'heartbeat';--> statement-breakpoint
CREATE UNIQUE INDEX "monitors_heartbeat_token_hash_uidx" ON "monitors" USING btree ("heartbeat_token_hash") WHERE heartbeat_token_hash IS NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_type_check" CHECK ("monitors"."type" IN ('http_request', 'website', 'ping_host', 'port_check', 'synthetic_test', 'heartbeat')) NOT VALID;--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_type_check" CHECK ("alert_history"."type" IN ('monitor_failure', 'monitor_recovery', 'job_failed', 'job_success', 'job_timeout', 'ssl_expiring', 'ssl_renewed', 'monitor_warning')) NOT VALID;--> statement-breakpoint
RESET lock_timeout;
