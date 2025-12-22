/* ================================
   PLAN LIMITS SCHEMA
   -------------------------------
   Configuration table for subscription plan limits
=================================== */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

/**
 * Plan limits configuration for Plus, Pro, and Unlimited tiers
 * Defines quotas and features available for each subscription plan
 */
export const planLimits = pgTable('plan_limits', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),

  // Plan identifier
  plan: text('plan').$type<'plus' | 'pro' | 'unlimited'>().notNull().unique(),

  // Monitor limits
  maxMonitors: integer('max_monitors').notNull(),
  minCheckIntervalMinutes: integer('min_check_interval_minutes').notNull(), // 1 for both plus and pro

  // Execution limits - included quotas
  playwrightMinutesIncluded: integer('playwright_minutes_included').notNull(),
  k6VuMinutesIncluded: integer('k6_vu_minutes_included').notNull(), // Changed from hours to minutes for consistency
  aiCreditsIncluded: integer('ai_credits_included').notNull(), // AI credits for AI fix and AI create features

  // Capacity limits - concurrent and queued
  runningCapacity: integer('running_capacity').notNull(), // concurrent executions
  queuedCapacity: integer('queued_capacity').notNull(), // queued jobs

  // Team and organization limits
  maxTeamMembers: integer('max_team_members').notNull(),
  maxOrganizations: integer('max_organizations').notNull(),
  maxProjects: integer('max_projects').notNull(),
  maxStatusPages: integer('max_status_pages').notNull(),

  // Feature flags
  customDomains: boolean('custom_domains').default(false).notNull(),
  ssoEnabled: boolean('sso_enabled').default(false).notNull(),

  // Data retention - raw check results
  dataRetentionDays: integer('data_retention_days').notNull(),
  // Data retention - aggregated metrics (hourly/daily rollups)
  // Aggregated metrics provide long-term visibility for P95, avg response, uptime
  aggregatedDataRetentionDays: integer('aggregated_data_retention_days')
    .notNull()
    .default(30),
  // Data retention - job runs (execution logs, artifacts, results)
  // Job runs are execution artifacts, not time-series metrics, so they have separate retention
  // Industry standards: GitHub Actions 90d, CircleCI 30d, GitLab 90d
  jobDataRetentionDays: integer('job_data_retention_days')
    .notNull()
    .default(30),

  // Metadata
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Zod schemas for validation
export const planLimitsInsertSchema = createInsertSchema(planLimits);
export const planLimitsSelectSchema = createSelectSchema(planLimits);

// Type exports
export type PlanLimits = typeof planLimits.$inferSelect;
export type PlanLimitsInsert = typeof planLimits.$inferInsert;
