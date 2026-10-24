CREATE TABLE "execution_entitlements" (
  "organization_id" uuid PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "running_capacity" integer NOT NULL DEFAULT 1,
  "queued_capacity" integer NOT NULL DEFAULT 5,
  "k6_max_vus" integer NOT NULL DEFAULT 5,
  "playwright_budget_ms" bigint NOT NULL DEFAULT 1800000,
  "playwright_used_ms" bigint NOT NULL DEFAULT 0,
  "max_monitors" integer NOT NULL DEFAULT 5,
  "min_check_interval_minutes" integer NOT NULL DEFAULT 5,
  "max_status_pages" integer NOT NULL DEFAULT 2,
  "max_status_page_subscribers" integer NOT NULL DEFAULT 50,
  "max_team_members" integer NOT NULL DEFAULT 3,
  "max_projects" integer NOT NULL DEFAULT 3,
  "sre_investigation_units" integer NOT NULL DEFAULT 5,
  "ai_credits" integer NOT NULL DEFAULT 100,
  "lifecycle_ended_at" timestamptz,
  "midway_notified_at" timestamptz,
  "ending_notified_at" timestamptz,
  "ended_notified_at" timestamptz,
  CONSTRAINT "execution_entitlements_limits_check" CHECK (
    "running_capacity" > 0 AND "queued_capacity" > 0 AND "k6_max_vus" BETWEEN 1 AND 5
    AND "playwright_budget_ms" > 0 AND "playwright_used_ms" >= 0
    AND "max_monitors" >= 0 AND "min_check_interval_minutes" >= 1 AND "max_status_pages" >= 0
    AND "max_status_page_subscribers" >= 0 AND "max_team_members" >= 1 AND "max_projects" >= 1
    AND "sre_investigation_units" >= 0 AND "ai_credits" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE "execution_reservations" (
  "run_id" text PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "tier" text NOT NULL,
  "reserved_ms" bigint NOT NULL,
  "used_ms" bigint NOT NULL DEFAULT 0,
  "owner_token" uuid NOT NULL,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "lease_expires_at" timestamptz NOT NULL,
  CONSTRAINT "execution_reservations_values_check" CHECK (
    "kind" IN ('playwright', 'k6') AND "tier" IN ('paid', 'trial') AND "reserved_ms" >= 0 AND "used_ms" >= 0
  )
);
--> statement-breakpoint
CREATE INDEX "execution_reservations_active_idx" ON "execution_reservations" ("organization_id") WHERE "finished_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "execution_reservations_finished_idx" ON "execution_reservations" ("finished_at") WHERE "finished_at" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "execution_target_domains" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "hostname" text NOT NULL,
  "verification_token" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "verified_at" timestamptz,
  "verified_until" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "execution_target_domains_org_host_key" ON "execution_target_domains" ("organization_id", "hostname");
--> statement-breakpoint
-- Resources paused or archived when a trial ends, so they can be restored on subscription.
CREATE TABLE "trial_suspensions" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "resource_type" text NOT NULL,
  "resource_id" uuid NOT NULL,
  "previous_status" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "trial_suspensions_type_check" CHECK ("resource_type" IN ('monitor', 'status_page'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trial_suspensions_resource_key" ON "trial_suspensions" ("resource_type", "resource_id");
--> statement-breakpoint
CREATE INDEX "trial_suspensions_org_idx" ON "trial_suspensions" ("organization_id");
