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

// A healthy region can legitimately take a while: queue wait, KEDA scale-from-zero, worker retries
// with backoff and the check's own timeout. The deadline therefore scales with the monitor timeout.
const DEFAULT_DEADLINE_SECONDS = 300;
const MIN_DEADLINE_SECONDS = 60;
const MAX_DEADLINE_SECONDS = 1800;
const DEFAULT_CHECK_TIMEOUT_SECONDS = 30;
const MAX_CHECK_TIMEOUT_SECONDS = 300;

export type MonitorCyclePolicy = {
  strategy: "all" | "any" | "majority";
  threshold: number;
};

export type MonitorCycleRequest = {
  /** Stable key (scheduler job id) so a retry of the same scheduled cycle reuses one cycle. */
  key?: string;
  /** Regions actually published to (live workers). Skipped regions are excluded so they are not counted missing. */
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

/** Check timeout used for the cycle deadline: synthetic checks run a whole Playwright test. */
export function monitorCheckTimeoutConfig(
  type: string,
  config: unknown,
  env: Record<string, string | undefined> = process.env,
): { timeoutSeconds?: number } | undefined {
  if (type !== "synthetic_test") return config as { timeoutSeconds?: number } | undefined;
  const testTimeoutMs = Number(env.TEST_EXECUTION_TIMEOUT_MS ?? 300000);
  return { timeoutSeconds: Number.isFinite(testTimeoutMs) && testTimeoutMs > 0 ? testTimeoutMs / 1000 : 300 };
}

/** Base grace (env, clamped) plus two check timeouts to cover a retry. */
export function missingCycleDeadlineMs(
  env: Record<string, string | undefined> = process.env,
  config?: { timeoutSeconds?: number } | null,
): number {
  const raw = Number.parseInt(env.MISSING_CYCLE_DEADLINE_SECONDS ?? "", 10);
  const base = Math.min(
    MAX_DEADLINE_SECONDS,
    Math.max(
      MIN_DEADLINE_SECONDS,
      Number.isFinite(raw) ? raw : DEFAULT_DEADLINE_SECONDS,
    ),
  );
  const timeout =
    typeof config?.timeoutSeconds === "number" && config.timeoutSeconds > 0
      ? Math.min(MAX_CHECK_TIMEOUT_SECONDS, config.timeoutSeconds)
      : DEFAULT_CHECK_TIMEOUT_SECONDS;
  return (base + 2 * timeout) * 1000;
}

/** BullMQ job ids may not contain ":", so the key is hashed into a safe, bounded id. */
export function monitorCycleId(monitorId: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 20);
  return `${monitorId}-c${digest}`;
}

/**
 * Multi-location monitors use the configured strategy with the same defaults as the worker's
 * LocationService.calculateAggregatedStatus. Without multi-location config the legacy path let
 * the first reported result decide; a cycle cannot depend on arrival order, so it uses "any":
 * the monitor is up when at least one resolved region reports up.
 */
export function monitorCyclePolicy(
  locationConfig: LocationConfig | null | undefined,
): MonitorCyclePolicy {
  const enabled = Boolean(
    locationConfig?.enabled && locationConfig.locations?.length,
  );
  if (!enabled) return { strategy: "any", threshold: 100 };
  return {
    strategy: locationConfig!.strategy ?? "majority",
    threshold:
      typeof locationConfig!.threshold === "number"
        ? locationConfig!.threshold
        : 50,
  };
}

export class MonitorCycleClosedError extends Error {
  constructor(readonly cycleId: string, readonly status: string) {
    super(`Monitor cycle ${cycleId} is already ${status}; refusing to publish into it`);
  }
}

/**
 * Idempotent: a retry of the same cycle id reuses the existing row untouched. Publishing into a
 * cycle that is no longer open would make every worker treat its result as diagnostic, so that
 * throws instead of publishing.
 */
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
  if (rows.length > 0) return { created: true };
  const [existing] = await db
    .select({ status: monitorCycles.status })
    .from(monitorCycles)
    .where(eq(monitorCycles.id, input.id))
    .limit(1);
  if (existing && existing.status !== "open") {
    throw new MonitorCycleClosedError(input.id, existing.status);
  }
  return { created: false };
}

/** Publication failed for good: the cycle must never be closed as missing-region downtime. */
export async function abortMonitorCycle(id: string): Promise<void> {
  await db
    .update(monitorCycles)
    .set({ status: "aborted", closedAt: new Date() })
    .where(and(eq(monitorCycles.id, id), eq(monitorCycles.status, "open")));
}
