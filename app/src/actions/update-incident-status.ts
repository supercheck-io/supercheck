"use server";

import { db } from "@/utils/db";
import {
  incidents,
  incidentUpdates,
  statusPageComponents,
  incidentComponents,
  statusPages,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
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
  body: z
    .string()
    .min(1, "Update message is required")
    .max(10000, "Update message too long"),
  deliverNotifications: z.boolean().default(true),
  restoreComponentStatus: z.boolean().default(false), // If true and status is resolved, restore components to operational
});

export type UpdateIncidentStatusData = z.infer<
  typeof updateIncidentStatusSchema
>;

export async function updateIncidentStatus(data: UpdateIncidentStatusData) {
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
    } catch {
      console.warn(
        `[SECURITY] User ${userId} attempted to update incident without permission`
      );
      return {
        success: false,
        message: "Insufficient permissions to update incidents",
      };
    }

    // Validate the data
    const validatedData = updateIncidentStatusSchema.parse(data);

    // SECURITY: Verify status page belongs to this organization and project
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, validatedData.statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id)
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to update incident for status page ${validatedData.statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    // Verify incident belongs to this status page
    const existingIncident = await db.query.incidents.findFirst({
      where: and(
        eq(incidents.id, validatedData.incidentId),
        eq(incidents.statusPageId, validatedData.statusPageId)
      ),
    });

    if (!existingIncident) {
      return {
        success: false,
        message: "Incident not found or access denied",
      };
    }

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
        .where(
          and(
            eq(incidents.id, validatedData.incidentId),
            eq(incidents.statusPageId, validatedData.statusPageId)
          )
        )
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
      // SECURITY: Only restore if no other active (non-resolved) incidents affect the same component
      if (
        validatedData.status === "resolved" &&
        validatedData.restoreComponentStatus
      ) {
        const affectedComponents = await tx.query.incidentComponents.findMany({
          where: eq(incidentComponents.incidentId, validatedData.incidentId),
        });

        for (const ic of affectedComponents) {
          // Check if any other active incidents still affect this component
          const otherActiveIncidentComponents =
            await tx.query.incidentComponents.findMany({
              where: eq(incidentComponents.componentId, ic.componentId),
              with: {
                incident: {
                  columns: { id: true, status: true },
                },
              },
            });

          const hasOtherActiveIncidents = otherActiveIncidentComponents.some(
            (aic) =>
              aic.incident &&
              aic.incident.id !== validatedData.incidentId &&
              aic.incident.status !== "resolved"
          );

          if (!hasOtherActiveIncidents) {
            await tx
              .update(statusPageComponents)
              .set({
                status: "operational",
                updatedAt: new Date(),
              })
              .where(eq(statusPageComponents.id, ic.componentId));
          }
        }
      }

      return incident;
    });

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

    // Send notifications to subscribers using after() to ensure
    // background work completes even in serverless/short-lived runtimes
    if (validatedData.deliverNotifications) {
      after(async () => {
        try {
          await Promise.allSettled([
            sendIncidentNotifications(result.id, validatedData.statusPageId),
            sendWebhookNotifications(result.id, validatedData.statusPageId),
            sendSlackNotifications(result.id, validatedData.statusPageId),
          ]);
        } catch (error) {
          console.error("Failed to send incident notifications:", error);
        }
      });
    }

    // Revalidate the status page
    revalidatePath(`/status-pages/${validatedData.statusPageId}`);
    revalidatePath(`/status-pages/${validatedData.statusPageId}/public`);

    return {
      success: true,
      message: "Incident updated successfully",
      incident: result,
    };
  } catch (error) {
    console.error("Error updating incident status:", error);

    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: error.errors[0]?.message || "Invalid data provided",
      };
    }

    return {
      success: false,
      message: "Failed to update incident. Please try again.",
    };
  }
}
