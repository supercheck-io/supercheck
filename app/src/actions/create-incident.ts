"use server";

import { db } from "@/utils/db";
import {
  incidents,
  incidentUpdates,
  incidentComponents,
  statusPageComponents,
} from "@/db/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { eq } from "drizzle-orm";
import { sendIncidentNotifications } from "./send-incident-notifications";
import { sendWebhookNotifications } from "./send-webhook-notifications";
import { sendSlackNotifications } from "./send-slack-notifications";

const createIncidentSchema = z.object({
  statusPageId: z.string().uuid(),
  name: z.string().min(1, "Name is required").max(255),
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
  body: z.string().optional(),
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
  console.log(`Creating incident with data:`, JSON.stringify(data, null, 2));

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
        `User ${userId} attempted to create incident without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to create incidents",
      };
    }

    // Validate the data
    const validatedData = createIncidentSchema.parse(data);

    try {
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
            // Get current component status
            const component = await tx.query.statusPageComponents.findFirst({
              where: eq(statusPageComponents.id, componentId),
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
                .where(eq(statusPageComponents.id, componentId));
            }
          }
        }

        return incident;
      });

      console.log(
        `Incident ${result.id} created successfully by user ${userId}`
      );

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

      // Send notifications to subscribers (email, webhooks, and Slack, async, non-blocking)
      console.log(
        `[Create Incident] deliverNotifications flag: ${validatedData.deliverNotifications}`
      );

      if (validatedData.deliverNotifications) {
        console.log(
          `[Create Incident] Triggering incident notifications for incident ${result.id}`
        );

        // Send email notifications
        sendIncidentNotifications(result.id, validatedData.statusPageId).catch(
          (error) => {
            console.error(
              "Failed to send incident email notifications:",
              error
            );
          }
        );

        // Send webhook notifications
        sendWebhookNotifications(result.id, validatedData.statusPageId).catch(
          (error) => {
            console.error(
              "Failed to send incident webhook notifications:",
              error
            );
          }
        );

        // Send Slack notifications
        sendSlackNotifications(result.id, validatedData.statusPageId).catch(
          (error) => {
            console.error(
              "Failed to send incident Slack notifications:",
              error
            );
          }
        );
      } else {
        console.log(
          `[Create Incident] Skipping notifications for incident ${result.id} - deliverNotifications is false`
        );
      }

      // Revalidate the status page
      revalidatePath(`/status-pages/${validatedData.statusPageId}`);
      revalidatePath(`/status-pages/${validatedData.statusPageId}/public`);

      return {
        success: true,
        message: "Incident created successfully",
        incident: result,
      };
    } catch (dbError) {
      console.error("Database error:", dbError);
      return {
        success: false,
        message: `Failed to create incident: ${
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
