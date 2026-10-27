"use server";

import { z } from "zod";

import { createLogger } from "@/lib/logger/index";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { findSimilarIncidents } from "@/lib/sre/similar-incidents";

const logger = createLogger({ module: "sre-similar-incidents" }) as {
  error: (data: unknown, message?: string) => void;
};

export type SreSimilarIncidentListItem = {
  id: string;
  incidentNumber: number;
  title: string;
  severity: string;
  serviceName: string | null;
  resolvedAt: Date | null;
  rootCauseSummary: string | null;
  resolutionSummary: string | null;
  matchedOn: Array<"service" | "alert" | "title">;
};

/** Own action so the SQL matching is cached separately from the polled incident detail. */
export async function getSreSimilarIncidents(
  incidentId: string,
): Promise<
  | { success: true; incidents: SreSimilarIncidentListItem[] }
  | { success: false; error: string; incidents: [] }
> {
  try {
    const parsed = z.string().uuid().safeParse(incidentId);
    if (!parsed.success) return { success: false, error: "Invalid incident", incidents: [] };
    const { userId, organizationId, project } = await requireProjectContext();
    if (!checkPermissionWithContext("sre_incident", "view", { userId, organizationId, project })) {
      return { success: false, error: "Insufficient permissions to view incidents", incidents: [] };
    }
    const found = await findSimilarIncidents({ organizationId, projectId: project.id, incidentId: parsed.data });
    return { success: true, incidents: found.map(({ score: _score, ...rest }) => rest) };
  } catch (error) {
    logger.error({ error }, "Error loading similar SRE incidents");
    return { success: false, error: "Failed to load similar incidents", incidents: [] };
  }
}
