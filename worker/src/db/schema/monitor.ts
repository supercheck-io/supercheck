/* ================================
   MONITOR SCHEMA
   -------------------------------
   Tables for monitoring configurations and results
=================================== */

import {
  integer,
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  uuid,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from 'drizzle-zod';
import { organization, projects } from './organization';
import { user } from './auth';
import type {
  MonitorType,
  MonitorStatus,
  MonitorConfig,
  MonitorResultStatus,
  MonitorResultDetails,
  MonitoringLocation,
  AlertConfig,
} from './types';

/**
 * Defines monitoring configurations for services or endpoints.
 */
export const monitors = pgTable(
  'monitors',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    createdByUserId: uuid('created_by_user_id').references(() => user.id, {
      onDelete: 'no action',
    }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    type: varchar('type', { length: 50 }).$type<MonitorType>().notNull(),
    target: varchar('target', { length: 2048 }).notNull(),
    frequencyMinutes: integer('frequency_minutes').notNull().default(5),
    enabled: boolean('enabled').notNull().default(true),
    status: varchar('status', { length: 50 })
      .$type<MonitorStatus>()
      .notNull()
      .default('pending'),
    config: jsonb('config').$type<MonitorConfig>(),
    alertConfig: jsonb('alert_config').$type<AlertConfig>(),
    lastCheckAt: timestamp('last_check_at'),
    lastStatusChangeAt: timestamp('last_status_change_at'),
    mutedUntil: timestamp('muted_until'),
    scheduledJobId: varchar('scheduled_job_id', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at'),
  },
  (table) => ({
    // PERFORMANCE: Indexes for dashboard monitor queries
    projectOrgIdx: index('monitors_project_org_idx').on(
      table.projectId,
      table.organizationId,
    ),
    projectOrgStatusIdx: index('monitors_project_org_status_idx').on(
      table.projectId,
      table.organizationId,
      table.status,
    ),
  }),
);

/**
 * Stores the results of each monitor check.
 */
export const monitorResults = pgTable(
  'monitor_results',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    checkedAt: timestamp('checked_at').notNull().defaultNow(),
    location: varchar('location', { length: 50 })
      .$type<MonitoringLocation>()
      .notNull()
      .default('eu-central'), // Default location
    status: varchar('status', { length: 50 })
      .$type<MonitorResultStatus>()
      .notNull(),
    responseTimeMs: integer('response_time_ms'),
    details: jsonb('details').$type<MonitorResultDetails>(),
    isUp: boolean('is_up').notNull(),
    isStatusChange: boolean('is_status_change').notNull().default(false),
    consecutiveFailureCount: integer('consecutive_failure_count')
      .notNull()
      .default(0),
    consecutiveSuccessCount: integer('consecutive_success_count')
      .notNull()
      .default(0),
    alertsSentForFailure: integer('alerts_sent_for_failure')
      .notNull()
      .default(0),
    alertsSentForRecovery: integer('alerts_sent_for_recovery')
      .notNull()
      .default(0),
    // For synthetic monitors - store test execution metadata
    testExecutionId: text('test_execution_id'), // Unique execution ID (for accessing reports)
    testReportS3Url: text('test_report_s3_url'), // Full S3 URL to the report
    // PERFORMANCE: First-class column for multi-location aggregation
    // Used by distributed workers to group results from the same execution cycle
    // Replaces JSONB query: (details->>'executionGroupId') = $1
    executionGroupId: text('execution_group_id'),
  },
  (table) => ({
    // PERFORMANCE: Indexes for dashboard monitor queries
    checkedAtIdx: index('monitor_results_checked_at_idx').on(table.checkedAt),
    monitorCheckedIdx: index('monitor_results_monitor_checked_idx').on(
      table.monitorId,
      table.checkedAt,
    ),
    // Composite index for efficient location-based queries
    monitorLocationIdx: index(
      'monitor_results_monitor_location_checked_idx',
    ).on(table.monitorId, table.location, table.checkedAt),
    // PERFORMANCE: Index for multi-location aggregation queries
    // Enables fast lookups by executionGroupId without JSONB parsing
    executionGroupIdx: index('monitor_results_execution_group_idx').on(
      table.monitorId,
      table.executionGroupId,
    ),
  }),
);


// Zod schemas for monitors
export const monitorsInsertSchema = createInsertSchema(monitors);
export const monitorsUpdateSchema = createUpdateSchema(monitors);
export const monitorsSelectSchema = createSelectSchema(monitors);

// Zod schemas for monitor results
export const monitorResultsInsertSchema = createInsertSchema(monitorResults);
export const monitorResultsSelectSchema = createSelectSchema(monitorResults);
