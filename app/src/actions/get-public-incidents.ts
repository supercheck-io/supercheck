"use server";

import { db } from "@/utils/db";
import { incidents, statusPages } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";

/**
 * Public action to get incidents for a status page without authentication
 * Only returns incidents for published status pages
 */
export async function getPublicIncidents(statusPageId: string) {
  try {
    // Validate input
    if (!statusPageId) {
      return {
        success: false,
        message: "Status page ID is required",
        incidents: [],
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
        incidents: [],
      };
    }

    // Get all incidents for the status page with related data
    const incidentsList = await db.query.incidents.findMany({
      where: eq(incidents.statusPageId, statusPageId),
      orderBy: [desc(incidents.createdAt)],
    });

    // For each incident, get affected components and latest update
    const incidentsWithDetails = await Promise.all(
      incidentsList.map(async (incident) => {
        // Get affected components
        const affectedComponents = await db.query.incidentComponents.findMany({
          where: (incidentComponents, { eq }) =>
            eq(incidentComponents.incidentId, incident.id),
          with: {
            component: {
              columns: {
                id: true,
                name: true,
              },
            },
          },
        });

        // Get latest update
        const latestUpdate = await db.query.incidentUpdates.findFirst({
          where: (incidentUpdates, { eq }) =>
            eq(incidentUpdates.incidentId, incident.id),
          orderBy: (incidentUpdates, { desc }) => [
            desc(incidentUpdates.createdAt),
          ],
        });

        return {
          ...incident,
          affectedComponentsCount: affectedComponents.length,
          affectedComponents: affectedComponents.map((ic) => ic.component),
          latestUpdate: latestUpdate || null,
        };
      })
    );

    return {
      success: true,
      incidents: incidentsWithDetails,
    };
  } catch (error) {
    console.error("Error fetching public incidents:", error);
    return {
      success: false,
      message: "Failed to fetch incidents",
      error,
      incidents: [],
    };
  }
}
