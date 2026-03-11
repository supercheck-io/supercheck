"use server";

import { db } from "@/utils/db";
import { projectLocations, locations } from "@/db/schema/locations";
import { projects } from "@/db/schema/organization";
import { eq, and, inArray, asc } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { invalidateLocationCache } from "@/lib/location-registry";

type ActionResult<T = undefined> = {
  success: boolean;
  error?: string;
  data?: T;
};

type ProjectLocationEntry = {
  locationId: string;
  code: string;
  name: string;
};

/**
 * Verify the target project belongs to the caller's organization.
 * Org-level roles (owner/admin) can manage any project in their org,
 * not just the one set as their active project.
 */
async function verifyProjectOrgMembership(
  targetProjectId: string,
  organizationId: string
): Promise<boolean> {
  const project = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, targetProjectId),
      eq(projects.organizationId, organizationId)
    ),
    columns: { id: true },
  });
  return !!project;
}

/**
 * Get the location restrictions for a project.
 * Returns empty array if no restrictions (all locations available).
 * Org-level admins can view restrictions for any project in their organization.
 */
export async function getProjectLocationRestrictions(
  projectId: string
): Promise<ActionResult<ProjectLocationEntry[]>> {
  try {
    const context = await requireProjectContext();

    // Verify the target project belongs to the caller's organization
    const isSameOrg = await verifyProjectOrgMembership(
      projectId,
      context.organizationId
    );
    if (!isSameOrg) {
      return { success: false, error: "Access denied" };
    }

    const canView = checkPermissionWithContext("project", "view", context);
    if (!canView) {
      return { success: false, error: "Insufficient permissions" };
    }

    const rows = await db
      .select({
        locationId: projectLocations.locationId,
        code: locations.code,
        name: locations.name,
      })
      .from(projectLocations)
      .innerJoin(locations, eq(projectLocations.locationId, locations.id))
      .where(eq(projectLocations.projectId, projectId))
      .orderBy(asc(locations.sortOrder));

    return { success: true, data: rows };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get restrictions",
    };
  }
}

/**
 * Set location restrictions for a project. Replaces existing restrictions.
 * Pass empty array to remove all restrictions (project gets all enabled locations).
 * Org-level admins can set restrictions for any project in their organization.
 */
export async function setProjectLocationRestrictions(
  projectId: string,
  locationIds: string[]
): Promise<ActionResult> {
  try {
    const context = await requireProjectContext();

    // Verify the target project belongs to the caller's organization
    const isSameOrg = await verifyProjectOrgMembership(
      projectId,
      context.organizationId
    );
    if (!isSameOrg) {
      return { success: false, error: "Access denied" };
    }

    const canUpdate = checkPermissionWithContext("project", "update", context);
    if (!canUpdate) {
      return { success: false, error: "Insufficient permissions to update project settings" };
    }

    // Validate all locations exist and are enabled
    if (locationIds.length > 0) {
      const validLocations = await db
        .select({ id: locations.id })
        .from(locations)
        .where(
          and(
            inArray(locations.id, locationIds),
            eq(locations.isEnabled, true)
          )
        );

      if (validLocations.length !== locationIds.length) {
        return {
          success: false,
          error: "Some locations are invalid or disabled",
        };
      }
    }

    // Replace restrictions in a transaction
    await db.transaction(async (tx) => {
      await tx
        .delete(projectLocations)
        .where(eq(projectLocations.projectId, projectId));

      if (locationIds.length > 0) {
        await tx.insert(projectLocations).values(
          locationIds.map((locationId) => ({
            projectId,
            locationId,
          }))
        );
      }
    });

    invalidateLocationCache();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to set restrictions",
    };
  }
}
