/* ================================
   JOB SCHEMA
   -------------------------------
   Tables for job definitions, execution runs, and job-test relationships
=================================== */

import {
  integer,
  pgTable,
  text,
  varchar,
  primaryKey,
  timestamp,
  jsonb,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod";
import { organization, projects } from "./organization";
import { user } from "./auth";
import { tests } from "./test";
import type {
  JobType,
  JobStatus,
  JobTrigger,
  TestRunStatus,
  ArtifactPaths,
  AlertConfig,
  K6Location,
} from "./types";

/**
 * Defines scheduled or on-demand jobs that run a collection of tests.
 */
export const jobs = pgTable(
  "jobs",
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
      onDelete: "no action",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    jobType: varchar("job_type", { length: 20 })
      .$type<JobType>()
      .notNull()
      .default("playwright"),
    cronSchedule: varchar("cron_schedule", { length: 100 }),
    status: varchar("status", { length: 50 })
      .$type<JobStatus>()
      .notNull()
      .default("pending"),
    alertConfig: jsonb("alert_config").$type<AlertConfig>(),
    lastRunAt: timestamp("last_run_at"),
    nextRunAt: timestamp("next_run_at"),
    scheduledJobId: varchar("scheduled_job_id", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    // Index on organization_id for listing organization jobs
    organizationIdIdx: index("jobs_organization_id_idx").on(
      table.organizationId
    ),
    // Index on project_id for listing project jobs
    projectIdIdx: index("jobs_project_id_idx").on(table.projectId),
    // Composite index on project_id and status for filtered queries
    projectStatusIdx: index("jobs_project_status_idx").on(
      table.projectId,
      table.status
    ),
    // Index on status for status-based queries
    statusIdx: index("jobs_status_idx").on(table.status),
    // Index on next_run_at for scheduling queries
    nextRunAtIdx: index("jobs_next_run_at_idx").on(table.nextRunAt),
    // Index on created_at for sorting/pagination
    createdAtIdx: index("jobs_created_at_idx").on(table.createdAt),
  })
);

/**
 * A join table linking jobs to the tests they include.
 */
export const jobTests = pgTable(
  "job_tests",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    testId: uuid("test_case_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    orderPosition: integer("order_position"),
  },
  (table) => ({
    pk: primaryKey({
      name: "job_test_cases_pk",
      columns: [table.jobId, table.testId],
    }),
  })
);

/**
 * Records the execution history and results of a job run.
 */
export const runs = pgTable(
  "runs",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    jobId: uuid("job_id").references(() => jobs.id),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    status: varchar("status", { length: 50 })
      .$type<TestRunStatus>()
      .notNull()
      .default("running"),
    duration: varchar("duration", { length: 100 }),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),

    // Artifact URLs (S3 references)
    reportS3Url: text("report_s3_url"),
    logsS3Url: text("logs_s3_url"),
    videoS3Url: text("video_s3_url"),
    screenshotsS3Path: text("screenshots_s3_path"),

    // Legacy artifact paths (for backward compatibility)
    artifactPaths: jsonb("artifact_paths").$type<ArtifactPaths>(),
    logs: text("logs"),

    // Location for k6 tests
    location: varchar("location", { length: 50 }).$type<K6Location>(),

    // Metadata for additional context
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),

    errorDetails: text("error_details"),
    trigger: varchar("trigger", { length: 50 })
      .$type<JobTrigger>()
      .notNull()
      .default("manual"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    // Index on job_id for listing job runs
    jobIdIdx: index("runs_job_id_idx").on(table.jobId),
    // Index on project_id for listing project runs
    projectIdIdx: index("runs_project_id_idx").on(table.projectId),
    // Composite index on job_id and status for filtered queries
    jobStatusIdx: index("runs_job_status_idx").on(table.jobId, table.status),
    // Index on status for status-based queries
    statusIdx: index("runs_status_idx").on(table.status),
    // Index on created_at for sorting/pagination (descending for recent first)
    createdAtIdx: index("runs_created_at_idx").on(table.createdAt),
    // Index on completed_at for completed runs queries
    completedAtIdx: index("runs_completed_at_idx").on(table.completedAt),
    // Composite index on project_id and created_at for sorted project queries
    projectCreatedAtIdx: index("runs_project_created_at_idx").on(
      table.projectId,
      table.createdAt
    ),
  })
);

// Zod schemas for jobs
export const jobsInsertSchema = createInsertSchema(jobs);
export const jobsUpdateSchema = createUpdateSchema(jobs);
export const jobsSelectSchema = createSelectSchema(jobs);

// Zod schemas for runs
export const runsInsertSchema = createInsertSchema(runs);
export const runsSelectSchema = createSelectSchema(runs);
export type Run = z.infer<typeof runsSelectSchema>;
