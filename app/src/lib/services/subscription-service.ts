/**
 * Subscription Service
 * Manages organization subscriptions, plan limits, and usage tracking
 */

import { db } from "@/utils/db";
import { organization, planLimits, type SubscriptionPlan } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { isPolarEnabled } from "@/lib/feature-flags";

export class SubscriptionService {
  /**
   * Check if organization requires an active subscription (cloud mode)
   * Returns false for self-hosted installations
   */
  requiresSubscription(): boolean {
    return isPolarEnabled(); // True in cloud mode, false in self-hosted
  }

  /**
   * Check if organization has an active paid subscription
   * Returns false if cloud mode and no subscription
   */
  async hasActiveSubscription(organizationId: string): Promise<boolean> {
    if (!isPolarEnabled()) {
      return true; // Self-hosted always has access
    }

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    if (!org) {
      return false;
    }

    // Check if subscription is active
    return (
      org.subscriptionPlan !== null &&
      org.subscriptionStatus === "active"
    );
  }

  /**
   * Get the subscription plan information for an organization
   * For cloud mode: returns actual plan or throws if no subscription (use getOrganizationPlanSafe for non-throwing version)
   * For self-hosted: always returns unlimited
   */
  async getOrganizationPlan(organizationId: string) {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    if (!org) {
      throw new Error("Organization not found");
    }

    // Self-hosted mode: always unlimited
    if (!isPolarEnabled()) {
      return this.getPlanLimits("unlimited");
    }

    // Cloud mode: require active subscription
    if (!org.subscriptionPlan || org.subscriptionStatus !== "active") {
      throw new Error(
        "No active subscription. Please subscribe to a plan to continue."
      );
    }

    return this.getPlanLimits(org.subscriptionPlan);
  }

  /**
   * Get the subscription plan information for an organization (non-throwing version)
   * Returns unlimited plan limits for unsubscribed cloud users (for display purposes)
   * Use this for billing/current endpoint to show usage even without subscription
   */
  async getOrganizationPlanSafe(organizationId: string) {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    if (!org) {
      throw new Error("Organization not found");
    }

    // Self-hosted mode: always unlimited
    if (!isPolarEnabled()) {
      return this.getPlanLimits("unlimited");
    }

    // Cloud mode: return actual plan if subscribed, otherwise return plus limits for display
    if (org.subscriptionPlan && org.subscriptionStatus === "active") {
      return this.getPlanLimits(org.subscriptionPlan);
    }

    // Return plus plan limits for display purposes (user will see what they'd get)
    return this.getPlanLimits("plus");
  }

  /**
   * Get plan limit configuration for a specific plan
   * Falls back to unlimited if plan not found
   */
  async getPlanLimits(plan: SubscriptionPlan): Promise<
typeof planLimits.$inferSelect> {
    const limits = await db.query.planLimits.findFirst({
      where: eq(planLimits.plan, plan),
    });

    if (!limits) {
      console.warn(
        `Plan limits not found for plan: ${plan}, falling back to unlimited`
      );
      // Fallback to unlimited
      return this.getPlanLimits("unlimited");
    }

    return limits;
  }

  /**
   * Update organization subscription information
   * Used by webhook handlers when subscription changes
   */
  async updateSubscription(
    organizationId: string,
    data: {
      subscriptionPlan?: SubscriptionPlan;
      subscriptionStatus?: "active" | "canceled" | "past_due" | "none";
      subscriptionId?: string;
      polarCustomerId?: string;
    }
  ) {
    await db
      .update(organization)
      .set({
        ...data,
      })
      .where(eq(organization.id, organizationId));
  }

  /**
   * Track Playwright execution minutes for an organization
   * Increments the usage counter for the current billing period
   */
  async trackPlaywrightUsage(organizationId: string, minutes: number) {
    if (!isPolarEnabled()) {
      // Don't track for self-hosted
      return;
    }

    await db
      .update(organization)
      .set({
        playwrightMinutesUsed: sql`COALESCE(${organization.playwrightMinutesUsed}, 0) + ${minutes}`,
      })
      .where(eq(organization.id, organizationId));
  }

  /**
   * Track K6 VU hours for an organization
   * Increments the usage counter for the current billing period
   */
  async trackK6Usage(organizationId: string, vuHours: number) {
    if (!isPolarEnabled()) {
      // Don't track for self-hosted
      return;
    }

    await db
      .update(organization)
      .set({
        k6VuHoursUsed: sql`COALESCE(${organization.k6VuHoursUsed}, 0) + ${vuHours}`,
      })
      .where(eq(organization.id, organizationId));
  }

  /**
   * Get current usage for an organization
   * Returns usage counters and plan limits
   */
  async getUsage(organizationId: string) {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    if (!org) {
      throw new Error("Organization not found");
    }

    const plan = await this.getOrganizationPlan(organizationId);

    return {
      playwrightMinutes: {
        used: org.playwrightMinutesUsed || 0,
        included: plan.playwrightMinutesIncluded,
        overage: Math.max(
          0,
          (org.playwrightMinutesUsed || 0) - plan.playwrightMinutesIncluded
        ),
      },
      k6VuHours: {
        used: org.k6VuHoursUsed || 0,
        included: plan.k6VuHoursIncluded,
        overage: Math.max(
          0,
          (org.k6VuHoursUsed || 0) - plan.k6VuHoursIncluded
        ),
      },
      periodStart: org.usagePeriodStart,
      periodEnd: org.usagePeriodEnd,
    };
  }

  /**
   * Get current usage for an organization (non-throwing version)
   * Uses safe plan lookup for unsubscribed users
   */
  async getUsageSafe(organizationId: string) {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    if (!org) {
      throw new Error("Organization not found");
    }

    const plan = await this.getOrganizationPlanSafe(organizationId);

    return {
      playwrightMinutes: {
        used: org.playwrightMinutesUsed || 0,
        included: plan.playwrightMinutesIncluded,
        overage: Math.max(
          0,
          (org.playwrightMinutesUsed || 0) - plan.playwrightMinutesIncluded
        ),
      },
      k6VuHours: {
        used: org.k6VuHoursUsed || 0,
        included: plan.k6VuHoursIncluded,
        overage: Math.max(
          0,
          (org.k6VuHoursUsed || 0) - plan.k6VuHoursIncluded
        ),
      },
      periodStart: org.usagePeriodStart,
      periodEnd: org.usagePeriodEnd,
    };
  }

  /**
   * Reset usage counters for a new billing period
   * Called when subscription renews or manually for testing
   */
  async resetUsageCounters(organizationId: string) {
    const now = new Date();
    // Set billing period to next month
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    await db
      .update(organization)
      .set({
        playwrightMinutesUsed: 0,
        k6VuHoursUsed: 0,
        usagePeriodStart: now,
        usagePeriodEnd: nextMonth,
      })
      .where(eq(organization.id, organizationId));
  }

  /**
   * Get effective plan for enforcement (with better error messaging)
   * Throws descriptive error for unsubscribed cloud users
   */
  async getEffectivePlan(organizationId: string) {
    try {
      return await this.getOrganizationPlan(organizationId);
    } catch (error) {
      if (error instanceof Error && error.message.includes("No active subscription")) {
        throw new Error(
          "Subscription required. Please upgrade to Plus or Pro to create resources."
        );
      }
      throw error;
    }
  }

  /**
   * Block execution if subscription is required but missing
   * Used in API routes before creating resources
   */
  async blockUntilSubscribed(organizationId: string): Promise<void> {
    if (!isPolarEnabled()) {
      return; // Self-hosted: no blocking
    }

    const hasSubscription = await this.hasActiveSubscription(organizationId);
    if (!hasSubscription) {
      throw new Error(
        "Active subscription required. Visit /billing to subscribe to Plus or Pro."
      );
    }
  }
}

// Export singleton instance
export const subscriptionService = new SubscriptionService();
