"use server";

import { db } from "@/utils/db";
import {
  statusPageComponents,
  statusPages,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid status page ID format");

/**
 * Public action to get components for a status page without authentication
 * Only returns components for published status pages
 *
 * SECURITY NOTES:
 * - Only returns published page components
 * - Validates UUID format to prevent injection
 * - Only returns public-safe fields (no internal URLs, targets, or metadata)
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

    // Validate UUID format
    const validationResult = uuidSchema.safeParse(statusPageId);
    if (!validationResult.success) {
      return {
        success: false,
        message: "Invalid status page ID",
        components: [],
      };
    }

    // First verify that the status page exists and is published
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.status, "published")
      ),
      columns: { id: true }, // Only need to verify existence
    });

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found or not published",
        components: [],
      };
    }

    // PERFORMANCE FIX: Use Drizzle eager loading instead of N+1 queries
    // Previously: fetched monitors individually per component in a loop
    const components = await db.query.statusPageComponents.findMany({
      where: eq(statusPageComponents.statusPageId, statusPageId),
      columns: {
        id: true,
        name: true,
        description: true,
        status: true,
        showcase: true,
        onlyShowIfDegraded: true,
        position: true,
        startDate: true,
        createdAt: true,
        updatedAt: true,
        // EXCLUDED: statusPageId (redundant), automationEmail (internal)
      },
      orderBy: (components, { asc }) => [
        asc(components.position),
        asc(components.createdAt),
      ],
      with: {
        // Eager load monitor associations with nested monitor data
        monitors: {
          with: {
            monitor: {
              columns: {
                id: true,
                name: true,
                status: true,
                // EXCLUDED: target (leaks internal URLs/IPs), type (internal detail)
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
          id: assoc.monitor.id,
          name: assoc.monitor.name,
          status: assoc.monitor.status,
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
    console.error("Error fetching public components:", error);
    return {
      success: false,
      message: "Failed to fetch components",
      components: [],
    };
  }
}
