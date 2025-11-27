-- Seed plan_limits table with Plus, Pro, and Unlimited plans
-- Self-hosted installations get unlimited, cloud users choose Plus or Pro

-- Helper function to generate UUIDv7 (time-sortable) - compatible with existing setup
-- Using gen_random_uuid() as fallback since uuidv7() is from custom extension

INSERT INTO "plan_limits" (
  "id",
  "plan",
  "max_monitors",
  "min_check_interval_minutes",
  "playwright_minutes_included",
  "k6_vu_hours_included",
  "running_capacity",
  "queued_capacity",
  "max_team_members",
  "max_organizations",
  "max_projects",
  "max_status_pages",
  "custom_domains",
  "sso_enabled",
  "data_retention_days",
  "created_at",
  "updated_at"
) VALUES
  -- Plus Plan ($49/month) - For small teams
  (
    gen_random_uuid(),
    'plus',
    25,         -- max_monitors
    1,          -- min_check_interval_minutes (every 1 minute)
    500,        -- playwright_minutes_included (8+ hours)
    100,        -- k6_vu_hours_included
    5,          -- running_capacity (5 concurrent jobs)
    50,         -- queued_capacity
    5,          -- max_team_members
    1,          -- max_organizations (single org per user)
    10,         -- max_projects
    5,          -- max_status_pages
    false,      -- custom_domains
    false,      -- sso_enabled
    30,         -- data_retention_days (1 month)
    NOW(),
    NOW()
  ),
  
  -- Pro Plan ($149/month) - For growing teams
  (
    gen_random_uuid(),
    'pro',
    100,        -- max_monitors
    1,          -- min_check_interval_minutes
    2000,       -- playwright_minutes_included (33+ hours)
    500,        -- k6_vu_hours_included
    10,         -- running_capacity (10 concurrent jobs)
    100,        -- queued_capacity
    20,         -- max_team_members
    3,          -- max_organizations
    50,         -- max_projects
    20,         -- max_status_pages
    true,       -- custom_domains (Pro feature)
    true,       -- sso_enabled (Pro feature)
    90,         -- data_retention_days (3 months)
    NOW(),
    NOW()
  ),
  
  -- Unlimited Plan (Self-hosted only)
  (
    gen_random_uuid(),
    'unlimited',
    999999,     -- max_monitors (effectively unlimited)
    1,          -- min_check_interval_minutes
    999999,     -- playwright_minutes_included
    999999,     -- k6_vu_hours_included
    999,        -- running_capacity (very high limit)
    9999,       -- queued_capacity
    999,        -- max_team_members
    999,        -- max_organizations
    999,        -- max_projects
    999,        -- max_status_pages
    true,       -- custom_domains
    true,       -- sso_enabled
    365,        -- data_retention_days (1 year)
    NOW(),
    NOW()
  )
ON CONFLICT ("plan") DO NOTHING; -- Idempotent: skip if plans already exist
