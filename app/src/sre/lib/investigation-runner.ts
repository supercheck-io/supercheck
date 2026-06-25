import { and, eq, sql } from "drizzle-orm";

import { sreEvidenceItems, sreIncidentTimelineEvents, sreIncidents, sreInvestigationRuns, sreServices } from "@/db/schema";
import { getActualModelName } from "@/lib/ai/ai-provider";
import { buildSreInvestigationPrompt, buildSreInvestigationSystemPrompt } from "@/sre/agents/investigator";
import { runSreAgent } from "@/sre/lib/agent-runner";
import { createSreInvestigationSubagentTools } from "@/sre/subagents/domain-subagents";
import { createSreConnectorTools } from "@/sre/tools/connector-tools";
import { createSreEvidenceTools } from "@/sre/tools/evidence-tools";
import { db } from "@/utils/db";

export type RunSreIncidentInvestigationInput = {
  organizationId: string;
  projectId: string;
  userId: string | null;
  incidentId: string;
  enableLiveConnectors?: boolean;
};

export type RunSreIncidentInvestigationResult =
  | {
      success: true;
      investigationRunId: string;
      summary: string;
      modelId: string;
      finishReason: string;
    }
  | {
      success: false;
      status: 404 | 502;
      error: string;
      investigationRunId?: string;
    };

export async function runSreIncidentInvestigation(
  input: RunSreIncidentInvestigationInput
): Promise<RunSreIncidentInvestigationResult> {
  const [incident] = await db
    .select({
      id: sreIncidents.id,
      title: sreIncidents.title,
      severity: sreIncidents.severity,
      status: sreIncidents.status,
      primaryServiceId: sreIncidents.primaryServiceId,
      primaryServiceName: sreServices.name,
      evidenceCount: sql<number>`count(${sreEvidenceItems.id})::int`,
      connectorEvidenceCount: sql<number>`count(${sreEvidenceItems.id}) filter (where ${sreEvidenceItems.sourceType} != 'native')::int`,
    })
    .from(sreIncidents)
    .leftJoin(sreServices, eq(sreIncidents.primaryServiceId, sreServices.id))
    .leftJoin(sreEvidenceItems, eq(sreEvidenceItems.incidentId, sreIncidents.id))
    .where(
      and(
        eq(sreIncidents.id, input.incidentId),
        eq(sreIncidents.organizationId, input.organizationId),
        eq(sreIncidents.projectId, input.projectId)
      )
    )
    .groupBy(
      sreIncidents.id,
      sreIncidents.title,
      sreIncidents.severity,
      sreIncidents.status,
      sreIncidents.primaryServiceId,
      sreServices.name
    )
    .limit(1);

  if (!incident) {
    return { success: false, status: 404, error: "Incident not found or access denied" };
  }

  const startedAt = Date.now();
  const initialModelId = getActualModelName();
  const liveConnectorsEnabled = input.enableLiveConnectors === true;
  const [run] = await db
    .insert(sreInvestigationRuns)
    .values({
      organizationId: input.organizationId,
      projectId: input.projectId,
      incidentId: incident.id,
      agentType: "investigation",
      status: "running",
      modelId: initialModelId,
      promptInput: {
        mode: "sre_investigation_api",
        incidentId: incident.id,
        evidenceCount: Number(incident.evidenceCount ?? 0),
        connectorEvidenceCount: Number(incident.connectorEvidenceCount ?? 0),
        liveConnectorsEnabled,
        specializedSubagentsEnabled: liveConnectorsEnabled,
      },
      createdByUserId: input.userId,
      startedAt: new Date(startedAt),
      createdAt: new Date(),
    })
    .returning();

  try {
    const toolScope = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      incidentId: incident.id,
      userId: input.userId,
      investigationRunId: run.id,
    };
    const result = await runSreAgent({
      system: buildSreInvestigationSystemPrompt(),
      prompt: buildSreInvestigationPrompt({
        incidentTitle: incident.title,
        severity: incident.severity,
        status: incident.status,
        serviceName: incident.primaryServiceName,
        evidenceCount: Number(incident.evidenceCount ?? 0),
        connectorEvidenceCount: Number(incident.connectorEvidenceCount ?? 0),
        liveConnectorToolsEnabled: liveConnectorsEnabled,
        specializedSubagentsEnabled: liveConnectorsEnabled,
      }),
      tools: {
        ...createSreEvidenceTools(toolScope),
        ...(liveConnectorsEnabled ? createSreConnectorTools(toolScope) : {}),
        ...(liveConnectorsEnabled ? createSreInvestigationSubagentTools() : {}),
      },
      budget: { maxSteps: liveConnectorsEnabled ? 11 : 5, maxOutputTokens: 1800, timeoutMs: 90_000 },
    });

    await db.transaction(async (tx) => {
      await tx
        .update(sreInvestigationRuns)
        .set({
          status: "completed",
          modelId: result.modelId,
          rootCauseHypothesis: result.text.slice(0, 2000),
          agentStateSnapshot: {
            mode: "sre_investigation_api",
            summary: result.text,
            finishReason: result.finishReason,
            evidenceCount: Number(incident.evidenceCount ?? 0),
            connectorEvidenceCount: Number(incident.connectorEvidenceCount ?? 0),
            liveConnectorsEnabled,
            specializedSubagentsEnabled: liveConnectorsEnabled,
          },
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        })
        .where(eq(sreInvestigationRuns.id, run.id));

      await tx
        .update(sreIncidents)
        .set({
          rootCauseSummary: result.text.slice(0, 2000),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sreIncidents.id, incident.id),
            eq(sreIncidents.organizationId, input.organizationId),
            eq(sreIncidents.projectId, input.projectId)
          )
        );

      await tx.insert(sreIncidentTimelineEvents).values({
        incidentId: incident.id,
        eventType: "ai_finding",
        eventData: {
          type: "sre_investigation",
          investigationRunId: run.id,
          summary: result.text,
          modelId: result.modelId,
          finishReason: result.finishReason,
          liveConnectorsEnabled,
          specializedSubagentsEnabled: liveConnectorsEnabled,
        },
        actorType: "agent",
        agentRunId: run.id,
        createdAt: new Date(),
      });
    });

    return {
      success: true,
      investigationRunId: run.id,
      summary: result.text,
      modelId: result.modelId,
      finishReason: result.finishReason,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "SRE investigation failed";
    await db
      .update(sreInvestigationRuns)
      .set({
        status: "failed",
        agentStateSnapshot: { mode: "sre_investigation_api", error: errorMessage },
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      })
      .where(eq(sreInvestigationRuns.id, run.id));

    return { success: false, status: 502, error: "SRE investigation failed", investigationRunId: run.id };
  }
}
