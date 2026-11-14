ALTER TABLE "monitors" DROP CONSTRAINT "monitors_type_check";--> statement-breakpoint
ALTER TABLE "alert_history" DROP CONSTRAINT "alert_history_type_check";--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "heartbeat_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "heartbeat_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "heartbeat_state" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "monitors_heartbeat_token_hash_uidx" ON "monitors" USING btree ("heartbeat_token_hash") WHERE heartbeat_token_hash IS NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_type_check" CHECK ("monitors"."type" IN ('http_request', 'website', 'ping_host', 'port_check', 'synthetic_test', 'heartbeat'));--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_type_check" CHECK ("alert_history"."type" IN ('monitor_failure', 'monitor_recovery', 'job_failed', 'job_success', 'job_timeout', 'ssl_expiring', 'ssl_renewed', 'monitor_warning'));