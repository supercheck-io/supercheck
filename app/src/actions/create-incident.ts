"use server";

import { db } from "@/utils/db";
import {
  incidents,
  incidentUpdates,
  statusPageNotificationEvents,
  incidentComponents,
  statusPageComponents,
  statusPages,
  sreIncidents,
} from "@/db/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { eq, and, inArray } from "drizzle-orm";

const createIncidentSchema = z.object({
  sreIncidentId: z.string().uuid().optional(),
  scheduledFor: z.coerce.date().optional(),
  scheduledUntil: z.coerce.date().optional(),
  statusPageId: z.string().uuid(),
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name is too long")
    .trim(),
  status: z
    .enum([
      "investigating",
      "identified",
      "monitoring",
      "resolved",
      "scheduled",
    ])
    .default("investigating"),
  impact: z.enum(["none", "minor", "major", "critical"]).default("minor"),
  body: z.string().max(10000, "Body is too long").optional(),
  affectedComponentIds: z
    .array(z.string().uuid())
    .min(1, "Select at least one affected component"),
  componentStatus: z
    .enum([
      "operational",
      "degraded_performance",
      "partial_outage",
      "major_outage",
      "under_maintenance",
    ])
    .default("partial_outage"),
  deliverNotifications: z.boolean().default(true),
});

export type CreateIncidentData = z.infer<typeof createIncidentSchema>;

export async function createIncident(data: CreateIncidentData) {
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
        `[SECURITY] User ${userId} attempted to create incident without permission`,
      );
      return {
        success: false,
        message: "Insufficient permissions to create incidents",
      };
    }

    // Validate the data
    const validatedData = createIncidentSchema.parse(data);

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
        `[SECURITY] User ${userId} attempted to create incident for status page ${validatedData.statusPageId} without ownership`,
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    if (
      validatedData.status === "scheduled" &&
      (!validatedData.scheduledFor ||
        !validatedData.scheduledUntil ||
        validatedData.scheduledFor >= validatedData.scheduledUntil ||
        validatedData.scheduledUntil <= new Date())
    ) {
      return {
        success: false,
        message: "Choose a future maintenance end after its start.",
      };
    }
    if (validatedData.sreIncidentId) {
      await requirePermissions(
        { sre_incident: ["view"] },
        { organizationId, projectId: project.id },
      );
      const source = await db.query.sreIncidents.findFirst({
        where: and(
          eq(sreIncidents.id, validatedData.sreIncidentId),
          eq(sreIncidents.organizationId, organizationId),
          eq(sreIncidents.projectId, project.id),
        ),
      });
      if (!source)
        return {
          success: false,
          message: "SRE incident not found or access denied",
        };
    }

    if (validatedData.affectedComponentIds.length) {
      const selected = await db
        .select({ id: statusPageComponents.id })
        .from(statusPageComponents)
        .where(
          and(
            eq(statusPageComponents.statusPageId, validatedData.statusPageId),
            inArray(
              statusPageComponents.id,
              validatedData.affectedComponentIds,
            ),
          ),
        );
      if (selected.length !== new Set(validatedData.affectedComponentIds).size)
        return {
          success: false,
          message: "A selected component is not on this status page.",
        };
    }
    // Create the incident and initial update in a transaction
    const result = await db.transaction(async (tx) => {
      await tx
        .select({ id: statusPages.id })
        .from(statusPages)
        .where(eq(statusPages.id, validatedData.statusPageId))
        .for("update");
      if (validatedData.sreIncidentId) {
        const linked = await tx.query.incidents.findFirst({
          where: and(
            eq(incidents.statusPageId, validatedData.statusPageId),
            eq(incidents.sreIncidentId, validatedData.sreIncidentId),
          ),
        });
        if (linked)
          throw new Error(
            "This SRE incident already has a public incident on this page.",
          );
      }
      if (validatedData.sreIncidentId) {
        const [source] = await tx
          .select()
          .from(sreIncidents)
          .where(eq(sreIncidents.id, validatedData.sreIncidentId))
          .for("update");
        if (source.statusPageIncidentId)
          throw new Error(
            "This SRE incident is already linked to a public incident.",
          );
      }
      // Create the incident
      const [incident] = await tx
        .insert(incidents)
        .values({
          statusPageId: validatedData.statusPageId,
          createdByUserId: userId,
          name: validatedData.name,
          sreIncidentId: validatedData.sreIncidentId,
          scheduledFor: validatedData.status === "scheduled" ? validatedData.scheduledFor : null,
          scheduledUntil: validatedData.status === "scheduled" ? validatedData.scheduledUntil : null,
          scheduledRemindPrior: false,
          autoTransitionDeliverNotificationsAtStart: validatedData.deliverNotifications,
          autoTransitionDeliverNotificationsAtEnd: validatedData.deliverNotifications,
          status: validatedData.status,
          impact: validatedData.impact,
          body: validatedData.body || null,
          deliverNotifications: validatedData.deliverNotifications,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (validatedData.sreIncidentId)
        await tx
          .update(sreIncidents)
          .set({ statusPageIncidentId: incident.id, updatedAt: new Date() })
          .where(eq(sreIncidents.id, validatedData.sreIncidentId));
      // Create initial incident update
      const [update] = await tx
        .insert(incidentUpdates)
        .values({
          incidentId: incident.id,
          createdByUserId: userId,
          body: validatedData.body || `Incident created: ${validatedData.name}`,
          status: validatedData.status,
          deliverNotifications: validatedData.deliverNotifications,
          displayAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (validatedData.deliverNotifications) {
        await tx
          .insert(statusPageNotificationEvents)
          .values({
            incidentId: incident.id,
            updateId: update.id,
            isCreation: true,
          });
      }

      // Link affected components and update their status
      if (validatedData.affectedComponentIds.length > 0) {
        for (const componentId of validatedData.affectedComponentIds) {
          // Get current component status - verify it belongs to this status page
          const component = await tx.query.statusPageComponents.findFirst({
            where: and(
              eq(statusPageComponents.id, componentId),
              eq(statusPageComponents.statusPageId, validatedData.statusPageId),
            ),
          });

          if (component) {
            // Create incident-component link
            await tx.insert(incidentComponents).values({
              incidentId: incident.id,
              componentId,
              oldStatus: component.status,
              newStatus:
                validatedData.status === "scheduled"
                  ? "under_maintenance"
                  : validatedData.componentStatus,
              createdAt: new Date(),
            });

            // Future maintenance does not change health at announcement time.
            if (validatedData.status !== "scheduled")
              await tx
                .update(statusPageComponents)
                .set({
                  status: validatedData.componentStatus,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(statusPageComponents.id, componentId),
                    eq(
                      statusPageComponents.statusPageId,
                      validatedData.statusPageId,
                    ),
                  ),
                );
          }
        }
      }

      return incident;
    });

    // Log the audit event
    await logAuditEvent({
      userId,
      action: "incident_created",
      resource: "incident",
      resourceId: result.id,
      metadata: {
        organizationId,
        incidentName: validatedData.name,
        statusPageId: validatedData.statusPageId,
        projectId: project.id,
        projectName: project.name,
        affectedComponents: validatedData.affectedComponentIds.length,
      },
      success: true,
    });

    // Revalidate the status page
    revalidatePath(`/status-pages/${validatedData.statusPageId}`);
    revalidatePath(`/status-pages/${validatedData.statusPageId}/public`);

    return {
      success: true,
      message: "Incident created successfully",
      incident: result,
    };
  } catch (error) {
    console.error("Error creating incident:", error);

    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: error.errors[0]?.message || "Invalid data provided",
      };
    }

    return {
      success: false,
      message: "Failed to create incident. Please try again.",
    };
  }
}
