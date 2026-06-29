import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  sreEvidenceItems,
  sreIncidents,
  sreInvestigationRecommendations,
  sreInvestigationReportFeedback,
  sreInvestigationReports,
  sreInvestigationRuns,
  sreInvestigationToolCalls,
  sreServices,
} from "@/db/schema";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import {
  buildSreInvestigationReportExport,
  type SreInvestigationReportExport,
} from "@/lib/sre/investigation-report-export";
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
  reportExport?: SreInvestigationReportExport;
  reportSnapshotId: string | null;
  reportSnapshotCreatedAt: Date | null;
  reportFeedbackAccuracy: "accurate" | "partially_accurate" | "incorrect" | "needs_more_evidence" | null;
  reportFeedbackUpdatedAt: Date | null;
  reportRejectedHypothesisCount: number;
};

function groupRowsByInvestigationRunId<T extends { investigationRunId: string | null }>(rows: T[]) {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    if (!row.investigationRunId) {
      continue;
    }

    const existing = grouped.get(row.investigationRunId) ?? [];
    existing.push(row);
    grouped.set(row.investigationRunId, existing);
  }

  return grouped;
}

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
        reportSnapshotId: sql<string | null>`NULL`,
        reportSnapshotCreatedAt: sql<Date | null>`NULL`,
        reportFeedbackAccuracy: sql<SreInvestigationHistoryItem["reportFeedbackAccuracy"]>`NULL`,
        reportFeedbackUpdatedAt: sql<Date | null>`NULL`,
        reportRejectedHypothesisCount: sql<number>`0`,
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

    const runIds = rows.map((row) => row.id);

    if (runIds.length === 0) {
      return { success: true, investigations: rows };
    }

    const [evidenceRows, toolCallRows, recommendationRows, reportRows] = await Promise.all([
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
            eq(sreEvidenceItems.organizationId, organizationId),
            eq(sreEvidenceItems.projectId, project.id),
            inArray(sreEvidenceItems.investigationRunId, runIds)
          )
        )
        .orderBy(desc(sreEvidenceItems.createdAt))
        .limit(500),
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
        .where(inArray(sreInvestigationToolCalls.investigationRunId, runIds))
        .orderBy(desc(sreInvestigationToolCalls.executedAt))
        .limit(800),
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
            eq(sreInvestigationRuns.organizationId, organizationId),
            eq(sreInvestigationRuns.projectId, project.id),
            inArray(sreInvestigationRecommendations.investigationRunId, runIds)
          )
        )
        .orderBy(desc(sreInvestigationRecommendations.createdAt))
        .limit(250),
      db
        .select({
          id: sreInvestigationReports.id,
          investigationRunId: sreInvestigationReports.investigationRunId,
          createdAt: sreInvestigationReports.createdAt,
          feedbackAccuracy: sreInvestigationReportFeedback.accuracy,
          feedbackUpdatedAt: sreInvestigationReportFeedback.updatedAt,
          feedbackRejectedHypotheses: sreInvestigationReportFeedback.rejectedHypotheses,
        })
        .from(sreInvestigationReports)
        .leftJoin(
          sreInvestigationReportFeedback,
          and(
            eq(sreInvestigationReportFeedback.reportId, sreInvestigationReports.id),
            eq(sreInvestigationReportFeedback.organizationId, organizationId),
            eq(sreInvestigationReportFeedback.projectId, project.id),
            eq(sreInvestigationReportFeedback.createdByUserId, userId)
          )
        )
        .where(
          and(
            eq(sreInvestigationReports.organizationId, organizationId),
            eq(sreInvestigationReports.projectId, project.id),
            eq(sreInvestigationReports.status, "active"),
            inArray(sreInvestigationReports.investigationRunId, runIds)
          )
        )
        .orderBy(desc(sreInvestigationReports.createdAt))
        .limit(100),
    ]);

    const evidenceByRunId = groupRowsByInvestigationRunId(evidenceRows);
    const toolCallsByRunId = groupRowsByInvestigationRunId(toolCallRows);
    const recommendationsByRunId = groupRowsByInvestigationRunId(recommendationRows);
    const reportsByRunId = groupRowsByInvestigationRunId(reportRows);
    const investigations = rows.map((item) => ({
      ...item,
      reportSnapshotId: reportsByRunId.get(item.id)?.[0]?.id ?? null,
      reportSnapshotCreatedAt: reportsByRunId.get(item.id)?.[0]?.createdAt ?? null,
      reportFeedbackAccuracy: reportsByRunId.get(item.id)?.[0]?.feedbackAccuracy ?? null,
      reportFeedbackUpdatedAt: reportsByRunId.get(item.id)?.[0]?.feedbackUpdatedAt ?? null,
      reportRejectedHypothesisCount: reportsByRunId.get(item.id)?.[0]?.feedbackRejectedHypotheses?.length ?? 0,
      reportExport: buildSreInvestigationReportExport({
        item,
        evidence: evidenceByRunId.get(item.id) ?? [],
        toolCalls: toolCallsByRunId.get(item.id) ?? [],
        recommendations: recommendationsByRunId.get(item.id) ?? [],
      }),
    }));

    return { success: true, investigations };
  } catch (error) {
    console.error("Error fetching SRE investigations:", error);
    return { success: false, error: "Failed to fetch SRE investigations", investigations: [] };
  }
}
