-- Seed plan_limits table with Plus, Pro, and Unlimited plans
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
INSERT INTO "plan_limits" (
  "id", "plan", "max_monitors", "min_check_interval_minutes",
  "playwright_minutes_included", "k6_vu_hours_included",
  "running_capacity", "queued_capacity", "max_team_members",
  "max_organizations", "max_projects", "max_status_pages",
  "custom_domains", "sso_enabled", "data_retention_days",
  "created_at", "updated_at"
)
SELECT 
  gen_random_uuid(), 'plus', 25, 1, 500, 100, 5, 50, 5, 1, 10, 5, 
  false, false, 30, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM plan_limits WHERE plan = 'plus');

--> statement-breakpoint

-- Insert Pro plan if not exists
INSERT INTO "plan_limits" (
  "id", "plan", "max_monitors", "min_check_interval_minutes",
  "playwright_minutes_included", "k6_vu_hours_included",
  "running_capacity", "queued_capacity", "max_team_members",
  "max_organizations", "max_projects", "max_status_pages",
  "custom_domains", "sso_enabled", "data_retention_days",
  "created_at", "updated_at"
)
SELECT 
  gen_random_uuid(), 'pro', 100, 1, 2000, 500, 10, 100, 20, 3, 50, 20, 
  true, true, 90, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM plan_limits WHERE plan = 'pro');

--> statement-breakpoint

-- Insert Unlimited plan if not exists (for self-hosted)
INSERT INTO "plan_limits" (
  "id", "plan", "max_monitors", "min_check_interval_minutes",
  "playwright_minutes_included", "k6_vu_hours_included",
  "running_capacity", "queued_capacity", "max_team_members",
  "max_organizations", "max_projects", "max_status_pages",
  "custom_domains", "sso_enabled", "data_retention_days",
  "created_at", "updated_at"
)
SELECT 
  gen_random_uuid(), 'unlimited', 999999, 1, 999999, 999999, 999, 9999, 999, 999, 999, 999, 
  true, true, 365, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM plan_limits WHERE plan = 'unlimited');
