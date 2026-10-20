-- Durable monitor check cycles for missing-region closure (issue #452).
-- Additive only: nothing reads these tables unless MISSING_CYCLE_CLOSURE_ENABLED is on.
-- The cycle id is also the executionGroupId on monitor_results, so the hot results
-- table needs no new column or index.
CREATE TABLE IF NOT EXISTS "monitor_cycles" (
  "id" text PRIMARY KEY,
  "monitor_id" uuid NOT NULL REFERENCES "monitors"("id") ON DELETE CASCADE,
  "mode" text NOT NULL DEFAULT 'control_plane',
  "scheduled_for" timestamp NOT NULL,
  "deadline_at" timestamp NOT NULL,
  "expected_locations" jsonb NOT NULL,
  "strategy" text NOT NULL,
  "threshold" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "closed_at" timestamp,
  "closed_by" text,
  "result_status" text,
  "observed_locations" jsonb,
  "missing_locations" jsonb,
  "notified_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "monitor_cycles_status_check" CHECK ("status" IN ('open', 'closed', 'aborted')),
  CONSTRAINT "monitor_cycles_mode_check" CHECK ("mode" IN ('control_plane')),
  CONSTRAINT "monitor_cycles_closed_by_check" CHECK ("closed_by" IS NULL OR "closed_by" IN ('arrival', 'deadline')),
  CONSTRAINT "monitor_cycles_result_status_check" CHECK ("result_status" IS NULL OR "result_status" IN ('up', 'down'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitor_cycles_monitor_idx" ON "monitor_cycles" ("monitor_id", "scheduled_for" DESC);
--> statement-breakpoint
-- The control plane polls only open cycles that passed their deadline.
CREATE INDEX IF NOT EXISTS "monitor_cycles_open_deadline_idx" ON "monitor_cycles" ("deadline_at") WHERE "status" = 'open';
--> statement-breakpoint
-- Bounded retention sweeps: finished cycles ordered by closure time.
CREATE INDEX IF NOT EXISTS "monitor_cycles_retention_idx" ON "monitor_cycles" ("closed_at") WHERE "closed_at" IS NOT NULL;
--> statement-breakpoint
-- Closed cycles whose notification receipt is still outstanding (crash repair).
CREATE INDEX IF NOT EXISTS "monitor_cycles_notify_pending_idx" ON "monitor_cycles" ("closed_at") WHERE "status" = 'closed' AND "notified_at" IS NULL;
--> statement-breakpoint
-- Wake-up hints written after a regional result is saved. The control plane evaluates from
-- monitor_results, so a lost hint only delays closure to the deadline.
CREATE TABLE IF NOT EXISTS "monitor_cycle_arrivals" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "cycle_id" text NOT NULL REFERENCES "monitor_cycles"("id") ON DELETE CASCADE,
  "location" text NOT NULL,
  "processed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "monitor_cycle_arrivals_cycle_location_idx" ON "monitor_cycle_arrivals" ("cycle_id", "location");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitor_cycle_arrivals_pending_idx" ON "monitor_cycle_arrivals" ("created_at") WHERE "processed_at" IS NULL;
