"use server";

import { db } from "@/utils/db";
import { incidents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";

export async function getIncidents(statusPageId: string) {
  try {
    // Get current project context (includes auth verification)
    await requireProjectContext();

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
          where: (incidentComponents, { eq }) => eq(incidentComponents.incidentId, incident.id),
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
          where: (incidentUpdates, { eq }) => eq(incidentUpdates.incidentId, incident.id),
          orderBy: (incidentUpdates, { desc }) => [desc(incidentUpdates.createdAt)],
        });

        return {
          ...incident,
          affectedComponentsCount: affectedComponents.length,
          affectedComponents: affectedComponents.map(ic => ic.component),
          latestUpdate: latestUpdate || null,
        };
      })
    );

    return {
      success: true,
      incidents: incidentsWithDetails,
    };
  } catch (error) {
    console.error("Error fetching incidents:", error);
    return {
      success: false,
      message: "Failed to fetch incidents",
      error,
      incidents: [],
    };
  }
}
