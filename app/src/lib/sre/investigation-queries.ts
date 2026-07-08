import { and, desc, eq } from "drizzle-orm";

import {
  sreEvidenceItems,
  sreIncidents,
  sreInvestigationRecommendations,
  sreInvestigationRuns,
  sreInvestigationToolCalls,
  sreServices,
} from "@/db/schema";
import {
  buildSreInvestigationReportExport,
} from "@/lib/sre/investigation-report-export";
import { db } from "@/utils/db";

export async function getSreInvestigationReportExportForRun(input: {
  organizationId: string;
  projectId: string;
  investigationRunId: string;
}) {
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
      estimatedCostCents: sreInvestigationRuns.estimatedCostCents,
      durationMs: sreInvestigationRuns.durationMs,
      createdAt: sreInvestigationRuns.createdAt,
      completedAt: sreInvestigationRuns.completedAt,
    })
    .from(sreInvestigationRuns)
    .leftJoin(sreIncidents, eq(sreInvestigationRuns.incidentId, sreIncidents.id))
    .leftJoin(sreServices, eq(sreIncidents.primaryServiceId, sreServices.id))
    .where(
      and(
        eq(sreInvestigationRuns.id, input.investigationRunId),
        eq(sreInvestigationRuns.organizationId, input.organizationId),
        eq(sreInvestigationRuns.projectId, input.projectId)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  const [evidence, toolCalls, recommendations] = await Promise.all([
    db
      .select({
        id: sreEvidenceItems.id,
        investigationRunId: sreEvidenceItems.investigationRunId,
        title: sreEvidenceItems.title,
        summary: sreEvidenceItems.summary,
        sourceType: sreEvidenceItems.sourceType,
        evidenceType: sreEvidenceItems.evidenceType,
        severity: sreEvidenceItems.severity,
        citationResultHash: sreEvidenceItems.citationResultHash,
        observedAt: sreEvidenceItems.observedAt,
        createdAt: sreEvidenceItems.createdAt,
      })
      .from(sreEvidenceItems)
      .where(
        and(
          eq(sreEvidenceItems.organizationId, input.organizationId),
          eq(sreEvidenceItems.projectId, input.projectId),
          eq(sreEvidenceItems.investigationRunId, input.investigationRunId)
        )
      )
      .orderBy(desc(sreEvidenceItems.createdAt))
      .limit(50),
    db
      .select({
        id: sreInvestigationToolCalls.id,
        investigationRunId: sreInvestigationToolCalls.investigationRunId,
        connectorType: sreInvestigationToolCalls.connectorType,
        toolName: sreInvestigationToolCalls.toolName,
        status: sreInvestigationToolCalls.status,
        inputHash: sreInvestigationToolCalls.inputHash,
        outputHash: sreInvestigationToolCalls.outputHash,
        evidenceItemId: sreInvestigationToolCalls.evidenceItemId,
        durationMs: sreInvestigationToolCalls.durationMs,
        executedAt: sreInvestigationToolCalls.executedAt,
      })
      .from(sreInvestigationToolCalls)
      .where(eq(sreInvestigationToolCalls.investigationRunId, input.investigationRunId))
      .orderBy(desc(sreInvestigationToolCalls.executedAt))
      .limit(80),
    db
      .select({
        id: sreInvestigationRecommendations.id,
        investigationRunId: sreInvestigationRecommendations.investigationRunId,
        recommendationText: sreInvestigationRecommendations.recommendationText,
        stepCount: sreInvestigationRecommendations.stepCount,
        confidenceScore: sreInvestigationRecommendations.confidenceScore,
        applicationStatus: sreInvestigationRecommendations.applicationStatus,
        createdAt: sreInvestigationRecommendations.createdAt,
      })
      .from(sreInvestigationRecommendations)
      .innerJoin(sreInvestigationRuns, eq(sreInvestigationRecommendations.investigationRunId, sreInvestigationRuns.id))
      .where(
        and(
          eq(sreInvestigationRuns.organizationId, input.organizationId),
          eq(sreInvestigationRuns.projectId, input.projectId),
          eq(sreInvestigationRecommendations.investigationRunId, input.investigationRunId)
        )
      )
      .orderBy(desc(sreInvestigationRecommendations.createdAt))
      .limit(25),
  ]);

  const reportExport = buildSreInvestigationReportExport({
    item: {
      ...row,
      evidenceCount: evidence.length,
      toolCallCount: toolCalls.length,
      recommendationCount: recommendations.length,
    },
    evidence,
    toolCalls,
    recommendations,
  });

  return { row, evidence, toolCalls, recommendations, reportExport };
}
