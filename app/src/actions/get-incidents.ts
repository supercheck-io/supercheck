"use server";

import { db } from "@/utils/db";
import { incidents, statusPages } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { z } from "zod";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid status page ID format");

/**
 * Get incidents for a status page (authenticated, for internal management)
 *
 * SECURITY:
 * - Requires authentication via requireProjectContext
 * - Requires read permission on status_page resource
 * - Verifies ownership (status page belongs to user's org AND project)
 */
export async function getIncidents(statusPageId: string) {
  try {
    // Validate UUID format
    const validationResult = uuidSchema.safeParse(statusPageId);
    if (!validationResult.success) {
      return {
        success: false,
        message: "Invalid status page ID",
        incidents: [],
      };
    }

    // Get current project context (includes auth verification)
    const { organizationId, project } = await requireProjectContext();

    // Check RBAC permissions
    await requirePermissions(
      { status_page: ["view"] },
      { organizationId, projectId: project.id }
    );

    // SECURITY: Verify status page ownership
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
        incidents: [],
      };
    }

    // PERFORMANCE FIX: Use Drizzle eager loading instead of N+1 queries
    // Previously: fetched components and updates individually per incident in a loop
    const incidentsList = await db.query.incidents.findMany({
      where: eq(incidents.statusPageId, statusPageId),
      orderBy: [desc(incidents.createdAt)],
      with: {
        // Eager load affected components
        affectedComponents: {
          with: {
            component: {
              columns: {
                id: true,
                name: true,
              },
            },
          },
        },
        // Eager load updates (we'll pick the latest one)
        updates: {
          orderBy: (updates, { desc }) => [desc(updates.createdAt)],
          limit: 1, // Only need the latest update
        },
      },
    });

    // Transform to expected format
    const incidentsWithDetails = incidentsList.map((incident) => ({
      ...incident,
      affectedComponentsCount: incident.affectedComponents.length,
      affectedComponents: incident.affectedComponents.map((ic) => ic.component),
      latestUpdate: incident.updates[0] || null,
    }));

    return {
      success: true,
      incidents: incidentsWithDetails,
    };
  } catch (error) {
    console.error("Error fetching incidents:", error);
    return {
      success: false,
      message: "Failed to fetch incidents",
      incidents: [],
    };
  }
}
