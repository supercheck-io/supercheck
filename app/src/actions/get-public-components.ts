"use server";

import { db } from "@/utils/db";
import { statusPageComponents, statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { withDailyMetrics } from "@/lib/status-page-daily-metrics";

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
        eq(statusPages.status, "published"),
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

    const components = await db.query.statusPageComponents.findMany({
      where: and(
        eq(statusPageComponents.statusPageId, statusPageId),
        eq(statusPageComponents.showcase, true),
      ),
      columns: {
        id: true,
        name: true,
        description: true,
        status: true,
        showcase: true,
        onlyShowIfDegraded: true,
        position: true,
        startDate: true,
        aggregationMethod: true,
        failureThreshold: true,
        createdAt: true,
        updatedAt: true,
        // EXCLUDED: statusPageId (redundant), automationEmail (internal)
      },
      orderBy: (components, { asc }) => [
        asc(components.position),
        asc(components.createdAt),
      ],
    });

    const publicComponents = await withDailyMetrics(components);

    return {
      success: true,
      components: publicComponents,
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
