/* ================================
   K6 PERFORMANCE RUNS SCHEMA
   -------------------------------
   Tables for k6 performance test execution results and metrics
=================================== */

import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  integer,
  boolean,
  uuid,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { tests } from "./test";
import { jobs, runs } from "./job";
import { organization, projects } from "./organization";
import type { K6Location, TestRunStatus } from "./types";

/**
 * Stores k6 performance test execution results and detailed metrics
 */
export const k6PerformanceRuns = pgTable("k6_performance_runs", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),

  // Relationships
  testId: uuid("test_id"),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),

  // Execution location (where test actually ran)
  location: varchar("location", { length: 50 })
    .$type<K6Location>()
    .default("GLOBAL"),

  // Status tracking
  status: varchar("status", { length: 20 })
    .$type<TestRunStatus>()
    .notNull(),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),

  // Results (from summary.json)
  summaryJson: jsonb("summary_json"),
  thresholdsPassed: boolean("thresholds_passed"),

  // Quick access metrics (extracted from summary)
  totalRequests: integer("total_requests"),
  failedRequests: integer("failed_requests"),
  requestRate: integer("request_rate"), // stored as req/sec * 100 for precision
  avgResponseTimeMs: integer("avg_response_time_ms"),
  p95ResponseTimeMs: integer("p95_response_time_ms"),
  p99ResponseTimeMs: integer("p99_response_time_ms"),

  // Artifacts (S3 URLs)
  reportS3Url: text("report_s3_url"),
  summaryS3Url: text("summary_s3_url"),
  consoleS3Url: text("console_s3_url"),

  // Error tracking
  errorDetails: text("error_details"),
  consoleOutput: text("console_output"), // Truncated for quick view (full in S3)

  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const k6PerformanceRunsRelations = relations(
  k6PerformanceRuns,
  ({ one }) => ({
    test: one(tests, {
      fields: [k6PerformanceRuns.testId],
      references: [tests.id],
    }),
    job: one(jobs, {
      fields: [k6PerformanceRuns.jobId],
      references: [jobs.id],
    }),
    run: one(runs, {
      fields: [k6PerformanceRuns.runId],
      references: [runs.id],
    }),
    organization: one(organization, {
      fields: [k6PerformanceRuns.organizationId],
      references: [organization.id],
    }),
    project: one(projects, {
      fields: [k6PerformanceRuns.projectId],
      references: [projects.id],
    }),
  })
);

// Zod schemas
export const k6PerformanceRunsInsertSchema =
  createInsertSchema(k6PerformanceRuns);
export const k6PerformanceRunsSelectSchema =
  createSelectSchema(k6PerformanceRuns);

export type K6PerformanceRun = z.infer<typeof k6PerformanceRunsSelectSchema>;
export type K6PerformanceRunInsert = z.infer<
  typeof k6PerformanceRunsInsertSchema
>;
