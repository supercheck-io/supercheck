"use server";

import { db } from "@/utils/db";
import {
  incidents,
  incidentUpdates,
  incidentComponents,
  statusPageComponents,
  statusPages,
} from "@/db/schema";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { eq, and } from "drizzle-orm";
import { sendIncidentNotifications } from "./send-incident-notifications";
import { sendWebhookNotifications } from "./send-webhook-notifications";
import { sendSlackNotifications } from "./send-slack-notifications";

const createIncidentSchema = z.object({
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
  affectedComponentIds: z.array(z.string().uuid()).default([]),
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
        }
      );
    } catch {
      console.warn(
        `[SECURITY] User ${userId} attempted to create incident without permission`
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
        eq(statusPages.projectId, project.id)
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to create incident for status page ${validatedData.statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    // Create the incident and initial update in a transaction
    const result = await db.transaction(async (tx) => {
      // Create the incident
      const [incident] = await tx
        .insert(incidents)
        .values({
          statusPageId: validatedData.statusPageId,
          createdByUserId: userId,
          name: validatedData.name,
          status: validatedData.status,
          impact: validatedData.impact,
          body: validatedData.body || null,
          deliverNotifications: validatedData.deliverNotifications,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Create initial incident update
      await tx.insert(incidentUpdates).values({
        incidentId: incident.id,
        createdByUserId: userId,
        body: validatedData.body || `Incident created: ${validatedData.name}`,
        status: validatedData.status,
        deliverNotifications: validatedData.deliverNotifications,
        displayAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Link affected components and update their status
      if (validatedData.affectedComponentIds.length > 0) {
        for (const componentId of validatedData.affectedComponentIds) {
          // Get current component status - verify it belongs to this status page
          const component = await tx.query.statusPageComponents.findFirst({
            where: and(
              eq(statusPageComponents.id, componentId),
              eq(statusPageComponents.statusPageId, validatedData.statusPageId)
            ),
          });

          if (component) {
            // Create incident-component link
            await tx.insert(incidentComponents).values({
              incidentId: incident.id,
              componentId,
              oldStatus: component.status,
              newStatus: validatedData.componentStatus,
              createdAt: new Date(),
            });

            // Update component status
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
                    validatedData.statusPageId
                  )
                )
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
