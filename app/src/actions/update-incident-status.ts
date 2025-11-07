"use server";

import { db } from "@/utils/db";
import {
  incidents,
  incidentUpdates,
  statusPageComponents,
  incidentComponents,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { sendIncidentNotifications } from "./send-incident-notifications";
import { sendWebhookNotifications } from "./send-webhook-notifications";
import { sendSlackNotifications } from "./send-slack-notifications";

const updateIncidentStatusSchema = z.object({
  incidentId: z.string().uuid(),
  statusPageId: z.string().uuid(),
  status: z.enum([
    "investigating",
    "identified",
    "monitoring",
    "resolved",
    "scheduled",
  ]),
  body: z.string().min(1, "Update message is required"),
  deliverNotifications: z.boolean().default(true),
  restoreComponentStatus: z.boolean().default(false), // If true and status is resolved, restore components to operational
});

export type UpdateIncidentStatusData = z.infer<
  typeof updateIncidentStatusSchema
>;

export async function updateIncidentStatus(data: UpdateIncidentStatusData) {
  console.log(
    `Updating incident status with data:`,
    JSON.stringify(data, null, 2)
  );

  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

    // Check status page management permission
    try {
      await requirePermissions(
        {
          status_page: ["update"],
        },
        {
          organizationId,
          projectId: project.id,
        }
      );
    } catch (error) {
      console.warn(
        `User ${userId} attempted to update incident without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to update incidents",
      };
    }

    // Validate the data
    const validatedData = updateIncidentStatusSchema.parse(data);

    try {
      const result = await db.transaction(async (tx) => {
        // Update the incident status
        const [incident] = await tx
          .update(incidents)
          .set({
            status: validatedData.status,
            updatedAt: new Date(),
            ...(validatedData.status === "resolved"
              ? { resolvedAt: new Date() }
              : {}),
            ...(validatedData.status === "monitoring"
              ? { monitoringAt: new Date() }
              : {}),
          })
          .where(eq(incidents.id, validatedData.incidentId))
          .returning();

        // Create incident update
        await tx.insert(incidentUpdates).values({
          incidentId: validatedData.incidentId,
          createdByUserId: userId,
          body: validatedData.body,
          status: validatedData.status,
          deliverNotifications: validatedData.deliverNotifications,
          displayAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // If resolved and restore is true, restore affected components to operational
        if (
          validatedData.status === "resolved" &&
          validatedData.restoreComponentStatus
        ) {
          const affectedComponents = await tx.query.incidentComponents.findMany(
            {
              where: eq(
                incidentComponents.incidentId,
                validatedData.incidentId
              ),
            }
          );

          for (const ic of affectedComponents) {
            await tx
              .update(statusPageComponents)
              .set({
                status: "operational",
                updatedAt: new Date(),
              })
              .where(eq(statusPageComponents.id, ic.componentId));
          }
        }

        return incident;
      });

      console.log(
        `Incident ${result.id} status updated to ${validatedData.status} by user ${userId}`
      );

      // Log the audit event
      await logAuditEvent({
        userId,
        action: "incident_updated",
        resource: "incident",
        resourceId: result.id,
        metadata: {
          organizationId,
          incidentName: result.name,
          newStatus: validatedData.status,
          statusPageId: validatedData.statusPageId,
          projectId: project.id,
          projectName: project.name,
        },
        success: true,
      });

      // Send notifications to subscribers (email, webhooks, and Slack, async, non-blocking)
      if (validatedData.deliverNotifications) {
        // Send email notifications
        sendIncidentNotifications(result.id, validatedData.statusPageId).catch(
          (error) => {
            console.error("Failed to send incident email notifications:", error);
          }
        );

        // Send webhook notifications
        sendWebhookNotifications(result.id, validatedData.statusPageId).catch(
          (error) => {
            console.error("Failed to send incident webhook notifications:", error);
          }
        );

        // Send Slack notifications
        sendSlackNotifications(result.id, validatedData.statusPageId).catch(
          (error) => {
            console.error("Failed to send incident Slack notifications:", error);
          }
        );
      }

      // Revalidate the status page
      revalidatePath(`/status-pages/${validatedData.statusPageId}`);
      revalidatePath(`/status-pages/${validatedData.statusPageId}/public`);

      return {
        success: true,
        message: "Incident updated successfully",
        incident: result,
      };
    } catch (dbError) {
      console.error("Database error:", dbError);
      return {
        success: false,
        message: `Failed to update incident: ${
          dbError instanceof Error ? dbError.message : String(dbError)
        }`,
        error: dbError,
      };
    }
  } catch (validationError) {
    console.error("Validation error:", validationError);
    return {
      success: false,
      message: "Invalid data provided",
      error: validationError,
    };
  }
}
