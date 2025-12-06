/* ================================
   MONITOR AGGREGATES SCHEMA
   -------------------------------
   Pre-computed hourly and daily aggregations for long-term metrics visibility.
   
   Industry Best Practice (based on Checkly, Better Stack):
   - Raw data: Short-term retention (7-30 days)
   - Aggregated data: Long-term retention (30 days - 12+ months)
   
   Benefits:
   - 99%+ storage reduction for historical data
   - Pre-computed P95, avg, uptime eliminates client-side calculation
   - Fast queries for 30d/90d/1yr metrics
=================================== */

import {
  pgTable,
  text,
  integer,
  timestamp,
  uuid,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { monitors } from "./monitor";
import type { MonitoringLocation } from "./types";

/**
 * Aggregation period types
 * - hourly: 60 data points per day, kept for 30 days = 1,800 records/monitor
 * - daily: 1 data point per day, kept for 12+ months = 365+ records/monitor
 */
export type AggregationPeriod = "hourly" | "daily";

/**
 * Pre-computed monitor metrics aggregated by hour or day.
 *
 * Storage comparison (1-minute check interval):
 * - Raw data for 1 year: 525,600 records
 * - Hourly + Daily aggregates: ~10,585 records (98% reduction)
 *
 * Use Cases:
 * - Dashboard metrics (24h/30d/90d uptime, avg response, P95)
 * - Historical trend analysis
 * - SLA reporting
 */
export const monitorAggregates = pgTable(
  "monitor_aggregates",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),

    // Reference to the monitor
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),

    // Aggregation period type
    periodType: text("period_type").$type<AggregationPeriod>().notNull(),

    // Start of the aggregation period (hour or day boundary)
    // For hourly: truncated to hour (e.g., 2024-12-04 14:00:00)
    // For daily: truncated to day (e.g., 2024-12-04 00:00:00)
    periodStart: timestamp("period_start").notNull(),

    // Location for multi-location monitors (null = all locations combined)
    location: text("location").$type<MonitoringLocation | null>(),

    // Check counts
    totalChecks: integer("total_checks").notNull().default(0),
    successfulChecks: integer("successful_checks").notNull().default(0),
    failedChecks: integer("failed_checks").notNull().default(0),

    // Uptime percentage (0.00 to 100.00)
    uptimePercentage: numeric("uptime_percentage", {
      precision: 5,
      scale: 2,
    }).notNull(),

    // Response time metrics in milliseconds
    avgResponseMs: integer("avg_response_ms"),
    minResponseMs: integer("min_response_ms"),
    maxResponseMs: integer("max_response_ms"),
    p50ResponseMs: integer("p50_response_ms"),
    p95ResponseMs: integer("p95_response_ms"),
    p99ResponseMs: integer("p99_response_ms"),

    // Sum of response times (for recalculating averages when merging)
    totalResponseMs: integer("total_response_ms").default(0),

    // Status change count in this period
    statusChangeCount: integer("status_change_count").notNull().default(0),

    // Metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // Primary lookup: monitor + period type + period start + location
    // This is the main query pattern for dashboard metrics
    monitorPeriodIdx: uniqueIndex("monitor_aggregates_unique_idx").on(
      table.monitorId,
      table.periodType,
      table.periodStart,
      table.location
    ),

    // Time-based queries for a specific monitor
    monitorTimeIdx: index("monitor_aggregates_monitor_time_idx").on(
      table.monitorId,
      table.periodStart
    ),

    // Cleanup queries: find old records by period type and time
    periodCleanupIdx: index("monitor_aggregates_cleanup_idx").on(
      table.periodType,
      table.periodStart
    ),
  })
);

// Zod schemas for validation
export const monitorAggregatesInsertSchema =
  createInsertSchema(monitorAggregates);
export const monitorAggregatesSelectSchema =
  createSelectSchema(monitorAggregates);

// Type exports
export type MonitorAggregate = typeof monitorAggregates.$inferSelect;
export type MonitorAggregateInsert = typeof monitorAggregates.$inferInsert;
