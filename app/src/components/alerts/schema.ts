import { z } from "zod";

// Define the schema for alert history
export const alertHistorySchema = z.object({
  id: z.string(),
  targetType: z.enum(["monitor", "job"]),
  targetId: z.string(),
  targetName: z.string(),
  type: z.string(),
  message: z.string(),
  status: z.enum(["sent", "failed", "pending"]),
  timestamp: z.string(),
  notificationProvider: z.string(),
  metadata: z
    .object({
      errorMessage: z.string().nullable().optional(),
      provider: z.record(z.unknown()).optional(),
      correlation: z.record(z.unknown()).optional(),
      delivery: z.record(z.unknown()).optional(),
    })
    .catchall(z.unknown())
    .optional(),
});

export type AlertHistory = z.infer<typeof alertHistorySchema>;
