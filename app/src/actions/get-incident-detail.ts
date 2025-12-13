"use server";

import { db } from "@/utils/db";
import { incidents, incidentUpdates } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { z } from "zod";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid ID format");

/**
 * Get incident details by ID (authenticated, for internal management)
 *
 * SECURITY:
 * - Requires authentication via requireProjectContext
 * - Requires read permission on status_page resource
 * - Verifies ownership via incident's status page org/project
 */
export async function getIncidentDetail(incidentId: string) {
  try {
    // Validate UUID format
    if (!uuidSchema.safeParse(incidentId).success) {
      return {
        success: false,
        message: "Invalid incident ID",
        incident: null,
      };
    }

    // Get current project context (includes auth verification)
    const { organizationId, project } = await requireProjectContext();

    // Check RBAC permissions
    await requirePermissions(
      { status_page: ["view"] },
      { organizationId, projectId: project.id }
    );

    // Get incident with all updates and verify ownership
    const incident = await db.query.incidents.findFirst({
      where: eq(incidents.id, incidentId),
      with: {
        updates: {
          orderBy: [desc(incidentUpdates.createdAt)],
        },
        statusPage: {
          columns: {
            id: true,
            name: true,
            headline: true,
            subdomain: true,
            organizationId: true,
            projectId: true,
          },
        },
      },
    });

    if (!incident) {
      return {
        success: false,
        message: "Incident not found",
        incident: null,
      };
    }

    // SECURITY: Verify ownership - incident's status page must belong to user's org AND project
    if (
      incident.statusPage?.organizationId !== organizationId ||
      incident.statusPage?.projectId !== project.id
    ) {
      return {
        success: false,
        message: "Incident not found or access denied",
        incident: null,
      };
    }

    // Return incident without internal org/project fields from status page
    return {
      success: true,
      incident: {
        ...incident,
        statusPage: {
          id: incident.statusPage.id,
          name: incident.statusPage.name,
          headline: incident.statusPage.headline,
          subdomain: incident.statusPage.subdomain,
        },
      },
    };
  } catch (error) {
    console.error("Error fetching incident detail:", error);
    return {
      success: false,
      message: "Failed to fetch incident details",
      incident: null,
    };
  }
}
