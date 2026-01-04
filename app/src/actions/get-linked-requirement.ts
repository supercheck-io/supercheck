"use server";

import { db } from "@/utils/db";
import { requirements, testRequirements, tests } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";

/**
 * Fetches the requirement linked to a specific test
 * @param testId The test ID to check for links
 * @returns The linked requirement details or null if no link exists
 */
export async function getLinkedTestRequirement(testId: string) {
  try {
    // RBAC: Require project context and permission check
    const { project, organizationId } = await requireProjectContext();

    const canView = await hasPermission("requirement", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
      console.warn(`User does not have permission to view requirements`);
      return null;
    }

    // First verify the test belongs to the current project
    const [testRecord] = await db
      .select({ id: tests.id })
      .from(tests)
      .where(and(eq(tests.id, testId), eq(tests.projectId, project.id)))
      .limit(1);

    if (!testRecord) {
      // Test not found or doesn't belong to this project
      return null;
    }

    const result = await db
      .select({
        id: requirements.id,
        title: requirements.title,
        externalUrl: requirements.externalUrl,
        externalId: requirements.externalId,
      })
      .from(requirements)
      .innerJoin(testRequirements, eq(requirements.id, testRequirements.requirementId))
      .where(
        and(
          eq(testRequirements.testId, testId),
          eq(requirements.projectId, project.id)
        )
      )
      .limit(1);

    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("Error fetching linked test requirement:", error);
    return null;
  }
}
