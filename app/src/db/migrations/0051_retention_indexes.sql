-- Serve the age-based telemetry purge: it filters by the time column alone, which the existing
-- (agent, created_at) / (organization, created_at) indexes cannot do, and expanded outbox events
-- are not covered by the pending-only partial index. Forward-only; re-runnable.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '10min';
--> statement-breakpoint
CREATE INDEX "private_agent_heartbeats_created_at_idx" ON "private_agent_heartbeats" ("created_at");
--> statement-breakpoint
CREATE INDEX "status_page_notification_events_expanded_created_at_idx" ON "status_page_notification_events" ("created_at") WHERE "expanded_at" IS NOT NULL;
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
