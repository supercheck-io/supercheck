import { eq } from "drizzle-orm";
import { executionEntitlements } from "@/db/schema";
import { db } from "@/utils/db";
import { isCloudHosted, isPolarEnabled } from "@/lib/feature-flags";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";

export class ExecutionWorkloadError extends Error {
  constructor(message: string, readonly status: 400 | 402 = 400) { super(message); this.name = "ExecutionWorkloadError"; }
}

interface ExecutionCapacity {
  runningCapacity: number;
  queuedCapacity: number;
}
export type ExecutionPolicy = ExecutionCapacity & (
  | { tier: "paid"; priority: 0 }
  | { tier: "trial"; priority: 1; expiresAt: Date; k6MaxVus: number; playwrightRemainingMs: number }
);

export async function getExecutionPolicy(organizationId: string): Promise<ExecutionPolicy> {
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
      await subscriptionService.blockUntilSubscribed(organizationId);
      await subscriptionService.requireValidPolarCustomer(organizationId);
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
    playwrightRemainingMs: Math.max(0, trial.playwrightBudgetMs - trial.playwrightUsedMs),
  };
}

export async function assertExecutionWorkload(
  organizationId: string, policy: ExecutionPolicy, kind: "playwright" | "k6", scripts: string[],
): Promise<void> {
  if (policy.tier !== "trial") return;
  if (kind === "playwright") {
    if (policy.playwrightRemainingMs <= 0) throw new ExecutionWorkloadError("Trial browser execution quota exhausted", 402);
    return;
  }
  const { parseTrialK6Workload } = await import("./trial-k6-workload");
  const { requireVerifiedTarget, TargetDomainError } = await import("./target-domain-registry");
  if (scripts.length !== 1) throw new ExecutionWorkloadError("Trials accept one generated HTTP workload per run");
  let workload;
  try { workload = parseTrialK6Workload(scripts[0]); }
  catch (error) { throw new ExecutionWorkloadError(error instanceof Error ? error.message : "Invalid trial HTTP workload"); }
  if (workload.vus > policy.k6MaxVus || workload.durationSeconds * 1000 > policy.expiresAt.getTime() - Date.now()) {
    throw new ExecutionWorkloadError("HTTP workload exceeds the trial VU or remaining duration limit");
  }
  try { await requireVerifiedTarget(organizationId, new URL(workload.url).hostname); }
  catch (error) {
    if (error instanceof TargetDomainError) throw new ExecutionWorkloadError(error.message);
    throw error;
  }
}
