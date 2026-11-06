import { and, count, eq, gt, sql } from "drizzle-orm";

import { sreInvestigationRuns } from "@/db/schema";
import { STALE_RUN_AFTER_MS } from "@/sre/lib/stale-run-recovery";
import type { db } from "@/utils/db";

// An outage opening many incidents must not start that many LLM runs at once and overshoot the daily token limit.
export const MAX_AUTO_RUNNING_PER_ORG = 3;

export class SreOrgConcurrencyError extends Error {
  constructor() {
    super("Automatic investigation skipped: organization concurrency limit");
    this.name = "SreOrgConcurrencyError";
  }
}

/**
 * Inserts a run row. An automatic run is admitted only while fewer than MAX_AUTO_RUNNING_PER_ORG runs of the
 * organization are in flight, counted and inserted under an organization lock so simultaneous opens across
 * incidents cannot all pass. The transaction covers only this insert, never the run itself (no pooled
 * connection is held across the LLM call). Manual runs are never capped here.
 */
export async function insertSreRun(
  database: Pick<typeof db, "insert" | "transaction">,
  values: typeof sreInvestigationRuns.$inferInsert,
) {
  if (values.origin !== "auto") return database.insert(sreInvestigationRuns).values(values).returning();
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sre-auto-run-cap:${values.organizationId}`}))`);
    // Runs past the stale age are dead, not in flight, so they do not hold a slot.
    const [{ running }] = await tx
      .select({ running: count() })
      .from(sreInvestigationRuns)
      .where(
        and(
          eq(sreInvestigationRuns.organizationId, values.organizationId),
          eq(sreInvestigationRuns.status, "running"),
          gt(sreInvestigationRuns.startedAt, new Date(Date.now() - STALE_RUN_AFTER_MS)),
        ),
      );
    if (running >= MAX_AUTO_RUNNING_PER_ORG) throw new SreOrgConcurrencyError();
    return tx.insert(sreInvestigationRuns).values(values).returning();
  });
}
