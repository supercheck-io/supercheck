import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";

import { sreInvestigationRuns } from "@/db/schema";
import { createLogger } from "@/lib/logger/index";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-stale-run-recovery" }) as {
  error: (data: unknown, msg?: string) => void;
};

// An investigation is capped at 90s of agent time (120s hard limit); a run
// still "running" well past that lost its process (crash, deploy, restart).
export const STALE_RUN_AFTER_MS = 5 * 60_000;

const staleRunPatch = () => ({
  status: "failed" as const,
  completedAt: sql`now()`,
  durationMs: sql<number>`LEAST(2147483647, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - ${sreInvestigationRuns.startedAt})) * 1000)))::integer`,
  agentStateSnapshot: {
    mode: "sre_investigation_recovery",
    error: "Investigation did not finish. Try again.",
    errorCode: "stale_run",
  },
});

const staleRunsWhere = () =>
  // Database clock, like completedAt below, so replicas with skewed clocks agree on staleness.
  and(eq(sreInvestigationRuns.status, "running"), lt(sreInvestigationRuns.startedAt, sql`now() - make_interval(secs => ${STALE_RUN_AFTER_MS / 1000})`));

/**
 * Releases the one-active-run reservation of a run whose process died, so the
 * incident can be investigated again. Conditional on status and age so a live
 * run is never touched. Failed runs are never billed.
 */
export async function failStaleSreInvestigationRunsForIncident(input: {
  organizationId: string;
  projectId: string;
  incidentId: string;
}) {
  const recovered = await db
    .update(sreInvestigationRuns)
    .set(staleRunPatch())
    .where(
      and(
        eq(sreInvestigationRuns.organizationId, input.organizationId),
        eq(sreInvestigationRuns.projectId, input.projectId),
        eq(sreInvestigationRuns.incidentId, input.incidentId),
        staleRunsWhere(),
      ),
    )
    .returning({ id: sreInvestigationRuns.id });
  if (recovered.length > 0) {
    logger.error(
      { ...input, recoveredRunIds: recovered.map((run) => run.id) },
      "Recovered stale SRE investigation run",
    );
  }
}

/**
 * Periodic sweep: fails up to `limit` stale "running" runs of any origin, so a manual run killed with its app pod does
 * not stay "running" until someone opens the incident. Same age and status guard as above. Only incident runs, so the
 * filter implies the partial active-run index instead of scanning the whole run history every tick.
 */
export async function failStaleSreRuns(limit = 100): Promise<number> {
  const stale = db
    .select({ id: sreInvestigationRuns.id })
    .from(sreInvestigationRuns)
    .where(and(staleRunsWhere(), isNotNull(sreInvestigationRuns.incidentId)))
    .limit(limit);
  const recovered = await db
    .update(sreInvestigationRuns)
    .set(staleRunPatch())
    // Re-check the guard: a run that finished between the subquery and the update is left alone.
    .where(and(inArray(sreInvestigationRuns.id, stale), staleRunsWhere()))
    .returning({ id: sreInvestigationRuns.id });
  if (recovered.length > 0) {
    logger.error({ recoveredRunIds: recovered.map((run) => run.id) }, "Recovered stale SRE runs in sweep");
  }
  return recovered.length;
}

// The active-run index, and the automatic-run index (a second automatic run for the same incident).
const ACTIVE_INCIDENT_RUN_CONSTRAINTS = [
  "sre_investigation_runs_active_incident_unique",
  "sre_investigation_runs_auto_incident_unique",
];

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
      (ACTIVE_INCIDENT_RUN_CONSTRAINTS.includes(dbError.constraint ?? "") ||
        ACTIVE_INCIDENT_RUN_CONSTRAINTS.includes(dbError.constraint_name ?? ""))
    ) {
      return true;
    }
    current = dbError.cause;
  }
  return false;
}
