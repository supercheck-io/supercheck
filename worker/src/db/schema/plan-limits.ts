/* ================================
   PLAN LIMITS SCHEMA
   -------------------------------
   Configuration table for subscription plan limits
   
   Data Retention Model (industry standard - Checkly-inspired):
   - dataRetentionDays: Raw data retention (Plus: 7d, Pro: 30d, Unlimited: 365d)
   - aggregatedDataRetentionDays: Aggregated metrics retention (Plus: 30d, Pro: 365d, Unlimited: 730d)
   - jobDataRetentionDays: Job runs retention (Plus: 30d, Pro: 90d, Unlimited: 365d)
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

  // Data retention (raw data - short-term)
  // Plus: 7 days, Pro: 30 days, Unlimited: 365 days
  dataRetentionDays: integer('data_retention_days').notNull(),

  // Aggregated data retention (metrics - long-term)
  // Plus: 30 days, Pro: 365 days (1yr), Unlimited: 730 days (2yr)
  aggregatedDataRetentionDays: integer(
    'aggregated_data_retention_days',
  ).notNull(),

  // Job data retention (execution logs, artifacts, results)
  // Plus: 30 days, Pro: 90 days, Unlimited: 365 days
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
