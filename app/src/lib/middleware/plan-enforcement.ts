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
        error: `Monitor limit reached. Your ${plan.plan} plan allows ${plan.maxMonitors} monitors. Please upgrade to add more.`,
        limit: plan.maxMonitors,
        currentCount,
        currentPlan: plan.plan,
        upgrade: plan.plan === "plus" ? "pro" : undefined,
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

/**
 * Get capacity limits (running and queued) for an organization
 * Returns plan-specific limits or environment defaults for self-hosted
 */
export async function checkCapacityLimits(organizationId: string) {
  if (!isPolarEnabled()) {
    // Use environment defaults for self-hosted
    return {
      runningCapacity: parseInt(process.env.RUNNING_CAPACITY || "5"),
      queuedCapacity: parseInt(process.env.QUEUED_CAPACITY || "50"),
    };
  }

  const plan = await subscriptionService.getOrganizationPlan(organizationId);

  return {
    runningCapacity: plan.runningCapacity,
    queuedCapacity: plan.queuedCapacity,
  };
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
    const currentUsage = org.k6VuHoursUsed || 0;
    const included = plan.k6VuHoursIncluded;
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
        error: `Status page limit reached. Your ${plan.plan} plan allows ${plan.maxStatusPages} status pages.`,
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
        error: `Team member limit reached. Your ${plan.plan} plan allows ${plan.maxTeamMembers} team members.`,
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
        error: `Project limit reached. Your ${plan.plan} plan allows ${plan.maxProjects} projects.`,
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
 * Check if a feature is available for the organization's plan
 */
export async function checkFeatureAvailability(
  organizationId: string,
  feature: "customDomains" | "ssoEnabled"
): Promise<{ available: boolean; error?: string }> {
  if (!isPolarEnabled()) {
    return { available: true };
  }

  const plan = await subscriptionService.getOrganizationPlan(organizationId);

  const available = plan[feature];

  if (!available) {
    return {
      available: false,
      error: `This feature is not available on your ${plan.plan} plan. Please upgrade to access ${feature === "customDomains" ? "custom domains" : "SSO"}.`,
    };
  }

  return { available: true };
}
