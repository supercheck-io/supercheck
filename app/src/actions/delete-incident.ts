"use server";

import { db } from "@/utils/db";
import { incidents, statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { z } from "zod";

// UUID validation schema
const uuidSchema = z.string().uuid();

export async function deleteIncident(id: string, statusPageId: string) {
  try {
    // Validate UUID formats first
    const idResult = uuidSchema.safeParse(id);
    const statusPageIdResult = uuidSchema.safeParse(statusPageId);

    if (!idResult.success || !statusPageIdResult.success) {
      return {
        success: false,
        message: "Invalid ID format",
      };
    }

    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

    // Check status page management permission
    try {
      await requirePermissions(
        {
          status_page: ["delete"],
        },
        {
          organizationId,
          projectId: project.id,
        }
      );
    } catch {
      console.warn(
        `[SECURITY] User ${userId} attempted to delete incident without permission`
      );
      return {
        success: false,
        message: "Insufficient permissions to delete incidents",
      };
    }

    // SECURITY: Verify status page belongs to this organization and project
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id)
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to delete incident from status page ${statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    // Get incident details before deletion for audit log
    // Verify the incident belongs to this status page
    const incident = await db.query.incidents.findFirst({
      where: and(
        eq(incidents.id, id),
        eq(incidents.statusPageId, statusPageId)
      ),
    });

    if (!incident) {
      return {
        success: false,
        message: "Incident not found or access denied",
      };
    }

    // Delete the incident (cascade will handle related records)
    await db
      .delete(incidents)
      .where(
        and(eq(incidents.id, id), eq(incidents.statusPageId, statusPageId))
      );

    // Log the audit event
    await logAuditEvent({
      userId,
      action: "incident_deleted",
      resource: "incident",
      resourceId: id,
      metadata: {
        organizationId,
        incidentName: incident.name,
        statusPageId,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

    // Revalidate the status page
    revalidatePath(`/status-pages/${statusPageId}`);
    revalidatePath(`/status-pages/${statusPageId}/public`);

    return {
      success: true,
      message: "Incident deleted successfully",
    };
  } catch (error) {
    console.error("Error deleting incident:", error);
    return {
      success: false,
      message: "Failed to delete incident. Please try again.",
    };
  }
}
