import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";

import { jobs, monitors, runs, sreAlertEvents, sreIncidentAlerts, sreIncidents, sreInvestigationRuns } from "@/db/schema";
import { createLogger } from "@/lib/logger/index";
import { recoverableTrigger } from "@/lib/sre/incident-lifecycle";
import { isSreBackgroundAlertTriageEnabled } from "@/sre/lib/feature-gates";
import {
  handleSourceRecovery,
  sourceRecoveredSince,
  startAutomaticIncidentTriage,
} from "@/sre/lib/background-alert-triage";
import { STALE_RUN_AFTER_MS, failStaleSreInvestigationRunsForIncident } from "@/sre/lib/stale-run-recovery";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-incident-sweep" }) as {
  warn: (data: unknown, message?: string) => void;
  error: (data: unknown, message?: string) => void;
};

// Per branch and tick. Candidates are filtered in SQL and picked in random order, so ones a gate keeps refusing
// (billing, AI config, org cap) cannot permanently crowd out the rest.
const BATCH = 25;
// Wall-clock budget per tick (the job lock is 120 s), split so slow recovery work cannot starve re-triage;
// remaining candidates wait for the next tick.
const TICK_BUDGET_MS = 60_000;
// Only recent incidents are swept: a first deploy or a long outage must not mass-resolve, and so mass-notify,
// months-old incidents (those are left for their owners), and re-triage must not spend credits on old ones.
const RECOVERY_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
// Only recent incidents are re-triaged: a late-enabled gate must not spend AI credits on old ones.
const RETRIAGE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

type AlertConfig = { autoResolveIncident?: boolean; recoveryThreshold?: number } | null;
type SourceType = "monitor" | "job";

/**
 * Safety net for two signals that can be lost: the worker's recovery enqueue (Redis down for all retries)
 * and a detached AI triage run killed by an app restart. Runs on the incident re-notify tick; a
 * transaction advisory lock makes a second replica skip the tick. The lock holds one pooled connection, so the
 * tick stops at a wall-clock budget well under the 120 s job lock instead of running unbounded.
 */
export async function sweepSreIncidents(now = new Date()) {
  if (!isSreBackgroundAlertTriageEnabled()) return { skipped: "disabled" as const };
  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(7311, hashtext('sre-incident-sweep')) AS locked`,
    );
    if (!lock?.locked) return { skipped: "locked" as const };
    // One branch failing must not starve the other.
    // Two-key form: a separate lock space from the single-key organization locks.
    const reconciled = await reconcileRecoveries(now, Date.now() + TICK_BUDGET_MS / 2).catch((error) => {
      logger.error({ error }, "Incident recovery reconcile failed");
      return 0;
    });
    const retriaged = await retriageStaleRuns(now, Date.now() + TICK_BUDGET_MS / 2).catch((error) => {
      logger.error({ error }, "Incident re-triage failed");
      return 0;
    });
    return { reconciled, retriaged };
  });
}

// Necessary conditions (the exact recovery check is sourceRecoveredSince): open, automatically created (never by a person),
// unacknowledged (an acknowledged incident stays open for its owner, so the worker signal alone leaves its note), trigger source in the same org/project, one-check recovery threshold, autoResolve not off.
const openAutomaticIncident = (alertConfig: typeof monitors.alertConfig | typeof jobs.alertConfig, sourceType: SourceType, now: Date) =>
  and(
    ne(sreIncidents.status, "resolved"),
    isNull(sreIncidents.createdByUserId),
    isNull(sreIncidents.acknowledgedAt),
    gte(sreIncidents.lastAlertAt, new Date(now.getTime() - RECOVERY_MAX_AGE_MS)),
    eq(sreIncidentAlerts.role, "trigger"),
    recoverableTrigger(),
    eq(sreAlertEvents.organizationId, sreIncidents.organizationId),
    eq(sreAlertEvents.projectId, sreIncidents.projectId),
    eq(sreAlertEvents.sourceType, sourceType),
    sql`${alertConfig}->>'autoResolveIncident' is distinct from 'false'`,
    sql`(${alertConfig}->>'recoveryThreshold' is null or ${alertConfig}->>'recoveryThreshold' in ('0', '1'))`,
  );

type RecoveryCandidate = {
  organizationId: string;
  projectId: string;
  sourceType: SourceType;
  sourceId: string;
  name: string;
  alertConfig: AlertConfig;
  lastAlertAt: Date;
};

const latestAlertAt = sql<string>`max(${sreIncidents.lastAlertAt})`;

async function findRecoveryCandidates(now: Date): Promise<RecoveryCandidate[]> {
  const monitorRows = await db
    .select({
      organizationId: monitors.organizationId,
      projectId: monitors.projectId,
      sourceId: monitors.id,
      name: monitors.name,
      alertConfig: monitors.alertConfig,
      lastAlertAt: latestAlertAt,
    })
    .from(sreIncidents)
    .innerJoin(sreIncidentAlerts, eq(sreIncidentAlerts.incidentId, sreIncidents.id))
    .innerJoin(sreAlertEvents, eq(sreAlertEvents.id, sreIncidentAlerts.alertEventId))
    .innerJoin(
      monitors,
      and(
        eq(monitors.id, sreAlertEvents.sourceId),
        eq(monitors.organizationId, sreIncidents.organizationId),
        eq(monitors.projectId, sreIncidents.projectId),
      ),
    )
    .where(
      and(
        openAutomaticIncident(monitors.alertConfig, "monitor", now),
        eq(monitors.status, "up"),
      ),
    )
    .groupBy(monitors.id)
    // Actionable only if every open incident of the source alerted before the recovery.
    .having(sql`max(${sreIncidents.lastAlertAt}) < ${monitors.lastStatusChangeAt}`)
    .orderBy(sql`random()`)
    .limit(BATCH);
  const jobRows = await db
    .select({
      organizationId: jobs.organizationId,
      projectId: jobs.projectId,
      sourceId: jobs.id,
      name: jobs.name,
      alertConfig: jobs.alertConfig,
      lastAlertAt: latestAlertAt,
    })
    .from(sreIncidents)
    .innerJoin(sreIncidentAlerts, eq(sreIncidentAlerts.incidentId, sreIncidents.id))
    .innerJoin(sreAlertEvents, eq(sreAlertEvents.id, sreIncidentAlerts.alertEventId))
    .innerJoin(
      jobs,
      and(
        eq(jobs.id, sreAlertEvents.sourceId),
        eq(jobs.organizationId, sreIncidents.organizationId),
        eq(jobs.projectId, sreIncidents.projectId),
      ),
    )
    .where(
      and(
        openAutomaticIncident(jobs.alertConfig, "job", now),
      ),
    )
    .groupBy(jobs.id)
    .having(sql`(select r.status from ${runs} r where r.job_id = ${jobs.id} and r.completed_at > max(${sreIncidents.lastAlertAt}) order by r.completed_at desc limit 1) = 'passed'`)
    .orderBy(sql`random()`)
    .limit(BATCH);
  return [
    ...monitorRows.map((row) => ({ ...row, sourceType: "monitor" as const })),
    ...jobRows.map((row) => ({ ...row, sourceType: "job" as const })),
  ].flatMap((row) =>
    row.organizationId && row.projectId
      ? [{ ...row, organizationId: row.organizationId, projectId: row.projectId, lastAlertAt: new Date(row.lastAlertAt) }]
      : [],
  );
}

/** Resolves open incidents whose source recovered after their latest alert, as the worker's lost signal would have. */
export async function reconcileRecoveries(now = new Date(), deadline = Infinity): Promise<number> {
  let count = 0;
  for (const source of await findRecoveryCandidates(now)) {
    if (Date.now() > deadline) break;
    // The same rules as the worker signal; no streak can be proven from stored state, so a longer threshold is left to it.
    if ((source.alertConfig?.recoveryThreshold ?? 1) > 1 || source.alertConfig?.autoResolveIncident === false) continue;
    try {
      // Source still down, or a failure newer than its recovery: null, nothing is touched.
      const recoveredAt = await sourceRecoveredSince(source.sourceType, source.sourceId, source.lastAlertAt);
      if (!recoveredAt) continue;
      const recovery = await handleSourceRecovery({
        organizationId: source.organizationId,
        projectId: source.projectId,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        targetName: source.name,
        autoResolve: true,
        recoveredAt,
        // Deterministic per recovery, so a repeat dedupes its notification.
        discriminator: `${source.sourceType}:${source.sourceId}:${recoveredAt.toISOString()}:sweep`,
      });
      count += recovery.resolved.length;
    } catch (error) {
      logger.error({ error, sourceId: source.sourceId }, "Incident recovery reconcile failed for a source");
    }
  }
  return count;
}

type RunRow = { origin: "auto" | "manual"; status: string; startedAt: Date; errorCode: string | null };

/** Retry exactly once: the only automatic run died stale, and nothing else completed or is still alive. */
export function shouldRetriage(runRows: RunRow[], now: Date) {
  const auto = runRows.filter((run) => run.origin === "auto");
  if (auto.length !== 1 || auto[0].status !== "failed" || auto[0].errorCode !== "stale_run") return false;
  return !runRows.some(
    (run) => run.status === "completed" || (run.status === "running" && run.startedAt.getTime() > now.getTime() - STALE_RUN_AFTER_MS),
  );
}

/** Starts automatic triage once more for open incidents whose only automatic run was failed as stale. */
export async function retriageStaleRuns(now = new Date(), deadline = Infinity): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_RUN_AFTER_MS).toISOString();
  // Starts from the small set of open, recent, automatic incidents and reaches runs only per incident (a LATERAL
  // aggregate cannot be flattened into a runs-first join), so sre_investigation_runs_incident_id_idx serves it.
  // Per incident: exactly one automatic run, it failed stale (or is a dead "running" one), and no completed or live run.
  const incidents = await db.execute<{ id: string; organizationId: string; projectId: string }>(sql`
    select i.id, i.organization_id as "organizationId", i.project_id as "projectId"
    from ${sreIncidents} i
    cross join lateral (
      select
        count(*) filter (where r.origin = 'auto') as autos,
        bool_or(r.origin = 'auto' and (
          (r.status = 'failed' and r.agent_state_snapshot->>'errorCode' = 'stale_run')
          or (r.status = 'running' and r.started_at < ${cutoff}::timestamptz))) as stale,
        bool_or(r.status = 'completed' or (r.status = 'running' and r.started_at >= ${cutoff}::timestamptz)) as busy
      from ${sreInvestigationRuns} r
      where r.incident_id = i.id and r.organization_id = i.organization_id and r.project_id = i.project_id
    ) s
    where i.status <> 'resolved'
      and i.created_by_user_id is null
      and i.created_at >= ${new Date(now.getTime() - RETRIAGE_MAX_AGE_MS).toISOString()}::timestamptz
      and s.autos = 1 and coalesce(s.stale, false) and not coalesce(s.busy, false)
    order by random()
    limit ${BATCH}`);

  let count = 0;
  for (const incident of incidents) {
    if (Date.now() > deadline) break;
    const scope = { organizationId: incident.organizationId, projectId: incident.projectId, incidentId: incident.id };
    try {
      // Fails a still-"running" dead run so it frees its slot, then re-reads under the same org/project scope.
      await failStaleSreInvestigationRunsForIncident(scope);
      const rows = await db
        .select({
          origin: sreInvestigationRuns.origin,
          status: sreInvestigationRuns.status,
          startedAt: sreInvestigationRuns.startedAt,
          errorCode: sql<string | null>`${sreInvestigationRuns.agentStateSnapshot}->>'errorCode'`,
        })
        .from(sreInvestigationRuns)
        .where(
          and(
            eq(sreInvestigationRuns.incidentId, incident.id),
            eq(sreInvestigationRuns.organizationId, incident.organizationId),
            eq(sreInvestigationRuns.projectId, incident.projectId),
          ),
        );
      if (!shouldRetriage(rows, now)) continue;
      // Same gates as the alert job: auto-investigate policy, automation flag, AI config, billing, org run cap.
      const started = await startAutomaticIncidentTriage(scope);
      if (!started.skipped && started.success) count += 1;
      else if (!started.skipped) logger.warn({ incidentId: incident.id }, "Incident re-triage could not start");
    } catch (error) {
      logger.error({ error, incidentId: incident.id }, "Incident re-triage failed for an incident");
    }
  }
  return count;
}
