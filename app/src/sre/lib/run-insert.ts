import { and, count, eq, gt, sql } from "drizzle-orm";

import { sreInvestigationRuns } from "@/db/schema";
import { STALE_RUN_AFTER_MS } from "@/sre/lib/stale-run-recovery";
import type { db } from "@/utils/db";

// An outage opening many incidents must not start that many LLM runs at once and overshoot the daily token limit.
export const MAX_AUTO_RUNNING_PER_ORG = 3;
// People can run more at once, but not without bound: the daily token cap is checked before a run, not reserved.
export const MAX_MANUAL_RUNNING_PER_ORG = 10;

export class SreOrgConcurrencyError extends Error {
  constructor(origin: "auto" | "manual" = "auto") {
    super(
      origin === "auto"
        ? "Automatic investigation skipped: organization concurrency limit"
        : `Too many AI runs are in progress in this organization (limit ${MAX_MANUAL_RUNNING_PER_ORG}). Try again when one finishes.`,
    );
    this.name = "SreOrgConcurrencyError";
  }
}

/**
 * Inserts a run row, admitted only while fewer than the cap of the organization's runs are in flight: 3 for an
 * automatic run, 10 for a manual one. Both count every running run and are counted and inserted under the same
 * organization lock, so simultaneous starts across incidents cannot all pass. The transaction covers only this
 * insert, never the run itself (no pooled connection is held across the LLM call).
 */
export async function insertSreRun(
  database: Pick<typeof db, "transaction">,
  values: typeof sreInvestigationRuns.$inferInsert,
) {
  const origin = values.origin === "auto" ? "auto" : "manual";
  const cap = origin === "auto" ? MAX_AUTO_RUNNING_PER_ORG : MAX_MANUAL_RUNNING_PER_ORG;
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
    if (running >= cap) throw new SreOrgConcurrencyError(origin);
    return tx.insert(sreInvestigationRuns).values(values).returning();
  });
}
