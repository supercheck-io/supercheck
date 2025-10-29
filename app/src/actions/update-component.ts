"use server";

import { db } from "@/utils/db";
import {
  statusPageComponents,
  statusPageComponentMonitors,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";

const updateComponentSchema = z.object({
  id: z.string().uuid(),
  statusPageId: z.string().uuid(),
  name: z.string().min(1, "Name is required").max(255).optional(),
  description: z.string().optional().nullable(),
  monitorIds: z
    .array(z.string().uuid())
    .min(1, "At least one monitor is required")
    .optional(),
  status: z
    .enum([
      "operational",
      "degraded_performance",
      "partial_outage",
      "major_outage",
      "under_maintenance",
    ])
    .optional(),
  showcase: z.boolean().optional(),
  onlyShowIfDegraded: z.boolean().optional(),
  position: z.number().int().optional(),
  aggregationMethod: z
    .enum(["worst_case", "best_case", "weighted_average", "majority_vote"])
    .optional(),
  failureThreshold: z.number().int().min(1).optional(),
});

export type UpdateComponentData = z.infer<typeof updateComponentSchema>;

export async function updateComponent(data: UpdateComponentData) {
  console.log(
    `Updating component ${data.id} with data:`,
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
        `User ${userId} attempted to update component without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to update components",
      };
    }

    // Validate the data
    const validatedData = updateComponentSchema.parse(data);

    try {
      // Get existing component for audit trail
      const existingComponent = await db.query.statusPageComponents.findFirst({
        where: eq(statusPageComponents.id, validatedData.id),
      });

      if (!existingComponent) {
        return {
          success: false,
          message: "Component not found",
        };
      }

      // Build update object with only provided fields
      const updateData: Partial<typeof statusPageComponents.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (validatedData.name !== undefined)
        updateData.name = validatedData.name;
      if (validatedData.description !== undefined)
        updateData.description = validatedData.description;
      if (validatedData.status !== undefined)
        updateData.status = validatedData.status;
      if (validatedData.showcase !== undefined)
        updateData.showcase = validatedData.showcase;
      if (validatedData.onlyShowIfDegraded !== undefined)
        updateData.onlyShowIfDegraded = validatedData.onlyShowIfDegraded;
      if (validatedData.position !== undefined)
        updateData.position = validatedData.position;
      if (validatedData.aggregationMethod !== undefined)
        updateData.aggregationMethod = validatedData.aggregationMethod;
      if (validatedData.failureThreshold !== undefined)
        updateData.failureThreshold = validatedData.failureThreshold;

      // Update the component
      const [component] = await db
        .update(statusPageComponents)
        .set(updateData)
        .where(eq(statusPageComponents.id, validatedData.id))
        .returning();

      // Handle monitorIds if provided
      if (validatedData.monitorIds !== undefined) {
        // Delete existing monitor associations
        await db
          .delete(statusPageComponentMonitors)
          .where(eq(statusPageComponentMonitors.componentId, validatedData.id));

        // Create new monitor associations if any
        if (validatedData.monitorIds && validatedData.monitorIds.length > 0) {
          await db.insert(statusPageComponentMonitors).values(
            validatedData.monitorIds.map((monitorId) => ({
              componentId: validatedData.id,
              monitorId,
              weight: 1,
              createdAt: new Date(),
            }))
          );
        }
      }

      console.log(
        `Component ${component.id} updated successfully by user ${userId}`
      );

      // Get the updated component with monitor associations for audit log
      const updatedComponentWithMonitors =
        await db.query.statusPageComponents.findFirst({
          where: eq(statusPageComponents.id, validatedData.id),
          with: {
            monitors: {
              with: {
                monitor: true,
              },
            },
          },
        });

      // Log the audit event
      await logAuditEvent({
        userId,
        action: "component_updated",
        resource: "status_page_component",
        resourceId: component.id,
        metadata: {
          organizationId,
          componentName: component.name,
          statusPageId: validatedData.statusPageId,
          projectId: project.id,
          projectName: project.name,
          changes: {
            before: existingComponent,
            after: updatedComponentWithMonitors || component,
          },
        },
        success: true,
      });

      // Revalidate the status page
      revalidatePath(`/status-pages/${validatedData.statusPageId}`);
      revalidatePath(`/status-pages/${validatedData.statusPageId}/public`);

      return {
        success: true,
        message: "Component updated successfully",
        component,
      };
    } catch (dbError) {
      console.error("Database error:", dbError);
      return {
        success: false,
        message: `Failed to update component: ${
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
