"use server";

import { db } from "@/utils/db";
import { incidents, statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Public action to get incident details without authentication
 * Only returns incidents for published status pages
 */
export async function getPublicIncidentDetail(
  incidentId: string,
  statusPageId: string
) {
  try {
    // Validate inputs
    if (!incidentId || !statusPageId) {
      return {
        success: false,
        message: "Incident ID and Status Page ID are required",
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
      };
    }

    // Get the incident
    const incident = await db.query.incidents.findFirst({
      where: and(
        eq(incidents.id, incidentId),
        eq(incidents.statusPageId, statusPageId)
      ),
    });

    if (!incident) {
      return {
        success: false,
        message: "Incident not found",
      };
    }

    // Get affected components
    const affectedComponents = await db.query.incidentComponents.findMany({
      where: (incidentComponents, { eq }) =>
        eq(incidentComponents.incidentId, incidentId),
      with: {
        component: {
          columns: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });

    // Get all updates for this incident
    const updates = await db.query.incidentUpdates.findMany({
      where: (incidentUpdates, { eq }) =>
        eq(incidentUpdates.incidentId, incidentId),
      orderBy: (incidentUpdates, { desc }) => [desc(incidentUpdates.createdAt)],
    });

    return {
      success: true,
      incident: {
        ...incident,
        affectedComponents: affectedComponents.map((ic) => ic.component),
        updates,
      },
    };
  } catch (error) {
    console.error("Error fetching public incident detail:", error);
    return {
      success: false,
      message: "Failed to fetch incident details",
      error,
    };
  }
}
