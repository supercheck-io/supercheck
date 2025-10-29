"use server";

import { db } from "@/utils/db";
import { monitors } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";

export async function getMonitorsForStatusPage() {
  try {
    // Get current project context (includes auth verification)
    const { project } = await requireProjectContext();

    // Get all monitors for the project
    const projectMonitors = await db.query.monitors.findMany({
      where: eq(monitors.projectId, project.id),
      orderBy: (monitors, { asc }) => [asc(monitors.name)],
      columns: {
        id: true,
        name: true,
        type: true,
        status: true,
      },
    });

    return {
      success: true,
      monitors: projectMonitors,
    };
  } catch (error) {
    console.error("Error fetching monitors:", error);
    return {
      success: false,
      message: "Failed to fetch monitors",
      error,
      monitors: [],
    };
  }
}
