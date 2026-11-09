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
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { z } from "zod";
import { organization, projects } from "./organization";
import { user } from "./auth";
import type {
  MonitorType,
  MonitorStatus,
  MonitorConfig,
  MonitorResultStatus,
  MonitorResultDetails,
  MonitoringLocation,
  AlertConfig,
} from "./types";
import { inValues, MONITOR_TYPE_VALUES, MONITOR_STATUS_VALUES } from "./types";

/**
 * Defines monitoring configurations for services or endpoints.
 */
export const monitors = pgTable(
  "monitors",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    type: varchar("type", { length: 50 }).$type<MonitorType>().notNull(),
    target: varchar("target", { length: 2048 }).notNull(),
    frequencyMinutes: integer("frequency_minutes").notNull().default(5),
    enabled: boolean("enabled").notNull().default(true),
    status: varchar("status", { length: 50 })
      .$type<MonitorStatus>()
      .notNull()
      .default("pending"),
    config: jsonb("config").$type<MonitorConfig>(),
    alertConfig: jsonb("alert_config").$type<AlertConfig>(),
    lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
    lastStatusChangeAt: timestamp("last_status_change_at", { withTimezone: true }),
    scheduledJobId: varchar("scheduled_job_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => ({
    projectOrgStatusIdx: index("monitors_project_org_status_idx").on(
      table.projectId,
      table.organizationId,
      table.status
    ),
    monitorsCreatedByUserIdIdx: index("monitors_created_by_user_id_idx").on(table.createdByUserId),
    monitorsOrganizationIdIdx: index("monitors_organization_id_idx").on(table.organizationId),
    monitorsOrganizationIdRequired: check("monitors_organization_id_required_check", sql`organization_id IS NOT NULL`),
    monitorsProjectIdRequired: check("monitors_project_id_required_check", sql`project_id IS NOT NULL`),
    monitorsTypeCheck: check("monitors_type_check", inValues(table.type, MONITOR_TYPE_VALUES)),
    monitorsStatusCheck: check("monitors_status_check", inValues(table.status, MONITOR_STATUS_VALUES)),
  })
);

/**
 * Stores the results of each monitor check.
 */
export const monitorResults = pgTable(
  "monitor_results",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    location: varchar("location", { length: 50 })
      .$type<MonitoringLocation>()
      .notNull()
      .default("local"), // Default location
    status: varchar("status", { length: 50 })
      .$type<MonitorResultStatus>()
      .notNull(),
    responseTimeMs: integer("response_time_ms"),
    details: jsonb("details").$type<MonitorResultDetails>(),
    isUp: boolean("is_up").notNull(),
    isStatusChange: boolean("is_status_change").notNull().default(false),
    consecutiveFailureCount: integer("consecutive_failure_count")
      .notNull()
      .default(0),
    consecutiveSuccessCount: integer("consecutive_success_count")
      .notNull()
      .default(0),
    alertsSentForFailure: integer("alerts_sent_for_failure")
      .notNull()
      .default(0),
    alertsSentForRecovery: integer("alerts_sent_for_recovery")
      .notNull()
      .default(0),
    // For synthetic monitors - store test execution metadata
    testExecutionId: text("test_execution_id"), // Unique execution ID (for accessing reports)
    testReportS3Url: text("test_report_s3_url"), // Full S3 URL to the report
    // PERFORMANCE: First-class column for multi-location aggregation
    // Used by distributed workers to group results from the same execution cycle
    executionGroupId: text("execution_group_id"),
  },
  (table) => ({
    // Composite index for efficient location-based queries
    monitorLocationIdx: index(
      "monitor_results_monitor_location_checked_idx"
    ).on(table.monitorId, table.location, table.checkedAt),
    // PERFORMANCE: Indexes for dashboard date range queries
    checkedAtIdx: index("monitor_results_checked_at_idx").on(table.checkedAt),
    monitorCheckedIdx: index("monitor_results_monitor_checked_idx").on(
      table.monitorId,
      table.checkedAt
    ),
    // PERFORMANCE: Index for multi-location aggregation queries
    executionGroupIdx: index("monitor_results_execution_group_idx").on(
      table.monitorId,
      table.executionGroupId
    ),
    monitorResultsStatusCheck: check("monitor_results_status_check", sql`${table.status} IN ('up', 'down', 'error', 'timeout')`),
  })
);


// Zod schemas for monitors
export const monitorsInsertSchema = createInsertSchema(monitors, {
  type: z.enum(MONITOR_TYPE_VALUES),
  status: z.enum(MONITOR_STATUS_VALUES).optional(),
});
export const monitorsUpdateSchema = createUpdateSchema(monitors, {
  type: z.enum(MONITOR_TYPE_VALUES).optional(),
  status: z.enum(MONITOR_STATUS_VALUES).optional(),
});
export const monitorsSelectSchema = createSelectSchema(monitors);

// Zod schemas for monitor results
export const monitorResultsInsertSchema = createInsertSchema(monitorResults);
export const monitorResultsSelectSchema = createSelectSchema(monitorResults);
