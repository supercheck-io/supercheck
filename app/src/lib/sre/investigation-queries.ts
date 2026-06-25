import { and, desc, eq, sql } from "drizzle-orm";

import { sreEvidenceItems, sreIncidents, sreInvestigationRecommendations, sreInvestigationRuns, sreInvestigationToolCalls, sreServices } from "@/db/schema";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { db } from "@/utils/db";

export type SreInvestigationHistoryItem = {
  id: string;
  incidentId: string | null;
  incidentNumber: number | null;
  incidentTitle: string | null;
  serviceName: string | null;
  severity: string | null;
  incidentStatus: string | null;
  agentType: string;
  status: string;
  modelId: string;
  rootCauseHypothesis: string | null;
  confidenceScore: string | null;
  evidenceCount: number;
  toolCallCount: number;
  recommendationCount: number;
  estimatedCostCents: number | null;
  durationMs: number | null;
  createdAt: Date;
  completedAt: Date | null;
};

export async function getSreInvestigationHistory(): Promise<
  | { success: true; investigations: SreInvestigationHistoryItem[] }
  | { success: false; error: string; investigations: [] }
> {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canViewInvestigations = checkPermissionWithContext("sre_investigation", "view", {
      userId,
      organizationId,
      project,
    });

    if (!canViewInvestigations) {
      return { success: false, error: "Insufficient permissions to view SRE investigations", investigations: [] };
    }

    const rows = await db
      .select({
        id: sreInvestigationRuns.id,
        incidentId: sreInvestigationRuns.incidentId,
        incidentNumber: sreIncidents.incidentNumber,
        incidentTitle: sreIncidents.title,
        serviceName: sreServices.name,
        severity: sreIncidents.severity,
        incidentStatus: sreIncidents.status,
        agentType: sreInvestigationRuns.agentType,
        status: sreInvestigationRuns.status,
        modelId: sreInvestigationRuns.modelId,
        rootCauseHypothesis: sreInvestigationRuns.rootCauseHypothesis,
        confidenceScore: sreInvestigationRuns.confidenceScore,
        evidenceCount: sql<number>`count(distinct ${sreEvidenceItems.id})::int`,
        toolCallCount: sql<number>`count(distinct ${sreInvestigationToolCalls.id})::int`,
        recommendationCount: sql<number>`count(distinct ${sreInvestigationRecommendations.id})::int`,
        estimatedCostCents: sreInvestigationRuns.estimatedCostCents,
        durationMs: sreInvestigationRuns.durationMs,
        createdAt: sreInvestigationRuns.createdAt,
        completedAt: sreInvestigationRuns.completedAt,
      })
      .from(sreInvestigationRuns)
      .leftJoin(sreIncidents, eq(sreInvestigationRuns.incidentId, sreIncidents.id))
      .leftJoin(sreServices, eq(sreIncidents.primaryServiceId, sreServices.id))
      .leftJoin(sreEvidenceItems, eq(sreEvidenceItems.investigationRunId, sreInvestigationRuns.id))
      .leftJoin(sreInvestigationToolCalls, eq(sreInvestigationToolCalls.investigationRunId, sreInvestigationRuns.id))
      .leftJoin(sreInvestigationRecommendations, eq(sreInvestigationRecommendations.investigationRunId, sreInvestigationRuns.id))
      .where(
        and(
          eq(sreInvestigationRuns.organizationId, organizationId),
          eq(sreInvestigationRuns.projectId, project.id)
        )
      )
      .groupBy(
        sreInvestigationRuns.id,
        sreInvestigationRuns.incidentId,
        sreIncidents.incidentNumber,
        sreIncidents.title,
        sreServices.name,
        sreIncidents.severity,
        sreIncidents.status,
        sreInvestigationRuns.agentType,
        sreInvestigationRuns.status,
        sreInvestigationRuns.modelId,
        sreInvestigationRuns.rootCauseHypothesis,
        sreInvestigationRuns.confidenceScore,
        sreInvestigationRuns.estimatedCostCents,
        sreInvestigationRuns.durationMs,
        sreInvestigationRuns.createdAt,
        sreInvestigationRuns.completedAt
      )
      .orderBy(desc(sreInvestigationRuns.createdAt))
      .limit(100);

    return { success: true, investigations: rows };
  } catch (error) {
    console.error("Error fetching SRE investigations:", error);
    return { success: false, error: "Failed to fetch SRE investigations", investigations: [] };
  }
}
