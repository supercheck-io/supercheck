import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireSreSubscription } from "@/app/api/sre/_auth";
import { assertCanStartSreInvestigation, SreInvestigationBillingError, withSreTriageAdmission } from "@/lib/sre/investigation-billing";
import { sreBillingErrorMessage } from "@/lib/sre/billing-error-messages";
import { checkSreDailyTokenLimit } from "@/lib/sre/sre-daily-token-limit";
import { checkSreEvidenceBriefRateLimit, checkSreIncidentUpdateRateLimit, checkSreInvestigationRateLimit, checkSreTriageRateLimit } from "@/lib/sre/sre-rate-limiter";
import { createManualIncident, updateIncidentResources } from "@/lib/sre/manual-incident";
import { cancelMaintenanceWindow, createMaintenanceWindow, deleteMaintenanceWindow, endMaintenanceWindow, extendMaintenanceWindow, updateMaintenanceWindow } from "@/lib/maintenance/windows";
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

type Gate = { resource: Parameters<typeof assertCan>[1]; action: string; scope: string; destructive?: boolean };
export type ToolRegistrar = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  gate: Gate,
  shape: S,
  run: (args: z.output<z.ZodObject<S>>) => Promise<Record<string, unknown>>,
) => void;

// Lowercase every id argument (incident, window, service, monitor and user ids), so a differently cased id
// shares the same rate-limit bucket and matches the same row, as the REST routes do.
const idArg = z.string().uuid().transform((value) => value.toLowerCase());

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
  if (kind !== "brief") {
    try {
      // Triage refuses an exhausted trial allowance inside the detached runner; run the same admission check now (no row is created).
      if (kind === "triage") await withSreTriageAdmission(ctx.organizationId, async () => null);
      else await assertCanStartSreInvestigation(ctx.organizationId);
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
    tool("create_incident", "Declare an incident by hand, for an outage no monitor caught (for example a user report). Sends the project's incident notifications. Optionally list affected services and monitors: their next alerts join this incident. It never posts to a public status page." + UNTRUSTED,
      { resource: "sre_incident", action: "create", scope: MCP_INCIDENTS_WRITE_SCOPE },
      {
        title: z.string().trim().min(1).max(500),
        severity: z.enum(["sev1", "sev2", "sev3", "sev4"]).default("sev3"),
        summary: z.string().trim().max(4000).nullish(),
        primaryServiceId: idArg.nullish(),
        affectedServiceIds: z.array(idArg).max(50).default([]),
        affectedMonitorIds: z.array(idArg).max(50).default([]),
        commanderUserId: idArg.nullish(),
      },
      async ({ affectedServiceIds, affectedMonitorIds, ...input }) => {
        const result = await createManualIncident(
          { userId: ctx.userId, organizationId: ctx.organizationId, orgPendingDeletion: ctx.orgPendingDeletion, project: { id: ctx.projectId, userRole: ctx.role } },
          // No statusPage: public posts and subscriber emails stay out of reach of a model-driven client.
          { ...input, affected: { serviceIds: affectedServiceIds, monitorIds: affectedMonitorIds }, statusPage: null },
          "mcp",
        );
        if (!result.ok) throw new McpToolFailure(result.code === "forbidden" ? "forbidden" : result.code, result.error);
        return { id: result.incident.id, incidentNumber: result.incident.incidentNumber, ...(result.warning ? { warning: result.warning } : {}) };
      });
    const windowWrite = { resource: "monitor", action: "update", scope: MCP_INCIDENTS_WRITE_SCOPE } as const;
    const windowActor = () => ({ userId: ctx.userId, organizationId: ctx.organizationId, orgPendingDeletion: ctx.orgPendingDeletion, project: { id: ctx.projectId, userRole: ctx.role } });
    const windowOut = (result: Awaited<ReturnType<typeof endMaintenanceWindow>>) => {
      if (!result.ok) throw new McpToolFailure(result.code, result.error);
      return { id: result.window.id, state: result.window.state, occurrenceStartsAt: result.window.occurrenceStartsAt?.toISOString() ?? null, occurrenceEndsAt: result.window.occurrenceEndsAt?.toISOString() ?? null };
    };
    tool("create_maintenance_window", "Schedule maintenance, for example before a planned deploy. Covered monitors keep running but send no alerts, open no incidents and are left out of uptime. Scope: the whole project, services or monitors. Times are wall-clock in an IANA time zone. Never posts to a status page." + UNTRUSTED, windowWrite,
      {
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).nullish(),
        scope: z.enum(["project", "services", "monitors"]),
        serviceIds: z.array(idArg).max(500).default([]),
        monitorIds: z.array(idArg).max(500).default([]),
        recurrence: z.enum(["once", "daily", "weekly", "monthly"]).default("once"),
        timezone: z.string().trim().min(1).max(64),
        startsOn: z.string().describe("YYYY-MM-DD, local date of the first occurrence"),
        localStartTime: z.string().describe("HH:MM, local start time"),
        durationMinutes: z.number().int().min(5).max(10080),
        endsOn: z.string().nullish(),
        weekdays: z.array(z.number().int().min(0).max(6)).nullish().describe("Weekly: 0 = Sunday"),
        monthDay: z.number().int().nullish().describe("Monthly: 1-28, or -1 for the last day"),
      },
      async ({ serviceIds, monitorIds, ...input }) => windowOut(await createMaintenanceWindow(windowActor(), { ...input, targets: { serviceIds, monitorIds }, statusPages: [] }, "mcp") as never));
    tool("end_maintenance_window", "End an active maintenance window now. Alerts resume at once." + UNTRUSTED, windowWrite, { id: idArg },
      async ({ id }) => windowOut(await endMaintenanceWindow(windowActor(), id, "mcp")));
    tool("extend_maintenance_window", "Extend an active maintenance window by some minutes." + UNTRUSTED, windowWrite, { id: idArg, byMinutes: z.number().int().min(1).max(10080) },
      async ({ id, byMinutes }) => windowOut(await extendMaintenanceWindow(windowActor(), id, { byMinutes }, "mcp")));
    tool("cancel_maintenance_window", "Cancel a scheduled maintenance window, or the rest of a recurring one." + UNTRUSTED, windowWrite, { id: idArg },
      async ({ id }) => windowOut(await cancelMaintenanceWindow(windowActor(), id, "mcp")));
    tool("update_maintenance_window", "Edit a scheduled or recurring maintenance window: title, scope, targets or schedule. Pass only the fields to change; edits apply to future occurrences. An active one-off window cannot be rescheduled: end or extend it instead. Refused for a window on a status page." + UNTRUSTED, windowWrite,
      {
        id: idArg,
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().max(2000).nullish(),
        scope: z.enum(["project", "services", "monitors"]).optional(),
        serviceIds: z.array(idArg).max(500).optional().describe("With scope services: replaces the targets"),
        monitorIds: z.array(idArg).max(500).optional().describe("With scope monitors: replaces the targets"),
        recurrence: z.enum(["once", "daily", "weekly", "monthly"]).optional(),
        timezone: z.string().trim().min(1).max(64).optional(),
        startsOn: z.string().optional().describe("YYYY-MM-DD"),
        localStartTime: z.string().optional().describe("HH:MM"),
        durationMinutes: z.number().int().min(5).max(10080).optional(),
        endsOn: z.string().nullish(),
        weekdays: z.array(z.number().int().min(0).max(6)).nullish(),
        monthDay: z.number().int().nullish(),
      },
      async ({ id, serviceIds, monitorIds, ...input }) => {
        const targets = serviceIds || monitorIds ? { serviceIds: serviceIds ?? [], monitorIds: monitorIds ?? [] } : undefined;
        return windowOut(await updateMaintenanceWindow(windowActor(), id, { ...input, ...(targets ? { targets } : {}) }, "mcp"));
      });
    tool("delete_maintenance_window", "Delete a maintenance window that is not active. Needs the mcp:incidents:write scope, like the other maintenance tools, and permission to delete monitors. Refused while it is posted on a status page: cancel it first." + UNTRUSTED,
      { resource: "monitor", action: "delete", scope: MCP_INCIDENTS_WRITE_SCOPE, destructive: true },
      { id: idArg },
      async ({ id }) => {
        const result = await deleteMaintenanceWindow(windowActor(), id, "mcp");
        if (!result.ok) throw new McpToolFailure(result.code, result.error);
        return { id, deleted: true };
      });
    tool("update_incident_resources", "Add or remove the services and monitors an incident affects. Their next alerts join this incident." + UNTRUSTED, write,
      {
        id: idArg,
        addServiceIds: z.array(idArg).max(50).default([]),
        addMonitorIds: z.array(idArg).max(50).default([]),
        removeServiceIds: z.array(idArg).max(50).default([]),
        removeMonitorIds: z.array(idArg).max(50).default([]),
      },
      async ({ id, addServiceIds, addMonitorIds, removeServiceIds, removeMonitorIds }) => {
        const limit = await checkSreIncidentUpdateRateLimit(ctx.userId, id);
        if (!limit.allowed) throw new McpToolFailure("rate_limited", "Too many incident updates. Try again shortly.");
        const result = await updateIncidentResources(windowActor(), id, {
          add: { serviceIds: addServiceIds, monitorIds: addMonitorIds },
          remove: { serviceIds: removeServiceIds, monitorIds: removeMonitorIds },
        });
        if (!result.ok) throw new McpToolFailure(result.code, result.error);
        return { id, added: result.added, removed: result.removed };
      });
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
