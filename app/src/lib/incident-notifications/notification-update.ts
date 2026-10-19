import type { incidentUpdates } from "@/db/schema";

export type NotificationUpdate = Pick<
  typeof incidentUpdates.$inferSelect,
  "id" | "body" | "status" | "createdAt" | "deliverNotifications"
>;
