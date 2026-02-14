"use server";

import { db } from "@/utils/db";
import {
  statusPageComponents,
  statusPageComponentMonitors,
  statusPages,
  monitors,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { statusAggregationService } from "@/lib/status-aggregation.service";

const updateComponentSchema = z.object({
  id: z.string().uuid(),
  statusPageId: z.string().uuid(),
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name is too long")
    .trim()
    .optional(),
  description: z
    .string()
    .max(2000, "Description is too long")
    .optional()
    .nullable(),
  monitorIds: z.array(z.string().uuid()).optional(),
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
  position: z.number().int().min(0).max(1000).optional(),
  aggregationMethod: z
    .enum(["worst_case", "best_case", "weighted_average", "majority_vote"])
    .optional(),
  failureThreshold: z.number().int().min(1).max(100).optional(),
});

export type UpdateComponentData = z.infer<typeof updateComponentSchema>;

export async function updateComponent(data: UpdateComponentData) {
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
        `[SECURITY] User ${userId} attempted to update component without permission`
      );
      return {
        success: false,
        message: "Insufficient permissions to update components",
      };
    }

    // Validate the data
    const validatedData = updateComponentSchema.parse(data);

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
        `[SECURITY] User ${userId} attempted to update component for status page ${validatedData.statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    // Get existing component and verify it belongs to this status page
    const existingComponent = await db.query.statusPageComponents.findFirst({
      where: and(
        eq(statusPageComponents.id, validatedData.id),
        eq(statusPageComponents.statusPageId, validatedData.statusPageId)
      ),
    });

    if (!existingComponent) {
      return {
        success: false,
        message: "Component not found or access denied",
      };
    }

    // SECURITY: Verify all monitors belong to this project if provided
    if (validatedData.monitorIds && validatedData.monitorIds.length > 0) {
      const validMonitors = await db
        .select({ id: monitors.id })
        .from(monitors)
        .where(
          and(
            inArray(monitors.id, validatedData.monitorIds),
            eq(monitors.projectId, project.id)
          )
        );

      if (validMonitors.length !== validatedData.monitorIds.length) {
        return {
          success: false,
          message: "One or more monitors not found or access denied",
        };
      }
    }

    // Build update object with only provided fields
    const updateData: Partial<typeof statusPageComponents.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (validatedData.name !== undefined) updateData.name = validatedData.name;
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
      .where(
        and(
          eq(statusPageComponents.id, validatedData.id),
          eq(statusPageComponents.statusPageId, validatedData.statusPageId)
        )
      )
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

        // Preserve explicit manual status updates; only aggregate when status not provided
        if (validatedData.status === undefined) {
          await statusAggregationService.updateComponentStatus(validatedData.id);
        }
      }
    }

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
  } catch (error) {
    console.error("Error updating component:", error);

    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: error.errors[0]?.message || "Invalid data provided",
      };
    }

    return {
      success: false,
      message: "Failed to update component. Please try again.",
    };
  }
}
