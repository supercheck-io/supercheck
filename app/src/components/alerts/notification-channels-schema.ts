import { z } from "zod";

// Define the schema for notification channels
export const notificationChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["email", "slack", "webhook", "telegram", "discord", "teams"]),
  config: z.record(z.unknown()),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  lastUsed: z.string().optional(),
});

export type NotificationChannel = z.infer<typeof notificationChannelSchema>; 