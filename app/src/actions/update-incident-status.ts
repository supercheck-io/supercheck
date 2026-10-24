"use server";

import { db } from "@/utils/db";
import {
  incidents,
  incidentUpdates,
  statusPageNotificationEvents,
  statusPageComponents,
  incidentComponents,
  statusPages,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { incidentScheduleFields } from "@/lib/incident-schedule";

import { updateIncidentStatusSchema, type UpdateIncidentStatusData } from "@/lib/validations/incident-status";

export type { UpdateIncidentStatusData } from "@/lib/validations/incident-status";

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
        },
      );
    } catch {
      console.warn(
        `[SECURITY] User ${userId} attempted to update incident without permission`,
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
        eq(statusPages.projectId, project.id),
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to update incident for status page ${validatedData.statusPageId} without ownership`,
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
        eq(incidents.statusPageId, validatedData.statusPageId),
      ),
    });

    if (!existingIncident) {
      return {
        success: false,
        message: "Incident not found or access denied",
      };
    }

    const result = await db.transaction(async (tx) => {
      // Lock the component before the incident, matching reconciliation order.
      // A manual resolve of an automatically detected incident must not be
      // undone by the next reconciliation tick while the monitor is still down.
      if (
        validatedData.status === "resolved" &&
        existingIncident.sourceComponentId
      ) {
        await tx
          .update(statusPageComponents)
          .set({ autoIncidentSuppressed: true, updatedAt: new Date() })
          .where(
            eq(statusPageComponents.id, existingIncident.sourceComponentId),
          );
      }

      // Update the incident status
      const [incident] = await tx
        .update(incidents)
        .set({
          status: validatedData.status,
          updatedAt: new Date(),
          resolvedAt: validatedData.status === "resolved" ? new Date() : null,
          ...(validatedData.status === "monitoring"
            ? { monitoringAt: new Date() }
            : {}),
          ...incidentScheduleFields(
            validatedData.status,
            validatedData.scheduledFor,
            validatedData.scheduledUntil,
          ),
        })
        .where(
          and(
            eq(incidents.id, validatedData.incidentId),
            eq(incidents.statusPageId, validatedData.statusPageId),
          ),
        )
        .returning();

      // Create incident update
      const [update] = await tx
        .insert(incidentUpdates)
        .values({
          incidentId: validatedData.incidentId,
          createdByUserId: userId,
          body: validatedData.body,
          status: validatedData.status,
          deliverNotifications: validatedData.deliverNotifications,
          displayAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (validatedData.deliverNotifications) {
        await tx.insert(statusPageNotificationEvents).values({ incidentId: incident.id, updateId: update.id });
      }

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
              aic.incident.status !== "resolved",
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

      return { incident, update };
    });

    // Log the audit event
    await logAuditEvent({
      userId,
      action: "incident_updated",
      resource: "incident",
      resourceId: result.incident.id,
      metadata: {
        organizationId,
        incidentName: result.incident.name,
        newStatus: validatedData.status,
        statusPageId: validatedData.statusPageId,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

    // Revalidate the status page
    revalidatePath(`/status-pages/${validatedData.statusPageId}`);
    revalidatePath(`/status-pages/${validatedData.statusPageId}/public`);

    return {
      success: true,
      message: "Incident updated successfully",
      incident: result.incident,
    };
  } catch (error) {
    console.error("Error updating incident status:", error);

    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: error.issues[0]?.message || "Invalid data provided",
      };
    }

    return {
      success: false,
      message: "Failed to update incident. Please try again.",
    };
  }
}
