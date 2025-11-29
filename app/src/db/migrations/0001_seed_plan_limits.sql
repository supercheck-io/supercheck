-- Seed plan_limits and overage_pricing tables with subscription plans
-- This migration is idempotent and will not fail if plans already exist
-- Runs as part of the migration system for reliability

-- First, ensure the unique constraint exists on plan column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'plan_limits_plan_unique'
        AND conrelid = 'plan_limits'::regclass
    ) THEN
        -- Try to add unique constraint if it doesn't exist
        BEGIN
            ALTER TABLE plan_limits ADD CONSTRAINT plan_limits_plan_unique UNIQUE (plan);
        EXCEPTION WHEN duplicate_object THEN
            -- Constraint exists with different name, that's fine
            NULL;
        END;
    END IF;
END $$;

--> statement-breakpoint

-- Insert Plus plan if not exists
-- Playwright: 3,000 minutes/month (covers light/medium monitoring + test development)
--   - Supports 5-15 monitors @ 10-15 minute intervals (~2,400 min/month)
--   - Plus additional Playwright tests and synthetic checks
-- K6 VU Minutes: 20,000 minutes/month (for light load testing 4-8 tests/month)
--   - K6 protocol-only tests are ~10-20x cheaper to run than browser tests
INSERT INTO "plan_limits" (
  "id", "plan", "max_monitors", "min_check_interval_minutes",
  "playwright_minutes_included", "k6_vu_minutes_included",
  "running_capacity", "queued_capacity", "max_team_members",
  "max_organizations", "max_projects", "max_status_pages",
  "custom_domains", "sso_enabled", "data_retention_days",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), 'plus', 25, 1, 3000, 20000, 5, 50, 5, 2, 10, 3,
  false, false, 30, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM plan_limits WHERE plan = 'plus');

--> statement-breakpoint

-- Insert Pro plan if not exists
-- Playwright: 10,000 minutes/month (covers heavy monitoring + intensive testing)
--   - Supports 25 monitors @ 5 minute intervals (~43,200 min/month overage risk)
--   - OR 10-15 monitors @ 5-min + heavy Playwright test suite development
--   - Designed for production-grade monitoring and continuous testing
-- K6 VU Minutes: 75,000 minutes/month (for regular load testing 8-15 tests/month)
--   - K6 protocol-only tests are ~10-20x cheaper to run than browser tests
INSERT INTO "plan_limits" (
  "id", "plan", "max_monitors", "min_check_interval_minutes",
  "playwright_minutes_included", "k6_vu_minutes_included",
  "running_capacity", "queued_capacity", "max_team_members",
  "max_organizations", "max_projects", "max_status_pages",
  "custom_domains", "sso_enabled", "data_retention_days",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), 'pro', 100, 1, 10000, 75000, 10, 100, 25, 10, 50, 15,
  true, true, 90, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM plan_limits WHERE plan = 'pro');

--> statement-breakpoint

-- Insert Unlimited plan if not exists (for self-hosted)
INSERT INTO "plan_limits" (
  "id", "plan", "max_monitors", "min_check_interval_minutes",
  "playwright_minutes_included", "k6_vu_minutes_included",
  "running_capacity", "queued_capacity", "max_team_members",
  "max_organizations", "max_projects", "max_status_pages",
  "custom_domains", "sso_enabled", "data_retention_days",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), 'unlimited', 999999, 1, 999999, 999999, 999, 9999, 999, 999, 999, 999,
  true, true, 365, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM plan_limits WHERE plan = 'unlimited');

--> statement-breakpoint

-- Seed overage_pricing table with per-unit pricing
-- Playwright: $0.03/minute (Plus) and $0.015/minute (Pro)
--   - Plus $0.03: Fair 3x premium over Azure ($0.01) for integration value (monitoring, status pages)
--   - Pro $0.015: Between Azure Linux ($0.01) and Windows ($0.02), incentivizes upgrade
-- K6: $0.005/VU-minute (Plus) and $0.003/VU-minute (Pro)
--   - Competitive with Grafana k6 Pro ($0.0025/VU-min = $0.15/hour) but with better integration
-- Note: Synthetic monitor checks count as Playwright minutes (handled at execution layer)
--   - Future: Consider separate pricing for synthetic monitors ($0.005-0.01/check)
INSERT INTO "overage_pricing" (
  "id", "plan", "playwright_minute_price_cents", "k6_vu_minute_price_cents",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), 'plus', 3, 0.5, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM overage_pricing WHERE plan = 'plus');

--> statement-breakpoint

INSERT INTO "overage_pricing" (
  "id", "plan", "playwright_minute_price_cents", "k6_vu_minute_price_cents",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), 'pro', 1.5, 0.3, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM overage_pricing WHERE plan = 'pro');
