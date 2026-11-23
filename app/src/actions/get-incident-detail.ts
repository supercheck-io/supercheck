"use server";

import { db } from "@/utils/db";
import { incidents, incidentUpdates, statusPages } from "@/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { createLogger } from "@/lib/logger/index";
import { permissionDeniedResult } from "@/lib/deletion/org-state";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { z } from "zod";

// UUID validation schema
const logger = createLogger({ module: "get-incident-detail" }) as { error: (data: unknown, message?: string) => void };
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
    try {
      await requirePermissions(
        { status_page: ["view"] },
        { organizationId, projectId: project.id }
      );
    } catch {
      return {
        ...(await permissionDeniedResult(organizationId, "Insufficient permissions to view incidents")),
        incident: null,
      };
    }

    // Scope to the caller's org and project in the query itself, not after the read.
    const incident = await db.query.incidents.findFirst({
      where: and(
        eq(incidents.id, incidentId),
        inArray(
          incidents.statusPageId,
          db
            .select({ id: statusPages.id })
            .from(statusPages)
            .where(and(eq(statusPages.organizationId, organizationId), eq(statusPages.projectId, project.id))),
        ),
      ),
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

    // Return incident without internal org/project fields from status page
    return {
      success: true,
      incident: {
        ...incident,
        statusPage: {
          id: incident.statusPage!.id,
          name: incident.statusPage!.name,
          headline: incident.statusPage!.headline,
          subdomain: incident.statusPage!.subdomain,
        },
      },
    };
  } catch (error) {
    logger.error({ error }, "Error fetching incident detail");
    return {
      success: false,
      message: "Failed to fetch incident details",
      incident: null,
    };
  }
}
