import { getExecutionPolicy } from "@/lib/execution/execution-policy";
/**
 * Plan Enforcement Middleware
 * Enforces subscription plan limits and quotas
 */

import { subscriptionService } from "@/lib/services/subscription-service";
import { isPolarEnabled } from "@/lib/feature-flags";
import { db } from "@/utils/db";
import { organization } from "@/db/schema";
import { eq } from "drizzle-orm";

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
 * Check if organization can create additional status pages
 */
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

    if (currentCount >= plan.maxTeamMembers) {
      return {
        allowed: false,
        error: `Team member limit reached. Your ${planLabel(plan)} allows ${plan.maxTeamMembers} team members.`,
        limit: plan.maxTeamMembers,
        currentCount,
      };
    }

    return {
      allowed: true,
      limit: plan.maxTeamMembers,
      currentCount,
      remaining: plan.maxTeamMembers - currentCount,
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
    // surface as an unexpected error.
    return {
      available: false,
      error: error instanceof Error ? error.message : "An active subscription is required to use this feature.",
    };
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
