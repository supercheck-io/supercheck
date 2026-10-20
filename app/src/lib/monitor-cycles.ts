/**
 * Durable monitor check cycles (issue #452).
 *
 * With MISSING_CYCLE_CLOSURE_ENABLED=true the app persists a cycle descriptor, the
 * configured-region snapshot and an absolute deadline BEFORE publishing regional jobs.
 * The cycle id doubles as the executionGroupId, so results need no new column. A separate
 * control-plane process closes the cycle (at quorum or at the deadline) and owns notification.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { monitorCycles } from "@/db/schema";
import type { LocationConfig } from "@/db/schema";

const DEFAULT_DEADLINE_SECONDS = 180;
const MIN_DEADLINE_SECONDS = 30;
const MAX_DEADLINE_SECONDS = 900;

export type MonitorCyclePolicy = {
  strategy: "all" | "any" | "majority";
  threshold: number;
};

export type MonitorCycleRequest = {
  /** Stable key (scheduler job id) so a retry of the same scheduled cycle reuses one cycle. */
  key?: string;
  /** Every configured region, including ones that could not be published to. */
  configuredLocations: string[];
  policy: MonitorCyclePolicy;
  /** Abort the persisted cycle when publication fails (false while the scheduler will retry). */
  abortOnFailure: boolean;
};

export function missingCycleClosureEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.MISSING_CYCLE_CLOSURE_ENABLED === "true";
}

export function missingCycleDeadlineMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number.parseInt(env.MISSING_CYCLE_DEADLINE_SECONDS ?? "", 10);
  const seconds = Number.isFinite(raw) ? raw : DEFAULT_DEADLINE_SECONDS;
  return (
    Math.min(MAX_DEADLINE_SECONDS, Math.max(MIN_DEADLINE_SECONDS, seconds)) *
    1000
  );
}

/** BullMQ job ids may not contain ":", so the key is hashed into a safe, bounded id. */
export function monitorCycleId(monitorId: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 20);
  return `${monitorId}-c${digest}`;
}

/** Same defaults as the worker's LocationService.calculateAggregatedStatus. */
export function monitorCyclePolicy(
  locationConfig: LocationConfig | null | undefined,
): MonitorCyclePolicy {
  const enabled = Boolean(
    locationConfig?.enabled && locationConfig.locations?.length,
  );
  if (!enabled) return { strategy: "all", threshold: 100 };
  return {
    strategy: locationConfig!.strategy ?? "majority",
    threshold:
      typeof locationConfig!.threshold === "number"
        ? locationConfig!.threshold
        : 50,
  };
}

/** Idempotent: a retry of the same cycle id returns the existing row untouched. */
export async function persistMonitorCycle(input: {
  id: string;
  monitorId: string;
  configuredLocations: string[];
  policy: MonitorCyclePolicy;
  now?: Date;
  deadlineMs?: number;
}): Promise<{ created: boolean }> {
  const now = input.now ?? new Date();
  const rows = await db
    .insert(monitorCycles)
    .values({
      id: input.id,
      monitorId: input.monitorId,
      scheduledFor: now,
      deadlineAt: new Date(
        now.getTime() + (input.deadlineMs ?? missingCycleDeadlineMs()),
      ),
      expectedLocations: Array.from(new Set(input.configuredLocations)),
      strategy: input.policy.strategy,
      threshold: input.policy.threshold,
    })
    .onConflictDoNothing({ target: monitorCycles.id })
    .returning({ id: monitorCycles.id });
  return { created: rows.length > 0 };
}

/** Publication failed for good: the cycle must never be closed as missing-region downtime. */
export async function abortMonitorCycle(id: string): Promise<void> {
  await db
    .update(monitorCycles)
    .set({ status: "aborted", closedAt: new Date() })
    .where(and(eq(monitorCycles.id, id), eq(monitorCycles.status, "open")));
}
