CREATE TABLE "execution_entitlements" (
  "organization_id" uuid PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "running_capacity" integer NOT NULL DEFAULT 1,
  "queued_capacity" integer NOT NULL DEFAULT 10,
  "k6_max_vus" integer NOT NULL DEFAULT 5,
  "playwright_budget_ms" bigint NOT NULL DEFAULT 1800000,
  "playwright_used_ms" bigint NOT NULL DEFAULT 0,
  CONSTRAINT "execution_entitlements_limits_check" CHECK (
    "running_capacity" > 0 AND "queued_capacity" > 0 AND "k6_max_vus" BETWEEN 1 AND 5
    AND "playwright_budget_ms" > 0 AND "playwright_used_ms" >= 0
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
