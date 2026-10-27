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
import { runSreAgent, SreAgentEmptyResponseError, SreAgentIncompleteResponseError } from "@/sre/lib/agent-runner";
import {
  confidenceNotificationDetail,
  formatInvestigationMarkdown,
  parseInvestigationOutput,
  toStoredHypotheses,
} from "@/sre/lib/investigation-output";
import {
  MAX_TRACE_STEPS,
  stepsFromModelStep,
  type SreInvestigationStep,
} from "@/sre/lib/investigation-trace";
import { createSreConnectorTools } from "@/sre/tools/connector-tools";
import {
  createSreEvidenceTools,
  listStoredSreEvidence,
} from "@/sre/tools/evidence-tools";
import { db } from "@/utils/db";
import {
  consumeSreInvestigationCredit,
  withSreInvestigationAdmission,
  SreInvestigationBillingError,
} from "@/lib/sre/investigation-billing";
import { sreBillingErrorMessage } from "@/lib/sre/billing-error-messages";
import { createLogger } from "@/lib/logger/index";
import { notifyIncidentEvent } from "@/lib/sre/incident-notifier";
import { normalizeFeedbackNote } from "@/lib/sre/feedback-note";
import {
  feedbackPromptLines,
  listIncidentFeedbackNotes,
  listServiceFeedbackHints,
} from "@/lib/sre/investigation-feedback";
import { findSimilarIncidents, similarIncidentPromptLines } from "@/lib/sre/similar-incidents";
import { SreDailyTokenLimitError } from "@/lib/sre/sre-daily-token-limit";
import { failStaleSreInvestigationRunsForIncident } from "@/sre/lib/stale-run-recovery";

const investigationLogger = createLogger({
  module: "sre-investigation-runner",
}) as {
  error: (data: unknown, msg?: string) => void;
};

export type RunSreIncidentInvestigationInput = {
  organizationId: string;
  projectId: string;
  userId: string | null;
  incidentId: string;
  enableLiveConnectors?: boolean;
  /** One-line responder note for a re-run; untrusted, fenced in the prompt. */
  guidance?: string | null;
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
      status: 402 | 404 | 409 | 502;
      error: string;
    };

const ACTIVE_INCIDENT_RUN_CONSTRAINT =
  "sre_investigation_runs_active_incident_unique";

export function isActiveIncidentRunConflict(error: unknown): boolean {
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

  await failStaleSreInvestigationRunsForIncident(input);

  const initialModelId = getActualModelName();
  const liveConnectorsEnabled = input.enableLiveConnectors === true;
  let run: typeof sreInvestigationRuns.$inferSelect;
  try {
    [run] = await withSreInvestigationAdmission(input.organizationId, async (database, billingTier) => database
      .insert(sreInvestigationRuns)
      .values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        incidentId: incident.id,
        agentType: "investigation",
        billingTier,
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
          ...(normalizeFeedbackNote(input.guidance) ? { guidance: normalizeFeedbackNote(input.guidance) } : {}),
        },
        createdByUserId: input.userId,
        startedAt: new Date(),
        createdAt: new Date(),
      })
      .returning());
  } catch (error) {
    if (error instanceof SreInvestigationBillingError) {
      return { success: false, status: 402, error: sreBillingErrorMessage(error.code) };
    }
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
  const steps: SreInvestigationStep[] = [];
  let lastStepElapsedMs = 0;

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
    // Context that improves the investigation but must never block it.
    const [similar, ownNotes, serviceHints] = await Promise.all([
      findSimilarIncidents({
        organizationId: input.organizationId,
        projectId: input.projectId,
        incidentId: incident.id,
      }).catch(() => []),
      listIncidentFeedbackNotes({
        organizationId: input.organizationId,
        projectId: input.projectId,
        incidentId: incident.id,
      }, 3).catch(() => []),
      incident.primaryServiceId
        ? listServiceFeedbackHints({
            organizationId: input.organizationId,
            projectId: input.projectId,
            serviceId: incident.primaryServiceId,
            excludeIncidentId: incident.id,
          }, 3).catch(() => [])
        : Promise.resolve([]),
    ]);
    const guidance = normalizeFeedbackNote(input.guidance);
    const userGuidanceLines = [
      ...(guidance ? [guidance] : []),
      ...feedbackPromptLines(ownNotes),
    ];

    const result = await runSreAgent({
      organizationId: input.organizationId,
      system: buildSreInvestigationSystemPrompt(),
      prompt: buildSreInvestigationPrompt({
        incidentTitle: incident.title,
        severity: incident.severity,
        status: incident.status,
        serviceName: incident.primaryServiceName,
        evidenceCount: Number(incident.evidenceCount ?? 0),
        connectorEvidenceCount: Number(incident.connectorEvidenceCount ?? 0),
        liveConnectorToolsEnabled: liveConnectorsEnabled,
        storedEvidenceContext,
        pastIncidentLines: similarIncidentPromptLines(similar),
        feedbackHintLines: feedbackPromptLines(serviceHints),
        userGuidanceLines,
      }),
      tools: {
        ...createSreEvidenceTools(toolScope),
        ...(liveConnectorsEnabled ? createSreConnectorTools(toolScope) : {}),
      },
      budget: {
        maxSteps: liveConnectorsEnabled ? 8 : 5,
        maxOutputTokens: 3000,
        timeoutMs: 90_000,
      },
      onStepFinish: async ({ event, elapsedMs }) => {
        const added = stepsFromModelStep(
          event as Parameters<typeof stepsFromModelStep>[0],
          steps.length,
          elapsedMs - lastStepElapsedMs,
        );
        lastStepElapsedMs = elapsedMs;
        if (added.length === 0 || steps.length >= MAX_TRACE_STEPS) return;
        steps.push(...added.slice(0, MAX_TRACE_STEPS - steps.length));
        // Live progress for the incident page; a failed write must not fail the run.
        await db
          .update(sreInvestigationRuns)
          .set({ steps: steps.map((step) => ({ ...step })) })
          .where(and(eq(sreInvestigationRuns.id, investigationRunId), eq(sreInvestigationRuns.status, "running")))
          .catch(() => undefined);
      },
    });

    const evidenceRows = await db
      .select({ id: sreEvidenceItems.id })
      .from(sreEvidenceItems)
      .where(
        and(
          eq(sreEvidenceItems.incidentId, incident.id),
          eq(sreEvidenceItems.organizationId, input.organizationId),
          eq(sreEvidenceItems.projectId, input.projectId),
        ),
      );
    const parsed = parseInvestigationOutput(result.text, new Set(evidenceRows.map((row) => row.id)));
    // Schema failure degrades to the plain report: no hypotheses, no confidence.
    const structured = parsed.ok ? parsed.output : null;
    // A JSON answer that failed validation must not be shown to responders as if it were a report.
    const unreadable = !structured && /^\s*(```(?:json)?\s*)?\{/.test(result.text);
    const reportText = structured
      ? formatInvestigationMarkdown(structured)
      : unreadable
        ? "The investigation finished, but its result could not be validated. Run it again for a structured report."
        : result.text;
    const headline = (structured?.conclusion ?? reportText).slice(0, 2000);
    const confidence = structured ? structured.confidence.toFixed(4) : null;

    await db.transaction(async (tx) => {
      const completed = await tx
        .update(sreInvestigationRuns)
        .set({
          status: "completed",
          modelId: result.modelId,
          promptTokens: result.usage.inputTokens,
          completionTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          rootCauseHypothesis: headline,
          confidenceScore: confidence,
          hypotheses: structured ? toStoredHypotheses(structured) : null,
          steps: steps.map((step) => ({ ...step })),
          agentStateSnapshot: {
            mode: "sre_investigation_api",
            summary: reportText,
            structured: structured
              ? {
                  outcome: structured.outcome,
                  confidence: structured.confidence,
                  conclusion: structured.conclusion,
                  nextChecks: structured.nextChecks,
                  topEvidenceIds: structured.topEvidenceIds,
                  downgraded: structured.downgraded,
                }
              : null,
            modelUsage: result.usage,
            finishReason: result.finishReason,
            evidenceCount: Number(incident.evidenceCount ?? 0),
            connectorEvidenceCount: Number(
              incident.connectorEvidenceCount ?? 0,
            ),
            liveConnectorsEnabled,
          },
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        })
        .where(and(eq(sreInvestigationRuns.id, investigationRunId), eq(sreInvestigationRuns.status, "running")))
        .returning({ id: sreInvestigationRuns.id });
      if (completed.length === 0) throw new Error("Investigation reservation is no longer active");

      await tx
        .update(sreIncidents)
        .set({
          // Keep the last readable conclusion when this run's output was unreadable.
          ...(unreadable ? {} : { rootCauseSummary: headline, confidenceScore: confidence }),
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
          summary: reportText,
          modelId: result.modelId,
          finishReason: result.finishReason,
          liveConnectorsEnabled,
          outcome: structured?.outcome ?? null,
        },
        actorType: "agent",
        agentRunId: investigationRunId,
        createdAt: new Date(),
      });
    });

    void notifyIncidentEvent({
      organizationId: input.organizationId,
      projectId: input.projectId,
      incidentId: incident.id,
      event: "ai_finding",
      // Confidence label only; conclusion and evidence text stay out of notifications.
      detail: confidenceNotificationDetail(structured),
      dedupeDiscriminator: investigationRunId,
    });

    return {
      success: true,
      investigationRunId,
      summary: reportText,
      modelId: result.modelId,
      finishReason: result.finishReason,
    };
  } catch (error) {
    // Provider errors can embed credentials or raw evidence. Persist only a
    // known explanation in records exposed to incident readers and exports.
    const finishReason = error instanceof SreAgentIncompleteResponseError
      ? error.finishReason : null;
    const errorCode = finishReason === "tool-calls" ? "step_limit_exceeded"
      : finishReason === "length" ? "token_limit_exceeded"
      : finishReason === "content-filter" ? "content_filter"
      : error instanceof SreDailyTokenLimitError ? (error.unavailable ? "limit_unavailable" : "daily_limit")
      : error instanceof SreAgentEmptyResponseError ? "empty_response"
      : error !== null && typeof error === "object" && "name" in error && error.name === "TimeoutError" ? "timed_out"
      : "provider_error";
    const errorMessage = errorCode === "step_limit_exceeded"
      ? "Investigation reached its step limit before completing. Narrow the incident scope or try using saved evidence only."
      : errorCode === "token_limit_exceeded"
        ? "Investigation reached its response limit before completing. Narrow the incident scope and try again."
        : errorCode === "content_filter"
          ? "The AI provider filtered the investigation response. Review the evidence before trying again."
          : errorCode === "empty_response"
            ? "The AI provider returned no investigation report. Try again."
            : errorCode === "limit_unavailable"
              ? "AI usage limit check is temporarily unavailable. Please try again shortly."
            : errorCode === "daily_limit"
              ? "Daily AI usage limit reached for your organization. It resets at 00:00 UTC."
            : errorCode === "timed_out"
              ? "Investigation timed out before completing. Try again with a narrower scope."
              : "SRE investigation failed";
    await db.transaction(async (tx) => {
      const failed = await tx
        .update(sreInvestigationRuns)
        .set({
          status: "failed",
          steps: steps.map((step) => ({ ...step })),
          agentStateSnapshot: {
            mode: "sre_investigation_api",
            error: errorMessage,
            errorCode,
          },
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        })
        .where(and(eq(sreInvestigationRuns.id, investigationRunId), eq(sreInvestigationRuns.status, "running")))
        .returning({ id: sreInvestigationRuns.id });
      if (failed.length === 0) return;

      await tx.insert(sreIncidentTimelineEvents).values({
        incidentId: incident.id,
        eventType: "ai_finding",
        eventData: {
          type: "sre_investigation_failed",
          investigationRunId,
          error: errorMessage.slice(0, 1000),
          errorCode,
          liveConnectorsEnabled,
        },
        actorType: "agent",
        agentRunId: investigationRunId,
        createdAt: new Date(),
      });
    });

    return {
      success: false,
      status: 502,
      error: errorMessage,
      investigationRunId,
    };
  }
}

export async function completeSreIncidentInvestigation(
  investigationRunId: string,
  incident: any,
  input: RunSreIncidentInvestigationInput,
): Promise<RunSreIncidentInvestigationResult> {
  const execResult = await executeSreIncidentInvestigation(
    investigationRunId,
    incident,
    input,
  );
  if (!execResult.success) {
    return execResult;
  }

  try {
    await consumeSreInvestigationCredit({
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      incidentId: input.incidentId,
      investigationRunId,
      useLiveConnectors: input.enableLiveConnectors === true,
    });
  } catch (error) {
    investigationLogger.error(
      {
        err: error,
        organizationId: input.organizationId,
        projectId: input.projectId,
        incidentId: input.incidentId,
        investigationRunId,
      },
      "SRE investigation billing consumption failed after successful run",
    );
  }

  return execResult;
}
