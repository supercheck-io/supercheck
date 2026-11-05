import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireSreSubscription } from "@/app/api/sre/_auth";
import { assertCanStartSreInvestigation, SreInvestigationBillingError } from "@/lib/sre/investigation-billing";
import { sreBillingErrorMessage } from "@/lib/sre/billing-error-messages";
import { checkSreDailyTokenLimit } from "@/lib/sre/sre-daily-token-limit";
import { checkSreEvidenceBriefRateLimit, checkSreIncidentUpdateRateLimit, checkSreInvestigationRateLimit, checkSreTriageRateLimit } from "@/lib/sre/sre-rate-limiter";
import { acknowledgeIncident, assignIncident, MAX_RESOLUTION_SUMMARY_LENGTH, resolveIncident } from "@/lib/sre/incident-lifecycle";
import { investigationGuidanceSchema } from "@/lib/sre/feedback-note";
import { generateEvidenceBrief } from "@/lib/sre/evidence-brief-generator";
import { runSreEvidenceBriefGeneration } from "@/lib/sre/evidence-brief-orchestrator";
import { isSreEnabled } from "@/sre/lib/feature-gates";
import { completeSreIncidentInvestigation, startSreIncidentInvestigation } from "@/sre/lib/investigation-runner";
import { runSreIncidentTriage } from "@/sre/lib/triage-runner";
import { createLogger } from "@/lib/logger/index";
import { and, eq, gte } from "drizzle-orm";
import { sreIncidents, sreInvestigationRuns } from "@/db/schema";
import { STALE_RUN_AFTER_MS } from "@/sre/lib/stale-run-recovery";
import { db } from "@/utils/db";
import { assertCan, type McpCallContext } from "./context";
import { MCP_INCIDENTS_WRITE_SCOPE, MCP_SRE_SCOPE, UNTRUSTED } from "./config";

const logger = createLogger({ module: "mcp-sre-tools" }) as { error: (data: unknown, message?: string) => void };

/** A refusal the tool turns into `fail(code, message)`. */
export class McpToolFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

type Gate = { resource: Parameters<typeof assertCan>[1]; action: string; scope: string };
export type ToolRegistrar = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  gate: Gate,
  shape: S,
  run: (args: z.output<z.ZodObject<S>>) => Promise<Record<string, unknown>>,
) => void;

const idArg = z.string().uuid();

function retryMessage(limit: { unavailable?: boolean }, what: string) {
  return limit.unavailable ? `${what} rate limiter is temporarily unavailable. Try again shortly.` : `${what} rate limit reached. Wait before starting another run.`;
}

/** Same checks, in the same order, as the REST routes that start billable AI SRE work. */
async function startGate(ctx: McpCallContext, kind: "triage" | "investigate" | "brief", incidentId: string, liveConnectors = false) {
  if (!isSreEnabled()) throw new McpToolFailure("feature_disabled", "AI SRE is not enabled on this server");
  assertCan(ctx, "sre_incident", "investigate", MCP_SRE_SCOPE);
  assertCan(ctx, "sre_investigation", "investigate", MCP_SRE_SCOPE);
  // Refused before any limiter slot is spent, as in the REST route.
  if (liveConnectors) assertCan(ctx, "sre_connector", "investigate", MCP_SRE_SCOPE);
  if (kind !== "investigate") {
    const denied = await requireSreSubscription(ctx.organizationId, { allowTrial: kind === "triage" });
    if (denied) {
      const body = (await denied.json().catch(() => ({}))) as { error?: string };
      throw new McpToolFailure(denied.status === 503 ? "unavailable" : "subscription_required", body.error ?? "An active plan is required");
    }
  }
  // Triage and briefs run detached, so a missing incident must be refused here, not logged later.
  const [incident] = await db.select({ id: sreIncidents.id }).from(sreIncidents)
    .where(and(eq(sreIncidents.id, incidentId), eq(sreIncidents.organizationId, ctx.organizationId), eq(sreIncidents.projectId, ctx.projectId))).limit(1);
  if (!incident) throw new McpToolFailure("not_found", "Incident not found");
  // Triage and briefs run detached, so a run already in flight (the runner's one-active-run 409) is refused here,
  // not just logged. Runs older than the stale window do not count: the runner recovers them when it starts.
  if (kind !== "investigate") {
    const [active] = await db.select({ id: sreInvestigationRuns.id }).from(sreInvestigationRuns).where(and(
      eq(sreInvestigationRuns.organizationId, ctx.organizationId), eq(sreInvestigationRuns.projectId, ctx.projectId),
      eq(sreInvestigationRuns.incidentId, incidentId), eq(sreInvestigationRuns.agentType, kind === "triage" ? "triage" : "sre_ai"),
      eq(sreInvestigationRuns.status, "running"), gte(sreInvestigationRuns.startedAt, new Date(Date.now() - STALE_RUN_AFTER_MS)),
    )).limit(1);
    if (active) throw new McpToolFailure("conflict", `A ${kind === "triage" ? "triage" : "evidence brief"} run is already in progress for this incident`);
  }
  const limit = await (kind === "triage" ? checkSreTriageRateLimit : kind === "brief" ? checkSreEvidenceBriefRateLimit : checkSreInvestigationRateLimit)(ctx.userId, incidentId);
  if (!limit.allowed) throw new McpToolFailure("rate_limited", retryMessage(limit, kind));
  const daily = await checkSreDailyTokenLimit(ctx.organizationId);
  if (!daily.allowed) throw new McpToolFailure(daily.unavailable ? "unavailable" : "daily_limit", "The daily AI limit for this organization is reached or unavailable");
  if (kind === "investigate") {
    try {
      await assertCanStartSreInvestigation(ctx.organizationId);
    } catch (error) {
      if (error instanceof SreInvestigationBillingError) throw new McpToolFailure("subscription_required", sreBillingErrorMessage(error.code));
      throw error;
    }
  }
}

const POLL = "Poll with list_investigations (incidentId) and get_investigation; this call returns before the run finishes.";

/** Incident write tools (mcp:incidents:write) and AI SRE start tools (mcp:sre). Each re-checks scope and RBAC per call. */
export function registerSreTools(tool: ToolRegistrar, ctx: McpCallContext): void {
  const actor = { organizationId: ctx.organizationId, projectId: ctx.projectId, userId: ctx.userId };
  const write = { resource: "sre_incident", action: "update", scope: MCP_INCIDENTS_WRITE_SCOPE } as const;

  async function lifecycle<T extends { ok: boolean }>(incidentId: string, run: () => Promise<T>) {
    const limit = await checkSreIncidentUpdateRateLimit(ctx.userId, incidentId);
    if (!limit.allowed) throw new McpToolFailure("rate_limited", "Too many incident updates. Try again shortly.");
    const result = (await run()) as unknown as { ok: true; incident: { id: string; incidentNumber: number }; changed: boolean } | { ok: false; code: string; error: string };
    if (!result.ok) throw new McpToolFailure(result.code === "not_found" ? "not_found" : result.code, result.error);
    return { incidentNumber: result.incident.incidentNumber, changed: result.changed };
  }

  if (ctx.scopes.includes(MCP_INCIDENTS_WRITE_SCOPE)) {
    tool("assign_incident", "Assign an incident, or set its commander. Pass assigneeUserId null to unassign. The assignee must be someone who can act on the incident." + UNTRUSTED, write,
      { id: idArg, assigneeUserId: idArg.nullable(), role: z.enum(["assignee", "commander"]).default("assignee") },
      ({ id, assigneeUserId, role }) => lifecycle(id, () => assignIncident(actor, id, assigneeUserId, role)));
    tool("acknowledge_incident", "Acknowledge an incident. Claims it for you if it is unassigned." + UNTRUSTED, write, { id: idArg },
      ({ id }) => lifecycle(id, () => acknowledgeIncident(actor, id)));
    tool("resolve_incident", "Resolve an incident with a resolution summary." + UNTRUSTED, write,
      { id: idArg, resolutionSummary: z.string().trim().min(1).max(MAX_RESOLUTION_SUMMARY_LENGTH) },
      ({ id, resolutionSummary }) => lifecycle(id, () => resolveIncident(actor, id, resolutionSummary)));
  }

  if (ctx.scopes.includes(MCP_SRE_SCOPE)) {
    const sre = { resource: "sre_incident", action: "investigate", scope: MCP_SRE_SCOPE } as const;
    tool("triage_incident", "Start AI triage of an incident. Billable. " + POLL + UNTRUSTED, sre, { incidentId: idArg }, async ({ incidentId }) => {
      await startGate(ctx, "triage", incidentId);
      // Detached: triage can outlive the request. The run row is created inside, so it shows up in list_investigations.
      after(() => runSreIncidentTriage({ ...actor, incidentId }).then((r) => {
        if (!r.success) logger.error({ incidentId, status: r.status }, "MCP triage did not complete");
      }, (error) => logger.error({ err: error, incidentId }, "MCP triage failed")));
      return { accepted: true, incidentId, next: POLL };
    });
    tool("investigate_incident", "Start a full AI investigation of an incident. Billable. Live connectors need the connector investigate permission. " + POLL + UNTRUSTED, sre,
      { incidentId: idArg, useLiveConnectors: z.boolean().default(false), guidance: investigationGuidanceSchema.nullish() },
      async ({ incidentId, useLiveConnectors, guidance }) => {
        await startGate(ctx, "investigate", incidentId, useLiveConnectors);
        const input = { ...actor, incidentId, enableLiveConnectors: useLiveConnectors, guidance };
        const started = await startSreIncidentInvestigation(input);
        if (!started.success) throw new McpToolFailure(started.status === 404 ? "not_found" : "conflict", started.error);
        after(() => completeSreIncidentInvestigation(started.investigationRunId, started.incident, input).then((r) => {
          if (!r.success) logger.error({ incidentId, investigationRunId: started.investigationRunId, status: r.status }, "MCP investigation did not complete");
        }, (error) => logger.error({ err: error, incidentId, investigationRunId: started.investigationRunId }, "MCP investigation failed")));
        return { accepted: true, investigationRunId: started.investigationRunId, next: POLL };
      });
    tool("generate_incident_brief", "Generate an AI evidence brief for an incident. Billable, needs a plan. " + POLL + UNTRUSTED, sre, { incidentId: idArg }, async ({ incidentId }) => {
      await startGate(ctx, "brief", incidentId);
      after(() => runSreEvidenceBriefGeneration({ ...actor, incidentId, generateBrief: generateEvidenceBrief }).then((r) => {
        if (!r.success) return logger.error({ incidentId }, "MCP evidence brief did not complete");
        revalidatePath("/incidents");
        revalidatePath(`/incidents/${incidentId}`);
      }, (error) => logger.error({ err: error, incidentId }, "MCP evidence brief failed")));
      return { accepted: true, incidentId, next: POLL };
    });
  }
}
