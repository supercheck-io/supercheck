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
  metadata: z.record(z.unknown()).optional(),
});

export type AlertHistory = z.infer<typeof alertHistorySchema>;
