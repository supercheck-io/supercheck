import { and, count, eq, gt, sql } from "drizzle-orm";

import { sreIncidents, sreInvestigationRuns } from "@/db/schema";
import { validateAIConfiguration } from "@/lib/ai/ai-provider";
import { createLogger } from "@/lib/logger/index";
import { assertCanStartSreInvestigation } from "@/lib/sre/investigation-billing";
import { getNotificationPolicy } from "@/lib/sre/notification-policy";
import { sreDailyTokenLimitResponse } from "@/lib/sre/sre-daily-token-limit";
import { isSreEnabled } from "@/sre/lib/feature-gates";
import { completeSreIncidentInvestigation, startSreIncidentInvestigation } from "@/sre/lib/investigation-runner";
import { STALE_RUN_AFTER_MS, failStaleSreInvestigationRunsForIncident } from "@/sre/lib/stale-run-recovery";
import { MAX_AUTO_RUNNING_PER_ORG } from "@/sre/lib/run-insert";
import { completeSreIncidentTriage, startSreIncidentTriage } from "@/sre/lib/triage-runner";
import { db } from "@/utils/db";

// Failed automatic attempts (manual runs do not count) per incident before it stops retrying; a person can still start one.
const MAX_AUTO_ATTEMPTS = 3;

const logger = createLogger({ module: "sre-auto-investigate" }) as {
  error: (data: unknown, message?: string) => void;
};

export type AutoInvestigateInput = {
  organizationId: string;
  projectId: string;
  incidentId: string;
  /** The person who opened the incident, or null for one opened by an alert. */
  userId: string | null;
};

/**
 * Project opt-in (off by default, it spends AI credits): when an incident opens, SEV1-2 get a full
 * investigation and SEV3-4 a quick triage. Goes through the same billing, daily-token and
 * configuration gates as starting either by hand. `handled` is true once a run was started.
 */
export async function maybeAutoInvestigateOnOpen(input: AutoInvestigateInput): Promise<{ handled: boolean; reason?: string }> {
  try {
    if (!isSreEnabled()) return { handled: false, reason: "sre_disabled" };
    const policy = await getNotificationPolicy(input.projectId);
    if (!policy.autoInvestigateOnOpen) return { handled: false, reason: "disabled" };

    // A run left "running" by a restart would otherwise block this incident forever.
    await failStaleSreInvestigationRunsForIncident(input);

    // The lock makes the decision atomic per incident; it is released before the run starts so no pooled
    // connection is held across the LLM call. A racing start of the same agent type is stopped by the
    // active-run unique index (it includes agent type, and severity picks one type per incident).
    // The incident is read after the lock so severity and status are current when the run is chosen.
    const decision = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`auto-investigate:${input.incidentId}`}))`);
      const [incident] = await tx
        .select({ severity: sreIncidents.severity, status: sreIncidents.status, createdAt: sreIncidents.createdAt })
        .from(sreIncidents)
        .where(
          and(
            eq(sreIncidents.id, input.incidentId),
            eq(sreIncidents.organizationId, input.organizationId),
            eq(sreIncidents.projectId, input.projectId),
          ),
        )
        .limit(1);
      if (!incident || incident.status === "resolved") return { reason: "not_open" } as const;
      // Only incidents opened after auto-investigate was switched on: enabling it must not spend credits on old ones.
      if (policy.autoInvestigateEnabledAt && incident.createdAt < policy.autoInvestigateEnabledAt) {
        return { reason: "predates_policy" } as const;
      }
      const blocked = await blockingRunReason(tx, input, autoAgentType(incident.severity));
      if (blocked) return { reason: blocked } as const;
      return { severity: incident.severity };
    });
    if ("reason" in decision) return { handled: false, reason: decision.reason };
    return await startOnce(input, decision.severity);
  } catch (error) {
    logger.error({ error, incidentId: input.incidentId }, "Automatic investigation could not start");
    return { handled: false, reason: "error" };
  }
}

type Executor = Pick<typeof db, "select">;

// One automatic run per incident: later alerts joining it, or a retried job, must not bill again.
// A failed, aborted or timed-out run does not count, so it can be retried, up to a cap so a
// persistent provider failure does not spend credits on every alert that joins the incident.
// Only runs of the agent type this path would start count, so a manual triage of a SEV1 does not
// block its automatic full investigation. The per-org running cap below counts every agent type.
function autoAgentType(severity: string) {
  return severity === "sev3" || severity === "sev4" ? ("triage" as const) : ("investigation" as const);
}

async function blockingRunReason(executor: Executor, input: AutoInvestigateInput, agentType: "triage" | "investigation") {
  const runs = await executor
    .select({ status: sreInvestigationRuns.status, origin: sreInvestigationRuns.origin })
    .from(sreInvestigationRuns)
    .where(
      and(
        eq(sreInvestigationRuns.incidentId, input.incidentId),
        eq(sreInvestigationRuns.organizationId, input.organizationId),
        eq(sreInvestigationRuns.projectId, input.projectId),
        eq(sreInvestigationRuns.agentType, agentType),
      ),
    );
  if (runs.some((run) => run.status === "running" || run.status === "completed")) return "already_investigated" as const;
  if (runs.filter((run) => run.origin === "auto").length >= MAX_AUTO_ATTEMPTS) return "retry_limit" as const;
  // Runs past the stale age are dead, not in flight, so they do not hold a slot.
  const [{ running }] = await executor
    .select({ running: count() })
    .from(sreInvestigationRuns)
    .where(
      and(
        eq(sreInvestigationRuns.organizationId, input.organizationId),
        eq(sreInvestigationRuns.status, "running"),
        gt(sreInvestigationRuns.startedAt, new Date(Date.now() - STALE_RUN_AFTER_MS)),
      ),
    );
  if (running >= MAX_AUTO_RUNNING_PER_ORG) {
    logger.error({ organizationId: input.organizationId, incidentId: input.incidentId }, "Automatic investigation skipped: organization concurrency limit (start it by hand once a run finishes)");
    return "org_concurrency_limit" as const;
  }
  return null;
}

async function startOnce(
  input: AutoInvestigateInput,
  severity: string,
): Promise<{ handled: boolean; reason?: string }> {
  try {
    try {
      validateAIConfiguration();
    } catch {
      return { handled: false, reason: "ai_not_configured" };
    }

    if (await sreDailyTokenLimitResponse(input.organizationId)) return { handled: false, reason: "daily_limit" };

    // The lock is gone by now: re-check just before starting so a run another trigger finished meanwhile
    // is not repeated. The runner's insert is the final guard: a unique index stops a second automatic run of the
    // incident, and the per-organization cap is counted under a lock there.
    const blocked = await blockingRunReason(db, input, autoAgentType(severity));
    if (blocked) return { handled: false, reason: blocked };

    if (severity === "sev3" || severity === "sev4") {
      const triageInput = { ...input, origin: "auto" as const };
      const triage = await startSreIncidentTriage(triageInput);
      if (!triage.success && triage.status === 409) return { handled: false, reason: triage.reason ?? "already_running" };
      if (!triage.success) return { handled: false, reason: "triage_refused" };
      // Settles in the background, like the investigation below.
      void completeSreIncidentTriage(triage, triageInput).catch((error) => logger.error({ error, incidentId: input.incidentId }, "Automatic triage failed after it started"));
      return { handled: true };
    }

    try {
      await assertCanStartSreInvestigation(input.organizationId);
    } catch {
      return { handled: false, reason: "billing" };
    }
    const started = await startSreIncidentInvestigation({ ...input, enableLiveConnectors: false, origin: "auto" });
    if (!started.success) return { handled: false, reason: started.status === 409 ? (started.reason ?? "already_running") : "not_started" };
    // Settles in the background, like the investigate API; billing is taken only on completion.
    void completeSreIncidentInvestigation(started.investigationRunId, started.incident, {
      ...input,
      enableLiveConnectors: false,
    }).catch((error) => logger.error({ error, incidentId: input.incidentId }, "Automatic investigation failed after it started"));
    return { handled: true };
  } catch (error) {
    logger.error({ error, incidentId: input.incidentId }, "Automatic investigation could not start");
    return { handled: false, reason: "error" };
  }
}
