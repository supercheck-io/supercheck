import { z } from "zod";

// Define the schema for a test run
export const runSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  jobName: z.string().optional(),
  status: z.enum(["pending", "running", "passed", "failed", "skipped", "error"]),
  duration: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  reportUrl: z.string().nullable().optional(),
  logs: z.string().nullable().optional(),
  errorDetails: z.string().nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  screenshotUrls: z.array(z.string()).optional(),
  timestamp: z.string().optional(),
  testCount: z.number().optional(),
  trigger: z.enum(["manual", "remote", "schedule"]).optional(),
});

export type TestRun = z.infer<typeof runSchema>;
