import { and, eq, lt, sql } from "drizzle-orm";

import { sreInvestigationRuns } from "@/db/schema";
import { createLogger } from "@/lib/logger/index";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-stale-run-recovery" }) as {
  error: (data: unknown, msg?: string) => void;
};

// An investigation is capped at 90s of agent time (120s hard limit); a run
// still "running" well past that lost its process (crash, deploy, restart).
const STALE_RUN_AFTER_MS = 5 * 60_000;

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
    .set({
      status: "failed",
      completedAt: sql`now()`,
      durationMs: sql<number>`GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - ${sreInvestigationRuns.startedAt})) * 1000)::integer)`,
      agentStateSnapshot: {
        mode: "sre_investigation_recovery",
        error: "Investigation did not finish. Try again.",
        errorCode: "stale_run",
      },
    })
    .where(
      and(
        eq(sreInvestigationRuns.organizationId, input.organizationId),
        eq(sreInvestigationRuns.projectId, input.projectId),
        eq(sreInvestigationRuns.incidentId, input.incidentId),
        eq(sreInvestigationRuns.status, "running"),
        lt(sreInvestigationRuns.startedAt, new Date(Date.now() - STALE_RUN_AFTER_MS)),
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
