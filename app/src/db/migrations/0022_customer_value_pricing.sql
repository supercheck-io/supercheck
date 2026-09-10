-- Preserve existing usage; fractional minutes apply only to future executions.
ALTER TABLE "organization" ALTER COLUMN "playwright_minutes_used"
  TYPE numeric(14, 4) USING "playwright_minutes_used"::numeric(14, 4);
--> statement-breakpoint
-- Upgrade only the previous stock allowances; preserve custom plan contracts.
UPDATE "plan_limits" SET "sre_investigation_units_included" = 25, "updated_at" = now()
WHERE "plan" = 'plus' AND "sre_investigation_units_included" = 10;
--> statement-breakpoint
UPDATE "plan_limits" SET "sre_investigation_units_included" = 100, "updated_at" = now()
WHERE "plan" = 'pro' AND "sre_investigation_units_included" = 50;
