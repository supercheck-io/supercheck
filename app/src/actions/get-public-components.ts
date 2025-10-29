"use server";

import { db } from "@/utils/db";
import {
  statusPageComponents,
  statusPageComponentMonitors,
  statusPages,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Public action to get components for a status page without authentication
 * Only returns components for published status pages
 */
export async function getPublicComponents(statusPageId: string) {
  try {
    // Validate input
    if (!statusPageId) {
      return {
        success: false,
        message: "Status page ID is required",
        components: [],
      };
    }

    // First verify that the status page exists and is published
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.status, "published")
      ),
    });

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found or not published",
        components: [],
      };
    }

    // Get all components for the status page, including linked monitor data
    const components = await db.query.statusPageComponents.findMany({
      where: eq(statusPageComponents.statusPageId, statusPageId),
      orderBy: (components, { asc }) => [
        asc(components.position),
        asc(components.createdAt),
      ],
    });

    // Fetch monitor associations for all components
    const componentsWithMonitors = await Promise.all(
      components.map(async (component) => {
        try {
          // Get monitors through the join table
          const monitorAssociations =
            await db.query.statusPageComponentMonitors.findMany({
              where: eq(statusPageComponentMonitors.componentId, component.id),
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
            });

          // Extract monitor data with weights
          const linkedMonitors = monitorAssociations.map((assoc) => ({
            ...assoc.monitor,
            weight: assoc.weight,
          }));

          return {
            ...component,
            monitors: linkedMonitors,
            monitorIds: linkedMonitors.map((m) => m.id),
          };
        } catch (monitorError) {
          console.error(
            `Error fetching monitors for component ${component.id}:`,
            monitorError
          );
          // Return component without monitors if there's an error
          return {
            ...component,
            monitors: [],
            monitorIds: [],
          };
        }
      })
    );

    return {
      success: true,
      components: componentsWithMonitors,
    };
  } catch (error) {
    console.error("Error fetching public components:", error);

    // Provide more detailed error information
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;

    return {
      success: false,
      message: `Failed to fetch components: ${errorMessage}`,
      error: {
        message: errorMessage,
        stack: errorStack,
        originalError: error,
      },
      components: [],
    };
  }
}
