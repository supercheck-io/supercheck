"use server";

import { db } from "@/utils/db";
import {
  statusPageComponents,
  statusPageComponentMonitors,
  statusPages,
  monitors,
} from "@/db/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { eq, and, inArray } from "drizzle-orm";

const createComponentSchema = z.object({
  statusPageId: z.string().uuid(),
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name is too long")
    .trim(),
  description: z.string().max(2000, "Description is too long").optional(),
  monitorIds: z.array(z.string().uuid()).optional(),
  status: z
    .enum([
      "operational",
      "degraded_performance",
      "partial_outage",
      "major_outage",
      "under_maintenance",
    ])
    .default("operational"),
  showcase: z.boolean().default(true),
  onlyShowIfDegraded: z.boolean().default(false),
  position: z.number().int().min(0).max(1000).default(0),
  aggregationMethod: z
    .enum(["worst_case", "best_case", "weighted_average", "majority_vote"])
    .default("worst_case"),
  failureThreshold: z.number().int().min(1).max(100).default(1),
});

export type CreateComponentData = z.infer<typeof createComponentSchema>;

export async function createComponent(data: CreateComponentData) {
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
        `[SECURITY] User ${userId} attempted to create component without permission`
      );
      return {
        success: false,
        message: "Insufficient permissions to create components",
      };
    }

    // Validate the data
    const validatedData = createComponentSchema.parse(data);

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
        `[SECURITY] User ${userId} attempted to create component for status page ${validatedData.statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
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

    // Create the component
    const [component] = await db
      .insert(statusPageComponents)
      .values({
        statusPageId: validatedData.statusPageId,
        name: validatedData.name,
        description: validatedData.description || null,
        status: validatedData.status,
        showcase: validatedData.showcase,
        onlyShowIfDegraded: validatedData.onlyShowIfDegraded,
        position: validatedData.position,
        aggregationMethod: validatedData.aggregationMethod,
        failureThreshold: validatedData.failureThreshold,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Create monitor associations in the join table if monitors are selected
    if (validatedData.monitorIds && validatedData.monitorIds.length > 0) {
      await db.insert(statusPageComponentMonitors).values(
        validatedData.monitorIds.map((monitorId) => ({
          componentId: component.id,
          monitorId,
          weight: 1,
          createdAt: new Date(),
        }))
      );
    }

    // Log the audit event
    await logAuditEvent({
      userId,
      action: "component_created",
      resource: "status_page_component",
      resourceId: component.id,
      metadata: {
        organizationId,
        componentName: validatedData.name,
        statusPageId: validatedData.statusPageId,
        projectId: project.id,
        projectName: project.name,
        monitorIds: validatedData.monitorIds,
        aggregationMethod: validatedData.aggregationMethod,
        failureThreshold: validatedData.failureThreshold,
      },
      success: true,
    });

    // Revalidate the status page
    revalidatePath(`/status-pages/${validatedData.statusPageId}`);
    revalidatePath(`/status-pages/${validatedData.statusPageId}/public`);

    return {
      success: true,
      message: "Component created successfully",
      component,
    };
  } catch (error) {
    console.error("Error creating component:", error);

    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: error.errors[0]?.message || "Invalid data provided",
      };
    }

    return {
      success: false,
      message: "Failed to create component. Please try again.",
    };
  }
}
