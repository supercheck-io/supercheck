import { isActiveIncidentRunConflict } from "@/sre/lib/investigation-runner";
import { and, eq, sql } from "drizzle-orm";

import { sreEvidenceItems, sreIncidentTimelineEvents, sreIncidents, sreInvestigationRuns, sreServices } from "@/db/schema";
import { getActualModelName } from "@/lib/ai/ai-provider";
import { buildSreTriagePrompt, buildSreTriageSystemPrompt } from "@/sre/agents/triage";
import { runSreAgent } from "@/sre/lib/agent-runner";
import { createSreEvidenceTools } from "@/sre/tools/evidence-tools";
import { db } from "@/utils/db";
import { failStaleSreInvestigationRunsForIncident } from "@/sre/lib/stale-run-recovery";
import { insertSreRun, SreOrgConcurrencyError } from "@/sre/lib/run-insert";
import { sreBillingErrorMessage } from "@/lib/sre/billing-error-messages";
import { withSreTriageAdmission, SreInvestigationBillingError } from "@/lib/sre/investigation-billing";
import { notifyIncidentEvent } from "@/lib/sre/incident-notifier";
import { createLogger } from "@/lib/logger/index";

const triageLogger = createLogger({ module: "sre-triage-runner" }) as {
  error: (data: unknown, message?: string) => void;
};

export type RunSreIncidentTriageInput = {
  organizationId: string;
  projectId: string;
  userId: string | null;
  incidentId: string;
  /** Set by the auto-investigate-on-open path; such a run is capped per organization. */
  origin?: "auto";
};

export type RunSreIncidentTriageResult =
  | {
      success: true;
      investigationRunId: string;
      summary: string;
      modelId: string;
      finishReason: string;
    }
  | {
      success: false;
      status: 402 | 404 | 409 | 502;
      error: string;
      investigationRunId?: string;
      reason?: "org_concurrency_limit";
    };

export async function runSreIncidentTriage(input: RunSreIncidentTriageInput): Promise<RunSreIncidentTriageResult> {
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

  await failStaleSreInvestigationRunsForIncident(input);

  const startedAt = Date.now();
  const initialModelId = getActualModelName();
  let run: typeof sreInvestigationRuns.$inferSelect;
  try {
    [run] = await withSreTriageAdmission(input.organizationId, async (database, billingTier) => insertSreRun(database, {
        origin: input.origin ?? "manual",
        organizationId: input.organizationId,
        projectId: input.projectId,
        incidentId: incident.id,
        agentType: "triage",
        billingTier,
        status: "running",
        modelId: initialModelId,
        promptInput: {
          mode: "sre_triage_api",
          incidentId: incident.id,
          evidenceCount: Number(incident.evidenceCount ?? 0),
          connectorEvidenceCount: Number(incident.connectorEvidenceCount ?? 0),
        },
        createdByUserId: input.userId,
        startedAt: new Date(startedAt),
        createdAt: new Date(),
      }));
  } catch (error) {
    if (error instanceof SreInvestigationBillingError) {
      return { success: false, status: 402, error: sreBillingErrorMessage(error.code) };
    }
    if (error instanceof SreOrgConcurrencyError) {
      return { success: false, status: 409, error: error.message, reason: "org_concurrency_limit" };
    }
    if (isActiveIncidentRunConflict(error)) {
      return { success: false, status: 409, error: "An investigation is already running for this incident" };
    }
    throw error;
  }

  try {
    const result = await runSreAgent({
      organizationId: input.organizationId,
      system: buildSreTriageSystemPrompt(),
      prompt: buildSreTriagePrompt({
        incidentTitle: incident.title,
        severity: incident.severity,
        serviceName: incident.primaryServiceName,
        evidenceCount: Number(incident.evidenceCount ?? 0),
        connectorEvidenceCount: Number(incident.connectorEvidenceCount ?? 0),
      }),
      tools: createSreEvidenceTools({
        organizationId: input.organizationId,
        projectId: input.projectId,
        incidentId: incident.id,
      }),
      budget: { maxSteps: 4, maxOutputTokens: 1200, timeoutMs: 45_000 },
    });

    const completed = await db.transaction(async (tx) => {
      const updated = await tx
        .update(sreInvestigationRuns)
        .set({
          status: "completed",
          modelId: result.modelId,
          rootCauseHypothesis: result.text.slice(0, 2000),
          agentStateSnapshot: {
            mode: "sre_triage_api",
            summary: result.text,
            finishReason: result.finishReason,
            evidenceCount: Number(incident.evidenceCount ?? 0),
            connectorEvidenceCount: Number(incident.connectorEvidenceCount ?? 0),
          },
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        })
        .where(and(eq(sreInvestigationRuns.id, run.id), eq(sreInvestigationRuns.status, "running")))
        .returning({ id: sreInvestigationRuns.id });
      // Stale recovery or a cancel already closed this run: write no finding and send no notification.
      if (updated.length === 0) return false;

      await tx
        .update(sreIncidents)
        .set({
          triageInvestigationRunId: run.id,
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
          type: "sre_triage",
          investigationRunId: run.id,
          summary: result.text,
          modelId: result.modelId,
          finishReason: result.finishReason,
        },
        actorType: "agent",
        agentRunId: run.id,
        createdAt: new Date(),
      });
      return true;
    });
    if (!completed) {
      return { success: false, status: 409, error: "Triage run is no longer active", investigationRunId: run.id };
    }

    void notifyIncidentEvent({
      organizationId: input.organizationId,
      projectId: input.projectId,
      incidentId: incident.id,
      event: "ai_finding",
      dedupeDiscriminator: run.id,
    });

    return {
      success: true,
      investigationRunId: run.id,
      summary: result.text,
      modelId: result.modelId,
      finishReason: result.finishReason,
    };
  } catch (error) {
    // Raw provider errors may contain credentials or sensitive evidence; log only the error class.
    triageLogger.error(
      {
        investigationRunId: run.id,
        errorName: error instanceof Error ? error.name : typeof error,
        // Agent errors carry the model's finish reason (length, content-filter); it holds no evidence text.
        finishReason:
          typeof error === "object" && error && "finishReason" in error ? String(error.finishReason) : undefined,
      },
      "SRE triage failed",
    );
    const errorMessage = "SRE triage failed";
    try {
      await db
        .update(sreInvestigationRuns)
        .set({
          status: "failed",
          agentStateSnapshot: { mode: "sre_triage_api", error: errorMessage },
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        })
        .where(and(eq(sreInvestigationRuns.id, run.id), eq(sreInvestigationRuns.status, "running")));
    } catch {
      // Stale-run recovery fails the run later; the caller still gets a clean 502.
      triageLogger.error({ investigationRunId: run.id }, "Could not mark SRE triage run failed");
    }

    // Leave a trace so the incident shows why it has no AI finding. The code is the model's finish reason or the error class, never provider text.
    const errorCode =
      typeof error === "object" && error && "finishReason" in error && error.finishReason
        ? String(error.finishReason)
        : "agent_error";
    try {
      await db.insert(sreIncidentTimelineEvents).values({
        incidentId: incident.id,
        eventType: "state_change",
        eventData: {
          state: "triage_failed",
          errorCode,
          comment: `AI triage did not complete (${errorCode}).`,
          investigationRunId: run.id,
        },
        actorType: "agent",
        agentRunId: run.id,
        createdAt: new Date(),
      });
    } catch {
      triageLogger.error({ investigationRunId: run.id }, "Could not record SRE triage failure on the incident timeline");
    }

    return { success: false, status: 502, error: "SRE triage failed", investigationRunId: run.id };
  }
}
