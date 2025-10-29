import { z } from "zod";

// Job status types
export const jobStatusEnum = z.enum([
  "pending",
  "running",
  "passed",
  "failed",
  "error",
]);

export type JobStatus = z.infer<typeof jobStatusEnum>;

// Job configuration type
export const jobConfigSchema = z.object({
  environment: z.string().optional(),
  variables: z.record(z.string()).optional(),
  retryStrategy: z
    .object({
      maxRetries: z.number(),
      backoffFactor: z.number(),
    })
    .optional(),
});

export type JobConfig = z.infer<typeof jobConfigSchema>;

// Alert configuration schema
export const alertConfigSchema = z.object({
  enabled: z.boolean(),
  notificationProviders: z.array(z.string()),
  alertOnFailure: z.boolean(),
  alertOnSuccess: z.boolean().optional(),
  alertOnTimeout: z.boolean().optional(),
  failureThreshold: z.number(),
  recoveryThreshold: z.number(),
  customMessage: z.string().optional(),
});

export type AlertConfig = z.infer<typeof alertConfigSchema>;

// Tag schema for test tags
export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
});

export type Tag = z.infer<typeof tagSchema>;

// Test schema for tests associated with a job
export const testSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.enum(["browser", "api", "custom", "database"]),
  status: z.enum(["running", "passed", "failed", "error"]).optional(),
  lastRunAt: z.string().nullable().optional(),
  duration: z.number().nullable().optional(), // in milliseconds
  tags: z.array(tagSchema).optional(),
});

export type Test = z.infer<typeof testSchema>;

// Job schema matching the database schema
export const jobSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  cronSchedule: z.string().nullable(),
  status: jobStatusEnum,
  config: jobConfigSchema.optional(),
  retryCount: z.number().optional(),
  timeoutSeconds: z.number().optional(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  tests: z.array(testSchema).optional(),
  alertConfig: alertConfigSchema.optional(),
});

export type Job = z.infer<typeof jobSchema>;

// Legacy task schema (keeping for compatibility)
export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  label: z.string(),
  priority: z.string(),
});

export type Task = z.infer<typeof taskSchema>;
