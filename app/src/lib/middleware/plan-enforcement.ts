import { NextResponse } from "next/server";
import { getExecutionPolicy } from "@/lib/execution/execution-policy";
/**
 * Plan Enforcement Middleware
 * Enforces subscription plan limits and quotas
 */

import { subscriptionService } from "@/lib/services/subscription-service";
import { isPolarEnabled } from "@/lib/feature-flags";
import { db } from "@/utils/db";
import { monitors, organization, statusPages } from "@/db/schema";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { EXTRA_MEMBER_PRICE_CENTS, MAX_MEMBER_SEATS, effectiveMemberLimit } from "@/lib/billing/member-seats";
import { notInDeletedProject, withPlanLimitLock, PlanLimitBusyError, type PlanLimitTransaction } from "@/lib/middleware/plan-limit-lock";

/** The messages `getOrganizationPlan` throws for an organization's own subscription state; safe to show to it. */
const SUBSCRIPTION_STATE_ERRORS = [
  /^No active subscription\b/,
  /^Organization not found\b/,
  /^Invalid subscription plan\b/,
];

/**
 * How a plan is named to the user. A trial reports `plan: "plus"` so its limits flow through the same checks,
 * but the organization is on a free trial, not the Plus plan.
 */
function planLabel(plan: { id: string; plan: string }): string {
  return plan.id === "trial" ? "free trial" : `${plan.plan} plan`;
}

/** The plan that lifts the limit: Plus for a trial (which has none yet), Pro for Plus, nothing above that. */
function upgradeFrom(plan: { id: string; plan: string }): "plus" | "pro" | undefined {
  if (plan.id === "trial") return "plus";
  return plan.plan === "plus" ? "pro" : undefined;
}

/**
 * Check if organization can create additional monitors
 * Returns error if limit exceeded
 */
export async function checkMonitorLimit(
  organizationId: string,
  currentCount: number
) {
  if (!isPolarEnabled()) {
    // Unlimited for self-hosted
    return { allowed: true };
  }

  // Check if organization has active subscription (cloud mode)
  try {
    const plan = await subscriptionService.getOrganizationPlan(organizationId);

    if (currentCount >= plan.maxMonitors) {
      return {
        allowed: false,
        error: `Monitor limit reached. Your ${planLabel(plan)} allows ${plan.maxMonitors} monitors. Please upgrade to add more.`,
        limit: plan.maxMonitors,
        currentCount,
        currentPlan: plan.plan,
        upgrade: upgradeFrom(plan),
      };
    }

    return {
      allowed: true,
      limit: plan.maxMonitors,
      currentCount,
      remaining: plan.maxMonitors - currentCount,
      currentPlan: plan.plan,
    };
  } catch (error) {
    // No active subscription
    return {
      allowed: false,
      error: error instanceof Error ? error.message : "Subscription required",
      requiresSubscription: true,
      availablePlans: ["plus", "pro"],
    };
  }
}

export async function checkCapacityLimits(organizationId: string) {
  const policy = await getExecutionPolicy(organizationId);
  return { runningCapacity: policy.runningCapacity, queuedCapacity: policy.queuedCapacity };
}

/**
 * Check usage limits for Playwright or K6 executions
 * Always allows execution but calculates overage charges
 */
export async function checkUsageLimit(
  organizationId: string,
  type: "playwright" | "k6",
  additionalUsage: number
) {
  if (!isPolarEnabled()) {
    // Unlimited for self-hosted
    return { allowed: true, overage: 0 };
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
  });

  if (!org) {
    throw new Error("Organization not found");
  }

  const plan = await subscriptionService.getOrganizationPlan(organizationId);

  if (type === "playwright") {
    const currentUsage = org.playwrightMinutesUsed || 0;
    const included = plan.playwrightMinutesIncluded;
    const totalUsage = currentUsage + additionalUsage;
    const overage = Math.max(0, totalUsage - included);

    return {
      allowed: true, // Always allowed, but may incur charges
      overage,
      currentUsage,
      included,
      willExceed: totalUsage > included,
      additionalUsage,
    };
  } else {
    const currentUsage = org.k6VuMinutesUsed || 0;
    const included = plan.k6VuMinutesIncluded;
    const totalUsage = currentUsage + additionalUsage;
    const overage = Math.max(0, totalUsage - included);

    return {
      allowed: true,
      overage,
      currentUsage,
      included,
      willExceed: totalUsage > included,
      additionalUsage,
    };
  }
}

/**
 * The monitors that count toward maxMonitors: not paused and not in a deleted project. Create, resume,
 * the usage display and the plan-cap sweep all count this same set.
 */
export async function countPlanMonitors(executor: PlanLimitTransaction | typeof db, organizationId: string): Promise<number> {
  const [row] = await executor.select({ count: sql<number>`count(*)` }).from(monitors).where(and(
    eq(monitors.organizationId, organizationId), ne(monitors.status, "paused"), isNull(monitors.deletingAt), notInDeletedProject(monitors.projectId)));
  return Number(row?.count ?? 0);
}

/**
 * Switching a paused monitor or an unpublished status page back on must stay within the plan. A plan
 * downgrade pauses and archives what exceeds it (lib/billing/plan-caps.ts); without this check the
 * owner could turn it straight back on. Counts only active monitors and published pages.
 * Not race-free on its own: use withResumeWithinPlan to run the check and the write under the plan-limit lock.
 * Monitors count when not paused (create, resume and the cap sweep all count the same way); a disabled
 * monitor is a paused one (the routes keep `enabled` and `status` in step), so it frees its slot.
 */
export async function checkResumeWithinPlan(
  organizationId: string,
  resource: "monitor" | "status_page",
  options: { executor?: PlanLimitTransaction | typeof db; plan?: Awaited<ReturnType<typeof subscriptionService.getOrganizationPlan>> } = {},
): Promise<{ allowed: true } | { allowed: false; error: string; limit: number; upgrade?: "plus" | "pro" }> {
  if (!isPolarEnabled()) return { allowed: true };
  const plan = options.plan ?? await subscriptionService.getOrganizationPlan(organizationId);
  const executor = options.executor ?? db;
  const count = resource === "monitor"
    ? await countPlanMonitors(executor, organizationId)
    : Number((await executor.select({ count: sql<number>`count(*)` }).from(statusPages).where(and(
        eq(statusPages.organizationId, organizationId), eq(statusPages.status, "published"), notInDeletedProject(statusPages.projectId))))[0]?.count ?? 0);
  const limit = resource === "monitor" ? plan.maxMonitors : plan.maxStatusPages;
  if (count < limit) return { allowed: true };
  const noun = resource === "monitor" ? "active monitors" : "published status pages";
  const action = resource === "monitor" ? "Pause or delete another monitor" : "Unpublish or delete another status page";
  return {
    allowed: false,
    error: `Your ${planLabel(plan)} allows ${limit} ${noun}. ${action}, or upgrade, to turn this one back on.`,
    limit,
    upgrade: upgradeFrom(plan),
  };
}

type ResumeDenied = Extract<Awaited<ReturnType<typeof checkResumeWithinPlan>>, { allowed: false }>;
export type ResumeOutcome<T> = { ok: true; value: T } | { ok: false; denied: ResumeDenied } | { ok: false; busy: true };

/**
 * Runs `write` (a resume or publish of `targetId`) only if the plan still has a slot, serialized with every
 * other create/resume of the same resource in the organization (same lock as insertWithinPlanLimit). The
 * target's status is read under the lock: one that another request already turned on takes no new slot, so
 * a simultaneous duplicate is not refused. `write` must use the `tx` it is given. `busy` means the lock
 * could not be taken in time.
 */
export async function withResumeWithinPlan<T>(
  organizationId: string,
  resource: "monitor" | "status_page",
  targetId: string,
  write: (tx: PlanLimitTransaction) => Promise<T>,
  /** Runs under the lock when the target is paused (a pre-lock read may have missed a concurrent pause); a throw aborts the resume. */
  whenPaused?: () => Promise<void>,
): Promise<ResumeOutcome<T>> {
  // Resolve the plan before taking the lock: it needs its own pool connection.
  const plan = isPolarEnabled() ? await subscriptionService.getOrganizationPlan(organizationId) : undefined;
  try {
    return await withPlanLimitLock(organizationId, resource === "monitor" ? "monitors" : "status_pages", async (tx) => {
      const [current] = resource === "monitor"
        ? await tx.select({ status: monitors.status }).from(monitors).where(eq(monitors.id, targetId))
        : await tx.select({ status: statusPages.status }).from(statusPages).where(eq(statusPages.id, targetId));
      const alreadyOn = resource === "monitor" ? current?.status !== "paused" : current?.status === "published";
      if (resource === "monitor" && current?.status === "paused") await whenPaused?.();
      if (current && !alreadyOn) {
        const cap = await checkResumeWithinPlan(organizationId, resource, { executor: tx, plan });
        if (!cap.allowed) return { ok: false as const, denied: cap };
      }
      return { ok: true as const, value: await write(tx) };
    });
  } catch (error) {
    if (error instanceof PlanLimitBusyError) return { ok: false, busy: true };
    throw error;
  }
}

/** The response for a resume the plan refused or could not serialize; null when it went through. */
export function resumeRefusalResponse(outcome: ResumeOutcome<unknown>): NextResponse | null {
  if (outcome.ok) return null;
  if ("busy" in outcome) {
    return NextResponse.json({ error: "Too many concurrent requests. Please retry shortly." }, { status: 503, headers: { "Retry-After": "2" } });
  }
  const { denied } = outcome;
  return NextResponse.json({ error: denied.error, code: "plan_limit", limit: denied.limit, upgrade: denied.upgrade }, { status: 403 });
}

/** Thrown by code that cannot return a response itself (the monitor update service). */
export class ResumeRefusedError extends Error {
  constructor(readonly outcome: Exclude<ResumeOutcome<unknown>, { ok: true }>) {
    super("Resume refused by the plan limit");
  }
}

export async function checkStatusPageLimit(
  organizationId: string,
  currentCount: number
) {
  if (!isPolarEnabled()) {
    return { allowed: true };
  }

  try {
    const plan = await subscriptionService.getOrganizationPlan(organizationId);

    if (currentCount >= plan.maxStatusPages) {
      return {
        allowed: false,
        error: `Status page limit reached. Your ${planLabel(plan)} allows ${plan.maxStatusPages} status pages.`,
        limit: plan.maxStatusPages,
        currentCount,
      };
    }

    return {
      allowed: true,
      limit: plan.maxStatusPages,
      currentCount,
      remaining: plan.maxStatusPages - currentCount,
    };
  } catch (error) {
    return {
      allowed: false,
      error: error instanceof Error ? error.message : "Subscription required",
      requiresSubscription: true,
      availablePlans: ["plus", "pro"],
    };
  }
}

/**
 * Check if organization can add more team members
 */
export async function checkTeamMemberLimit(
  organizationId: string,
  currentCount: number
) {
  if (!isPolarEnabled()) {
    return { allowed: true };
  }

  try {
    const plan = await subscriptionService.getOrganizationPlan(organizationId);
    const [org] = plan.plan === "pro"
      ? await db.select({ memberUnits: organization.memberUnits }).from(organization)
        .where(eq(organization.id, organizationId)).limit(1)
      : [];
    const limit = effectiveMemberLimit(plan, org?.memberUnits);

    if (currentCount >= limit) {
      const next = plan.plan !== "pro" ? ""
        : limit >= MAX_MEMBER_SEATS
          ? ` Need more than ${MAX_MEMBER_SEATS} members? Contact us at hello@supercheck.io.`
          : ` The organization owner can add member seats on the Subscription tab of Organization Admin ($${EXTRA_MEMBER_PRICE_CENTS / 100} per extra member per month, up to ${MAX_MEMBER_SEATS} members).`;
      return {
        allowed: false,
        error: `Team member limit reached. Your ${planLabel(plan)} allows ${limit} team members.${next}`,
        limit,
        currentCount,
      };
    }

    return {
      allowed: true,
      limit,
      currentCount,
      remaining: limit - currentCount,
      // Seats can be lowered while an invitation waits for the members lock; read them again under it.
      limitInLock: plan.plan !== "pro" ? undefined : async (tx: PlanLimitTransaction) => {
        const [locked] = await tx.select({ memberUnits: organization.memberUnits }).from(organization)
          .where(eq(organization.id, organizationId)).limit(1);
        return effectiveMemberLimit(plan, locked?.memberUnits);
      },
    };
  } catch (error) {
    return {
      allowed: false,
      error: error instanceof Error ? error.message : "Subscription required",
      requiresSubscription: true,
      availablePlans: ["plus", "pro"],
    };
  }
}

/**
 * Check if organization can create more projects
 */
export async function checkProjectLimit(
  organizationId: string,
  currentCount: number
) {
  if (!isPolarEnabled()) {
    return { allowed: true };
  }

  try {
    const plan = await subscriptionService.getOrganizationPlan(organizationId);

    if (currentCount >= plan.maxProjects) {
      return {
        allowed: false,
        error: `Project limit reached. Your ${planLabel(plan)} allows ${plan.maxProjects} projects.`,
        limit: plan.maxProjects,
        currentCount,
      };
    }

    return {
      allowed: true,
      limit: plan.maxProjects,
      currentCount,
      remaining: plan.maxProjects - currentCount,
    };
  } catch (error) {
    return {
      allowed: false,
      error: error instanceof Error ? error.message : "Subscription required",
      requiresSubscription: true,
      availablePlans: ["plus", "pro"],
    };
  }
}

/**
 * Check if a status page can accept more subscribers
 * Limits are per status page, not per organization
 */
export async function checkSubscriberLimit(
  organizationId: string,
  currentSubscriberCount: number
) {
  if (!isPolarEnabled()) {
    // Unlimited for self-hosted
    return { allowed: true };
  }

  try {
    const plan = await subscriptionService.getOrganizationPlan(organizationId);

    if (currentSubscriberCount >= plan.maxStatusPageSubscribers) {
      return {
        allowed: false,
        error: `Subscriber limit reached. Your ${planLabel(plan)} allows ${plan.maxStatusPageSubscribers} subscribers per status page. Please upgrade to add more.`,
        limit: plan.maxStatusPageSubscribers,
        currentCount: currentSubscriberCount,
        currentPlan: plan.plan,
        upgrade: upgradeFrom(plan),
      };
    }

    return {
      allowed: true,
      limit: plan.maxStatusPageSubscribers,
      currentCount: currentSubscriberCount,
      remaining: plan.maxStatusPageSubscribers - currentSubscriberCount,
      currentPlan: plan.plan,
    };
  } catch (error) {
    return {
      allowed: false,
      error: error instanceof Error ? error.message : "Subscription required",
      requiresSubscription: true,
      availablePlans: ["plus", "pro"],
    };
  }
}

/**
 * Check if a feature is available for the organization's plan
 */
export async function checkFeatureAvailability(
  organizationId: string,
  feature: "customDomains"
): Promise<{ available: boolean; error?: string }> {
  if (!isPolarEnabled()) {
    return { available: true };
  }

  let plan;
  try {
    plan = await subscriptionService.getOrganizationPlan(organizationId);
  } catch (error) {
    // No active subscription or trial (for example an ended trial): say so, instead of letting the failure
    // surface as an unexpected error. Only these known conditions are described to the caller; any other
    // failure (a database or driver error can carry query text) is rethrown, as before.
    if (error instanceof Error && SUBSCRIPTION_STATE_ERRORS.some((known) => known.test(error.message))) {
      return { available: false, error: error.message };
    }
    throw error;
  }

  const available = plan[feature];

  if (!available) {
    return {
      available: false,
      error: `Custom domains are not available on your ${planLabel(plan)}. Please upgrade to use them.`,
    };
  }

  return { available: true };
}
