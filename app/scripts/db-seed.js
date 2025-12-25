#!/usr/bin/env node

/**
 * Database Seed Script
 *
 * Seeds the database with required initial data:
 * - plan_limits (subscription plans)
 * - overage_pricing (usage-based billing rates)
 *
 * This script is called by db-migrate.js after migrations complete.
 * It's idempotent - safe to run multiple times (uses UPSERT).
 *
 * Usage:
 *   node scripts/db-seed.js
 *   npm run db:seed
 */

const postgres = require("postgres");

// Environment variables with defaults
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = process.env.DB_PORT || "5432";
const DB_USER = process.env.DB_USER || "postgres";
const DB_PASSWORD = process.env.DB_PASSWORD || "postgres";
const DB_NAME = process.env.DB_NAME || "supercheck";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

// Logging functions
function log(message) {
  console.log(`[${new Date().toISOString()}] [SEED] ${message}`);
}

function logSuccess(message) {
  console.log(`[${new Date().toISOString()}] [SUCCESS] ${message}`);
}

function logError(message) {
  console.error(`[${new Date().toISOString()}] [ERROR] ${message}`);
}

/**
 * Plan Limits Seed Data
 * Single source of truth for subscription plans
 *
 * Data Retention Model:
 * - dataRetentionDays: Raw monitor check results (Plus: 7d, Pro: 30d, Unlimited: 365d)
 * - aggregatedDataRetentionDays: Aggregated metrics for monitors (Plus: 30d, Pro: 365d, Unlimited: 730d)
 * - jobDataRetentionDays: Job execution logs/results (Plus: 30d, Pro: 90d, Unlimited: 365d)
 *
 * Industry Standards Reference:
 * - GitHub Actions: 90 days default, up to 400 days for private repos
 * - CircleCI: 30 days max for artifacts
 * - GitLab CI: 30-90 days depending on plan
 */
const PLAN_LIMITS_SEED = [
  {
    plan: "plus",
    maxMonitors: 25,
    minCheckIntervalMinutes: 1,
    playwrightMinutesIncluded: 3000,
    k6VuMinutesIncluded: 20000,
    aiCreditsIncluded: 100,
    runningCapacity: 5,
    queuedCapacity: 50,
    maxTeamMembers: 5,
    maxOrganizations: 2,
    maxProjects: 10,
    maxStatusPages: 3,
    customDomains: true,
    ssoEnabled: true,
    dataRetentionDays: 7,
    aggregatedDataRetentionDays: 30,
    jobDataRetentionDays: 30, // Matches CircleCI
  },
  {
    plan: "pro",
    maxMonitors: 100,
    minCheckIntervalMinutes: 1,
    playwrightMinutesIncluded: 10000,
    k6VuMinutesIncluded: 75000,
    aiCreditsIncluded: 300,
    runningCapacity: 10,
    queuedCapacity: 100,
    maxTeamMembers: 25,
    maxOrganizations: 10,
    maxProjects: 50,
    maxStatusPages: 15,
    customDomains: true,
    ssoEnabled: true,
    dataRetentionDays: 30,
    aggregatedDataRetentionDays: 365,
    jobDataRetentionDays: 90, // Matches GitHub Actions
  },
  {
    plan: "unlimited",
    maxMonitors: 999999,
    minCheckIntervalMinutes: 1,
    playwrightMinutesIncluded: 999999,
    k6VuMinutesIncluded: 999999,
    aiCreditsIncluded: 999999,
    runningCapacity: 999,
    queuedCapacity: 9999,
    maxTeamMembers: 999,
    maxOrganizations: 999,
    maxProjects: 999,
    maxStatusPages: 999,
    customDomains: true,
    ssoEnabled: true,
    dataRetentionDays: 30, // Raw monitor data: 30 days (high frequency, keep lean)
    aggregatedDataRetentionDays: 180, // Aggregated metrics: 6 months max
    jobDataRetentionDays: 180, // Job runs: 6 months max for self-hosted
  },
];

/**
 * Overage Pricing Seed Data
 */
const OVERAGE_PRICING_SEED = [
  {
    plan: "plus",
    playwrightMinutePriceCents: 3,
    k6VuMinutePriceCents: 1,
    aiCreditPriceCents: 5,
  },
  {
    plan: "pro",
    playwrightMinutePriceCents: 2,
    k6VuMinutePriceCents: 1,
    aiCreditPriceCents: 3,
  },
];

/**
 * Seed plan_limits table
 */
async function seedPlanLimits(client) {
  log("Seeding plan_limits table...");

  // Check if table exists
  const tableExists = await client`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'plan_limits'
    );
  `.then((result) => result[0]?.exists);

  if (!tableExists) {
    logError("plan_limits table does not exist. Run migrations first.");
    return false;
  }

  // Ensure unique constraint exists for UPSERT
  try {
    await client`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'plan_limits_plan_unique'
          AND conrelid = 'plan_limits'::regclass
        ) THEN
          ALTER TABLE plan_limits ADD CONSTRAINT plan_limits_plan_unique UNIQUE (plan);
        END IF;
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END $$;
    `;
  } catch (err) {
    // Ignore constraint errors
    if (!err.message.includes("already exists")) {
      log(`Note: ${err.message}`);
    }
  }

  // Upsert each plan
  for (const plan of PLAN_LIMITS_SEED) {
    try {
      await client`
        INSERT INTO plan_limits (
          id, plan, max_monitors, min_check_interval_minutes,
          playwright_minutes_included, k6_vu_minutes_included, ai_credits_included,
          running_capacity, queued_capacity, max_team_members,
          max_organizations, max_projects, max_status_pages,
          custom_domains, sso_enabled, data_retention_days, aggregated_data_retention_days, job_data_retention_days,
          created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), ${plan.plan}, ${plan.maxMonitors}, ${plan.minCheckIntervalMinutes},
          ${plan.playwrightMinutesIncluded}, ${plan.k6VuMinutesIncluded}, ${plan.aiCreditsIncluded},
          ${plan.runningCapacity}, ${plan.queuedCapacity}, ${plan.maxTeamMembers},
          ${plan.maxOrganizations}, ${plan.maxProjects}, ${plan.maxStatusPages},
          ${plan.customDomains}, ${plan.ssoEnabled}, ${plan.dataRetentionDays}, ${plan.aggregatedDataRetentionDays}, ${plan.jobDataRetentionDays},
          NOW(), NOW()
        )
        ON CONFLICT (plan) DO UPDATE SET
          max_monitors = EXCLUDED.max_monitors,
          min_check_interval_minutes = EXCLUDED.min_check_interval_minutes,
          playwright_minutes_included = EXCLUDED.playwright_minutes_included,
          k6_vu_minutes_included = EXCLUDED.k6_vu_minutes_included,
          ai_credits_included = EXCLUDED.ai_credits_included,
          running_capacity = EXCLUDED.running_capacity,
          queued_capacity = EXCLUDED.queued_capacity,
          max_team_members = EXCLUDED.max_team_members,
          max_organizations = EXCLUDED.max_organizations,
          max_projects = EXCLUDED.max_projects,
          max_status_pages = EXCLUDED.max_status_pages,
          custom_domains = EXCLUDED.custom_domains,
          sso_enabled = EXCLUDED.sso_enabled,
          data_retention_days = EXCLUDED.data_retention_days,
          aggregated_data_retention_days = EXCLUDED.aggregated_data_retention_days,
          job_data_retention_days = EXCLUDED.job_data_retention_days,
          updated_at = NOW()
      `;
      log(`Upserted plan: ${plan.plan}`);
    } catch (err) {
      logError(`Failed to upsert plan ${plan.plan}: ${err.message}`);
      return false;
    }
  }

  logSuccess(`Seeded ${PLAN_LIMITS_SEED.length} plans`);
  return true;
}

/**
 * Seed overage_pricing table
 */
async function seedOveragePricing(client) {
  log("Seeding overage_pricing table...");

  // Check if table exists
  const tableExists = await client`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'overage_pricing'
    );
  `.then((result) => result[0]?.exists);

  if (!tableExists) {
    logError("overage_pricing table does not exist. Run migrations first.");
    return false;
  }

  // Ensure unique constraint exists for UPSERT
  try {
    await client`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'overage_pricing_plan_unique'
          AND conrelid = 'overage_pricing'::regclass
        ) THEN
          ALTER TABLE overage_pricing ADD CONSTRAINT overage_pricing_plan_unique UNIQUE (plan);
        END IF;
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END $$;
    `;
  } catch (err) {
    // Ignore constraint errors
    if (!err.message.includes("already exists")) {
      log(`Note: ${err.message}`);
    }
  }

  // Upsert each pricing
  for (const pricing of OVERAGE_PRICING_SEED) {
    try {
      await client`
        INSERT INTO overage_pricing (
          id, plan, playwright_minute_price_cents, k6_vu_minute_price_cents, ai_credit_price_cents,
          created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), ${pricing.plan}, ${pricing.playwrightMinutePriceCents}, 
          ${pricing.k6VuMinutePriceCents}, ${pricing.aiCreditPriceCents},
          NOW(), NOW()
        )
        ON CONFLICT (plan) DO UPDATE SET
          playwright_minute_price_cents = EXCLUDED.playwright_minute_price_cents,
          k6_vu_minute_price_cents = EXCLUDED.k6_vu_minute_price_cents,
          ai_credit_price_cents = EXCLUDED.ai_credit_price_cents,
          updated_at = NOW()
      `;
      log(`Upserted overage pricing: ${pricing.plan}`);
    } catch (err) {
      logError(
        `Failed to upsert overage pricing ${pricing.plan}: ${err.message}`
      );
      return false;
    }
  }

  logSuccess(`Seeded ${OVERAGE_PRICING_SEED.length} overage pricing entries`);
  return true;
}

/**
 * Verify seeding was successful
 */
async function verifySeeding(client) {
  log("Verifying seed data...");

  // Check plan_limits
  const plans =
    await client`SELECT plan, data_retention_days, aggregated_data_retention_days, job_data_retention_days FROM plan_limits ORDER BY plan`;

  if (plans.length !== 3) {
    logError(`Expected 3 plans, found ${plans.length}`);
    return false;
  }

  for (const plan of plans) {
    log(
      `  ${plan.plan}: monitors ${plan.data_retention_days}d raw / ${plan.aggregated_data_retention_days}d metrics, jobs ${plan.job_data_retention_days}d`
    );
  }

  // Check overage_pricing
  const pricing = await client`SELECT plan FROM overage_pricing ORDER BY plan`;

  if (pricing.length !== 2) {
    logError(`Expected 2 overage pricing entries, found ${pricing.length}`);
    return false;
  }

  logSuccess("Seed verification passed");
  return true;
}

/**
 * Main function
 */
async function main() {
  log("Starting database seeding...");
  log(`Database: ${DATABASE_URL.replace(/:[^:@]*@/, ":***@")}`);

  const client = postgres(DATABASE_URL);

  try {
    // Seed plan_limits
    if (!(await seedPlanLimits(client))) {
      await client.end();
      process.exit(1);
    }

    // Seed overage_pricing
    if (!(await seedOveragePricing(client))) {
      await client.end();
      process.exit(1);
    }

    // Verify seeding
    if (!(await verifySeeding(client))) {
      await client.end();
      process.exit(1);
    }

    await client.end();
    logSuccess("Database seeding completed successfully");
    process.exit(0);
  } catch (err) {
    logError(`Seeding error: ${err.message}`);
    await client.end();
    process.exit(1);
  }
}

// Export for use by db-migrate.js
module.exports = {
  main,
  seedPlanLimits,
  seedOveragePricing,
  verifySeeding,
  PLAN_LIMITS_SEED,
  OVERAGE_PRICING_SEED,
};

// Run if called directly
if (require.main === module) {
  main();
}
