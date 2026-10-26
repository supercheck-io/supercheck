import { and, eq, isNull, sql } from "drizzle-orm";
import { executionEntitlements, executionReservations } from "@/db/schema";
import { db } from "@/utils/db";
import { isCloudHosted, isPolarEnabled } from "@/lib/feature-flags";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";

export class ExecutionWorkloadError extends Error {
  constructor(message: string, readonly status: 400 | 402 | 503 = 400,
    // True when the run would be admitted if in-flight reservations were released: queued promotion keeps it waiting.
    readonly inFlightOnly = false) { super(message); this.name = "ExecutionWorkloadError"; }
}

interface ExecutionCapacity {
  runningCapacity: number;
  queuedCapacity: number;
}
export type ExecutionPolicy = ExecutionCapacity & (
  | { tier: "paid"; priority: 0 }
  | { tier: "trial"; priority: 1; expiresAt: Date; k6MaxVus: number; k6RemainingVuMs: number; playwrightRemainingMs: number }
);

// One request resolves the policy several times (route, enqueue, slot reservation, promotion), and each
// resolution runs several queries and can call the billing provider. The queue processor promotes every
// 5 seconds for every organization with waiting runs, so the TTL has to outlast that interval or the cache
// is always cold on the very path it exists for. Entitlements are still checked fresh when a run reserves
// time in the worker, so a change takes effect for admission within this window. Failures are never cached.
export const POLICY_TTL_MS = 30_000;
const policyCache = new Map<string, { policy: ExecutionPolicy; expires: number }>();

export function clearExecutionPolicyCache(): void {
  policyCache.clear();
}

export async function getExecutionPolicy(organizationId: string): Promise<ExecutionPolicy> {
  const cached = policyCache.get(organizationId);
  if (cached && cached.expires > Date.now()) return cached.policy;
  const policy = Object.freeze(await resolveExecutionPolicy(organizationId)) as ExecutionPolicy;
  policyCache.set(organizationId, { policy, expires: Date.now() + POLICY_TTL_MS });
  if (policyCache.size > 1000) for (const [key, entry] of policyCache) if (entry.expires <= Date.now()) policyCache.delete(key);
  return policy;
}

async function resolveExecutionPolicy(organizationId: string): Promise<ExecutionPolicy> {
  if (!isCloudHosted()) {
    let capacity: ExecutionCapacity = { runningCapacity: 5, queuedCapacity: 50 };
    if (!process.env.RUNNING_CAPACITY && !process.env.QUEUED_CAPACITY) {
      try { capacity = await subscriptionService.getOrganizationPlan(organizationId); } catch { /* Preserve local defaults when no plan is configured. */ }
    }
    return {
      tier: "paid", priority: 0,
      runningCapacity: process.env.RUNNING_CAPACITY ? Number.parseInt(process.env.RUNNING_CAPACITY, 10) : capacity.runningCapacity,
      queuedCapacity: process.env.QUEUED_CAPACITY ? Number.parseInt(process.env.QUEUED_CAPACITY, 10) : capacity.queuedCapacity,
    };
  }
  if (isPolarEnabled()) {
    try {
      // Paid access only: a trial is resolved separately below.
      await subscriptionService.blockUntilSubscribed(organizationId, { allowTrial: false });
      await subscriptionService.requireValidPolarCustomer(organizationId, { allowTrial: false });
      const plan = await subscriptionService.getOrganizationPlan(organizationId);
      return { tier: "paid", priority: 0, runningCapacity: plan.runningCapacity, queuedCapacity: plan.queuedCapacity };
    } catch (error) {
      if (!(error instanceof SubscriptionAccessDeniedError)) throw error;
    }
  }
  const trial = await db.query.executionEntitlements.findFirst({ where: eq(executionEntitlements.organizationId, organizationId) });
  if (!trial || !Number.isFinite(trial.expiresAt.getTime()) || trial.expiresAt.getTime() <= Date.now()) {
    throw new ExecutionWorkloadError("Execution entitlement required or trial expired", 402);
  }
  return {
    tier: "trial", priority: 1, runningCapacity: trial.runningCapacity, queuedCapacity: trial.queuedCapacity,
    expiresAt: trial.expiresAt, k6MaxVus: trial.k6MaxVus,
    k6RemainingVuMs: Math.max(0, trial.k6BudgetVuMs - trial.k6UsedVuMs),
    playwrightRemainingMs: Math.max(0, trial.playwrightBudgetMs - trial.playwrightUsedMs),
  };
}

/**
 * Allowance left right now, read fresh and net of in-flight reservations exactly as worker admission
 * computes it. The cached policy knows neither a reservation taken since it was cached nor a change of
 * usage, so the quota answer must not come from it.
 */
async function freshTrialRemaining(organizationId: string) {
  const entitlement = await db.query.executionEntitlements.findFirst({ where: eq(executionEntitlements.organizationId, organizationId) });
  // Mirrors worker admission: an expired entitlement has no allowance.
  if (!entitlement || entitlement.expiresAt.getTime() <= Date.now()) throw new ExecutionWorkloadError("Execution entitlement required or trial expired", 402);
  const [held] = await db
    .select({
      playwrightHeldMs: sql<number>`coalesce(sum(case when ${executionReservations.kind} = 'playwright' then ${executionReservations.reservedMs} else 0 end),0)::bigint`,
      k6HeldVuMs: sql<number>`coalesce(sum(case when ${executionReservations.kind} = 'k6' then ${executionReservations.reservedMs} * ${executionReservations.vus} else 0 end),0)::bigint`,
    })
    .from(executionReservations)
    .where(and(
      eq(executionReservations.organizationId, organizationId),
      isNull(executionReservations.finishedAt),
      sql`${executionReservations.leaseExpiresAt} > now()`,
    ));
  const playwrightHeldMs = Number(held.playwrightHeldMs);
  const k6HeldVuMs = Number(held.k6HeldVuMs);
  return {
    playwrightRemainingMs: entitlement.playwrightBudgetMs - entitlement.playwrightUsedMs - playwrightHeldMs,
    k6RemainingVuMs: entitlement.k6BudgetVuMs - entitlement.k6UsedVuMs - k6HeldVuMs,
    playwrightHeldMs, k6HeldVuMs,
  };
}

/**
 * Trials run the same Playwright workloads as paid plans, and k6 trials keep
 * their generated HTTP workload so the VU-ms allowance can be metered exactly.
 * Neither path asks for domain ownership: the cluster egress policy remains the
 * network boundary.
 */
export async function assertExecutionWorkload(
  organizationId: string, policy: ExecutionPolicy, kind: "playwright" | "k6", scripts: string[],
): Promise<void> {
  if (policy.tier !== "trial") return;
  const remaining = await freshTrialRemaining(organizationId);
  if (kind === "playwright") {
    if (remaining.playwrightRemainingMs <= 0) {
      throw new ExecutionWorkloadError("Trial browser execution quota exhausted", 402, remaining.playwrightRemainingMs + remaining.playwrightHeldMs > 0);
    }
    return;
  }
  const { parseTrialK6Workload } = await import("./trial-k6-workload");
  if (scripts.length !== 1) throw new ExecutionWorkloadError("Trials accept one generated HTTP workload per run");
  let workload;
  try { workload = parseTrialK6Workload(scripts[0]); }
  catch (error) { throw new ExecutionWorkloadError(error instanceof Error ? error.message : "Invalid trial HTTP workload"); }
  if (workload.vus > policy.k6MaxVus || workload.durationSeconds * 1000 > policy.expiresAt.getTime() - Date.now()) {
    throw new ExecutionWorkloadError("HTTP workload exceeds the trial VU or remaining duration limit");
  }
  const needed = workload.vus * workload.durationSeconds * 1000;
  if (needed > remaining.k6RemainingVuMs) {
    throw new ExecutionWorkloadError("Trial load-testing allowance exhausted", 402, needed <= remaining.k6RemainingVuMs + remaining.k6HeldVuMs);
  }
}
