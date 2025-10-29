"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";

export async function getStatusPages() {
  try {
    // Get current project context (includes auth verification)
    const { project, organizationId } = await requireProjectContext();

    console.log(`Fetching status pages for project ${project.id} in organization ${organizationId}`);

    // Fetch all status pages for the current project
    const pages = await db
      .select()
      .from(statusPages)
      .where(
        and(
          eq(statusPages.organizationId, organizationId),
          eq(statusPages.projectId, project.id)
        )
      )
      .orderBy(desc(statusPages.createdAt));

    console.log(`Found ${pages.length} status pages`);

    return {
      success: true,
      statusPages: pages,
    };
  } catch (error) {
    console.error("Error fetching status pages:", error);
    return {
      success: false,
      message: `Failed to fetch status pages: ${
        error instanceof Error ? error.message : String(error)
      }`,
      statusPages: [],
    };
  }
}

export async function getStatusPageById(id: string) {
  try {
    // Get current project context (includes auth verification)
    const { project, organizationId } = await requireProjectContext();

    console.log(`Fetching status page ${id} for project ${project.id}`);

    // Fetch the specific status page
    const [statusPage] = await db
      .select()
      .from(statusPages)
      .where(
        and(
          eq(statusPages.id, id),
          eq(statusPages.organizationId, organizationId),
          eq(statusPages.projectId, project.id)
        )
      )
      .limit(1);

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found",
        statusPage: null,
      };
    }

    return {
      success: true,
      statusPage,
    };
  } catch (error) {
    console.error("Error fetching status page:", error);
    return {
      success: false,
      message: `Failed to fetch status page: ${
        error instanceof Error ? error.message : String(error)
      }`,
      statusPage: null,
    };
  }
}
