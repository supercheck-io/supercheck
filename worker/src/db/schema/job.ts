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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from 'drizzle-zod';
import { z } from 'zod';
import { organization, projects } from './organization';
import { user } from './auth';
import { tests } from './test';
import type {
  JobStatus,
  JobTrigger,
  TestRunStatus,
  ArtifactPaths,
  AlertConfig,
} from './types';

/**
 * Defines scheduled or on-demand jobs that run a collection of tests.
 */
export const jobs = pgTable('jobs', {
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
  cronSchedule: varchar('cron_schedule', { length: 100 }),
  status: varchar('status', { length: 50 })
    .$type<JobStatus>()
    .notNull()
    .default('pending'),
  alertConfig: jsonb('alert_config').$type<AlertConfig>(),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),
  scheduledJobId: varchar('scheduled_job_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
});

/**
 * A join table linking jobs to the tests they include.
 */
export const jobTests = pgTable(
  'job_tests',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    testId: uuid('test_case_id')
      .notNull()
      .references(() => tests.id),
    orderPosition: integer('order_position'),
  },
  (table) => ({
    pk: primaryKey({
      name: 'job_test_cases_pk',
      columns: [table.jobId, table.testId],
    }),
  }),
);

/**
 * Records the execution history and results of a job run.
 */
export const runs = pgTable('runs', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id),
  projectId: uuid('project_id').references(() => projects.id, {
    onDelete: 'cascade',
  }),
  status: varchar('status', { length: 50 })
    .$type<TestRunStatus>()
    .notNull()
    .default('running'),
  duration: varchar('duration', { length: 100 }),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  artifactPaths: jsonb('artifact_paths').$type<ArtifactPaths>(),
  logs: text('logs'),
  errorDetails: text('error_details'),
  trigger: varchar('trigger', { length: 50 })
    .$type<JobTrigger>()
    .notNull()
    .default('manual'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Zod schemas for jobs
export const jobsInsertSchema = createInsertSchema(jobs);
export const jobsUpdateSchema = createUpdateSchema(jobs);
export const jobsSelectSchema = createSelectSchema(jobs);

// Zod schemas for runs
export const runsInsertSchema = createInsertSchema(runs);
export const runsSelectSchema = createSelectSchema(runs);
export type Run = z.infer<typeof runsSelectSchema>;
