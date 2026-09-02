import { and, eq, sql } from "drizzle-orm";

import {
  sreEvidenceItems,
  sreIncidentTimelineEvents,
  sreIncidents,
  sreInvestigationRuns,
  sreServices,
} from "@/db/schema";
import { getActualModelName } from "@/lib/ai/ai-provider";
import {
  buildSreInvestigationPrompt,
  buildSreInvestigationSystemPrompt,
} from "@/sre/agents/investigator";
import { runSreAgent } from "@/sre/lib/agent-runner";
import { createSreInvestigationSubagentTools } from "@/sre/subagents/domain-subagents";
import { createSreConnectorTools } from "@/sre/tools/connector-tools";
import {
  createSreEvidenceTools,
  listStoredSreEvidence,
} from "@/sre/tools/evidence-tools";
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

export type StartSreIncidentInvestigationResult =
  | {
      success: true;
      investigationRunId: string;
      incident: any;
    }
  | {
      success: false;
      status: 404 | 409 | 502;
      error: string;
    };

const ACTIVE_INCIDENT_RUN_CONSTRAINT =
  "sre_investigation_runs_active_incident_unique";

function isActiveIncidentRunConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (typeof current !== "object") return false;
    const dbError = current as {
      code?: string;
      constraint?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (
      dbError.code === "23505" &&
      (dbError.constraint === ACTIVE_INCIDENT_RUN_CONSTRAINT ||
        dbError.constraint_name === ACTIVE_INCIDENT_RUN_CONSTRAINT)
    ) {
      return true;
    }
    current = dbError.cause;
  }
  return false;
}

export async function startSreIncidentInvestigation(
  input: RunSreIncidentInvestigationInput,
): Promise<StartSreIncidentInvestigationResult> {
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
    .leftJoin(
      sreEvidenceItems,
      eq(sreEvidenceItems.incidentId, sreIncidents.id),
    )
    .where(
      and(
        eq(sreIncidents.id, input.incidentId),
        eq(sreIncidents.organizationId, input.organizationId),
        eq(sreIncidents.projectId, input.projectId),
      ),
    )
    .groupBy(
      sreIncidents.id,
      sreIncidents.title,
      sreIncidents.severity,
      sreIncidents.status,
      sreIncidents.primaryServiceId,
      sreServices.name,
    )
    .limit(1);

  if (!incident) {
    return {
      success: false,
      status: 404,
      error: "Incident not found or access denied",
    };
  }

  const initialModelId = getActualModelName();
  const liveConnectorsEnabled = input.enableLiveConnectors === true;
  let run: typeof sreInvestigationRuns.$inferSelect;
  try {
    [run] = await db
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
          connectorEvidenceCount: Number(
            incident.connectorEvidenceCount ?? 0,
          ),
          liveConnectorsEnabled,
          specializedSubagentsEnabled: liveConnectorsEnabled,
        },
        createdByUserId: input.userId,
        startedAt: new Date(),
        createdAt: new Date(),
      })
      .returning();
  } catch (error) {
    if (isActiveIncidentRunConflict(error)) {
      return {
        success: false,
        status: 409,
        error: "An investigation is already running for this incident",
      };
    }
    throw error;
  }

  return { success: true, investigationRunId: run.id, incident };
}

export async function executeSreIncidentInvestigation(
  investigationRunId: string,
  incident: any,
  input: RunSreIncidentInvestigationInput,
): Promise<RunSreIncidentInvestigationResult> {
  const startedAt = Date.now();
  const liveConnectorsEnabled = input.enableLiveConnectors === true;

  try {
    const [nativeEvidence, connectorEvidence] = await Promise.all([
      listStoredSreEvidence({
        organizationId: input.organizationId,
        projectId: input.projectId,
        incidentId: incident.id,
        sourceMode: "native",
        limit: 8,
      }),
      listStoredSreEvidence({
        organizationId: input.organizationId,
        projectId: input.projectId,
        incidentId: incident.id,
        sourceMode: "connector",
        limit: 8,
      }),
    ]);
    const storedEvidenceContext = [...nativeEvidence, ...connectorEvidence].map(
      (item) => {
        const summary =
          item.summary ?? item.rawContentExcerpt ?? "No summary available";
        return [
          `id=${item.id}`,
          `type=${item.evidenceType}`,
          `title=${item.title}`,
          `summary=${summary.slice(0, 400)}`,
          `observedAt=${item.observedAt ?? "unknown"}`,
          `resultHash=${item.citationResultHash ?? "unavailable"}`,
        ].join("; ");
      },
    );
    const toolScope = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      incidentId: incident.id,
      userId: input.userId,
      investigationRunId,
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
        storedEvidenceContext,
      }),
      tools: {
        ...createSreEvidenceTools(toolScope),
        ...(liveConnectorsEnabled ? createSreConnectorTools(toolScope) : {}),
        ...(liveConnectorsEnabled ? createSreInvestigationSubagentTools() : {}),
      },
      budget: {
        maxSteps: liveConnectorsEnabled ? 11 : 5,
        maxOutputTokens: 1800,
        timeoutMs: 90_000,
      },
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
            connectorEvidenceCount: Number(
              incident.connectorEvidenceCount ?? 0,
            ),
            liveConnectorsEnabled,
            specializedSubagentsEnabled: liveConnectorsEnabled,
          },
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        })
        .where(eq(sreInvestigationRuns.id, investigationRunId));

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
            eq(sreIncidents.projectId, input.projectId),
          ),
        );

      await tx.insert(sreIncidentTimelineEvents).values({
        incidentId: incident.id,
        eventType: "ai_finding",
        eventData: {
          type: "sre_investigation",
          investigationRunId: investigationRunId,
          summary: result.text,
          modelId: result.modelId,
          finishReason: result.finishReason,
          liveConnectorsEnabled,
          specializedSubagentsEnabled: liveConnectorsEnabled,
        },
        actorType: "agent",
        agentRunId: investigationRunId,
        createdAt: new Date(),
      });
    });

    return {
      success: true,
      investigationRunId,
      summary: result.text,
      modelId: result.modelId,
      finishReason: result.finishReason,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "SRE investigation failed";
    await db.transaction(async (tx) => {
      await tx
        .update(sreInvestigationRuns)
        .set({
          status: "failed",
          agentStateSnapshot: {
            mode: "sre_investigation_api",
            error: errorMessage,
          },
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        })
        .where(eq(sreInvestigationRuns.id, investigationRunId));

      await tx.insert(sreIncidentTimelineEvents).values({
        incidentId: incident.id,
        eventType: "ai_finding",
        eventData: {
          type: "sre_investigation_failed",
          investigationRunId,
          error: errorMessage.slice(0, 1000),
          liveConnectorsEnabled,
          specializedSubagentsEnabled: liveConnectorsEnabled,
        },
        actorType: "agent",
        agentRunId: investigationRunId,
        createdAt: new Date(),
      });
    });

    return {
      success: false,
      status: 502,
      error: "SRE investigation failed",
      investigationRunId,
    };
  }
}
