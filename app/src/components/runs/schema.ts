import { z } from "zod";

// Define the schema for a test run
export const runSchema = z.object({
  triggeredByName: z.string().nullable().optional(),
  triggeredByImage: z.string().nullable().optional(),
  triggerKeyName: z.string().nullable().optional(),
  id: z.string(),
  jobId: z.string(),
  jobName: z.string().optional(),
  jobType: z.enum(["playwright", "k6"]).optional(),
  status: z.enum(["pending", "queued", "running", "passed", "failed", "skipped", "error"]),
  duration: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  reportUrl: z.string().nullable().optional(),
  logs: z.string().nullable().optional(),
  errorDetails: z.string().nullable().optional(),
  cancelled: z.boolean().nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  screenshotUrls: z.array(z.string()).optional(),
  timestamp: z.string().optional(),
  testCount: z.number().optional(),
  trigger: z.enum(["manual", "remote", "schedule"]).optional(),
  location: z.string().nullable().optional(),
});

export type TestRun = z.infer<typeof runSchema>;
