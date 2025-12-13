"use server";

import { db } from "@/utils/db";
import {
  statusPageComponents,
  statusPages,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { z } from "zod";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid status page ID format");

/**
 * Get components for a status page (authenticated, for internal management)
 *
 * SECURITY:
 * - Requires authentication via requireProjectContext
 * - Requires read permission on status_page resource
 * - Verifies ownership (status page belongs to user's org AND project)
 */
export async function getComponents(statusPageId: string) {
  try {
    // Validate input
    if (!statusPageId) {
      return {
        success: false,
        message: "Status page ID is required",
        components: [],
      };
    }

    // Validate UUID format
    const validationResult = uuidSchema.safeParse(statusPageId);
    if (!validationResult.success) {
      return {
        success: false,
        message: "Invalid status page ID",
        components: [],
      };
    }

    // Get current project context (includes auth verification)
    const { organizationId, project } = await requireProjectContext();

    // Check RBAC permissions
    await requirePermissions(
      { status_page: ["view"] },
      { organizationId, projectId: project.id }
    );

    // SECURITY: Verify status page ownership before returning components
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id)
      ),
      columns: { id: true },
    });

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found or access denied",
        components: [],
      };
    }

    // PERFORMANCE FIX: Use Drizzle eager loading instead of N+1 queries
    // Previously: fetched monitors individually per component in a loop
    const components = await db.query.statusPageComponents.findMany({
      where: eq(statusPageComponents.statusPageId, statusPageId),
      orderBy: (components, { asc }) => [
        asc(components.position),
        asc(components.createdAt),
      ],
      with: {
        // Eager load monitor associations with the nested monitor data
        monitors: {
          with: {
            monitor: {
              columns: {
                id: true,
                name: true,
                type: true,
                status: true,
                target: true,
              },
            },
          },
        },
      },
    });

    // Transform the data to the expected format
    const componentsWithMonitors = components.map((component) => {
      const linkedMonitors = component.monitors
        .filter((assoc) => assoc.monitor)
        .map((assoc) => ({
          ...assoc.monitor,
          weight: assoc.weight,
        }));

      return {
        ...component,
        monitors: linkedMonitors,
        monitorIds: linkedMonitors.map((m) => m.id),
      };
    });

    return {
      success: true,
      components: componentsWithMonitors,
    };
  } catch (error) {
    console.error("Error fetching components:", error);
    return {
      success: false,
      message: "Failed to fetch components",
      components: [],
    };
  }
}
