"use server";

import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";

export async function checkStatusPagePermission() {
  try {
    const { organizationId, project } = await requireProjectContext();

    // Check if user has permission to update status pages
    await requirePermissions(
      {
        status_page: ["update"],
      },
      {
        organizationId,
        projectId: project.id,
      }
    );

    return {
      success: true,
      canUpdate: true,
    };
  } catch {
    // Permission check failed, user doesn't have update permission
    return {
      success: true,
      canUpdate: false,
    };
  }
}
