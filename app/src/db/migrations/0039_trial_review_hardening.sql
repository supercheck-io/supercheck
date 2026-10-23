-- A run keeps the billing tier it was admitted under, so a trial investigation is never billed
-- after the organization subscribes. Existing rows default to paid; the UPDATE below reclassifies any
-- run that an unsubscribed trial organization started during its trial.
ALTER TABLE "sre_investigation_runs" ADD COLUMN "billing_tier" varchar(8) NOT NULL DEFAULT 'paid';
--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" ADD CONSTRAINT "sre_investigation_runs_billing_tier_check" CHECK ("billing_tier" IN ('paid', 'trial'));
--> statement-breakpoint
-- The trial window is stored, so extending expires_at does not move it.
ALTER TABLE "execution_entitlements" ADD COLUMN "trial_started_at" timestamptz;
--> statement-breakpoint
UPDATE "execution_entitlements" SET "trial_started_at" = "expires_at" - interval '14 days' WHERE "trial_started_at" IS NULL;
--> statement-breakpoint
-- Runs started during a trial by an organization that has not subscribed were trial runs: keep them
-- counting toward the trial allowance and out of paid billing if the organization subscribes later.
UPDATE "sre_investigation_runs" AS r SET "billing_tier" = 'trial'
FROM "execution_entitlements" AS e
JOIN "organization" AS o ON o."id" = e."organization_id"
WHERE r."organization_id" = e."organization_id"
  AND r."created_at" >= e."trial_started_at"
  AND NOT (o."polar_customer_id" IS NOT NULL AND o."subscription_plan" IN ('plus', 'pro') AND o."subscription_status" IN ('active', 'past_due', 'canceled'));
--> statement-breakpoint
-- The lifecycle job looks for unexpired-but-ended trials every 15 minutes.
CREATE INDEX "execution_entitlements_open_expiry_idx" ON "execution_entitlements" ("expires_at") WHERE "lifecycle_ended_at" IS NULL;
