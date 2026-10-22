import { z } from "zod";

export const updateIncidentStatusSchema = z
  .object({
    incidentId: z.string().uuid(),
    statusPageId: z.string().uuid(),
    status: z.enum([
      "investigating",
      "identified",
      "monitoring",
      "resolved",
      "scheduled",
    ]),
    body: z
      .string()
      .min(1, "Update message is required")
      .max(10000, "Update message too long"),
    deliverNotifications: z.boolean().default(true),
    restoreComponentStatus: z.boolean().default(false), // If true and status is resolved, restore components to operational
    scheduledFor: z.coerce.date().optional(),
    scheduledUntil: z.coerce.date().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status !== "scheduled") return;
    if (!data.scheduledFor)
      ctx.addIssue({
        code: "custom",
        path: ["scheduledFor"],
        message: "Start time is required for scheduled maintenance",
      });
    if (!data.scheduledUntil)
      ctx.addIssue({
        code: "custom",
        path: ["scheduledUntil"],
        message: "End time is required for scheduled maintenance",
      });
    if (
      data.scheduledFor &&
      data.scheduledUntil &&
      data.scheduledFor >= data.scheduledUntil
    )
      ctx.addIssue({
        code: "custom",
        path: ["scheduledUntil"],
        message: "End time must be after the start time",
      });
    if (data.scheduledUntil && data.scheduledUntil <= new Date())
      ctx.addIssue({
        code: "custom",
        path: ["scheduledUntil"],
        message: "End time must be in the future",
      });
  });

export type UpdateIncidentStatusData = z.infer<
  typeof updateIncidentStatusSchema
>;

