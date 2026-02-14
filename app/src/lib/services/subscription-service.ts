/**
 * Subscription Service
 * Manages organization subscriptions, plan limits, and usage tracking
 */

import { db } from "@/utils/db";
import { organization, planLimits, type SubscriptionPlan } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { isPolarEnabled, getPolarConfig } from "@/lib/feature-flags";

// Constants for configuration
const POLAR_API_TIMEOUT_MS = 5000; // 5 second timeout for Polar API calls
const CUSTOMER_VALIDATION_CACHE_TTL_MS = 60000; // 60 second cache TTL
const POLAR_SANDBOX_URL = "https://sandbox-api.polar.sh";
const POLAR_PRODUCTION_URL = "https://api.polar.sh";

// Fallback unlimited plan limits - extracted for maintainability
const FALLBACK_UNLIMITED_LIMITS = {
  id: "fallback-unlimited",
  plan: "unlimited" as const,
  maxMonitors: 999999,
  minCheckIntervalMinutes: 1,
  playwrightMinutesIncluded: 999999,
  k6VuMinutesIncluded: 999999,
  aiCreditsIncluded: 999999,
  runningCapacity: 999,
  queuedCapacity: 9999,
  maxTeamMembers: 999,
  maxOrganizations: 999,
  maxProjects: 999,
  maxStatusPages: 999,
  customDomains: true,
  ssoEnabled: true,
  dataRetentionDays: 30, // Raw monitor data: 30 days (high frequency)
  aggregatedDataRetentionDays: 180, // Aggregated metrics: 6 months max
  jobDataRetentionDays: 180, // Job runs: 6 months max for self-hosted
} as const;

// Blocked plan limits for deleted Polar customers
const BLOCKED_PLAN_LIMITS = {
  id: "blocked",
  plan: "unlimited" as const, // Show unlimited in UI but blocked in practice
  maxMonitors: 0,
  minCheckIntervalMinutes: 1,
  playwrightMinutesIncluded: 0,
  k6VuMinutesIncluded: 0,
  aiCreditsIncluded: 0,
  runningCapacity: 0,
  queuedCapacity: 0,
  maxTeamMembers: 0,
  maxOrganizations: 0,
  maxProjects: 0,
  maxStatusPages: 0,
  customDomains: false,
  ssoEnabled: false,
  dataRetentionDays: 0,
  aggregatedDataRetentionDays: 0,
  jobDataRetentionDays: 0,
} as const;

export class SubscriptionService {
  /**
   * Cache for Polar customer validation results
   * Prevents excessive API calls to Polar while maintaining security
   */
  private validationCache = new Map<
    string,
    { valid: boolean; timestamp: number }
  >();

  /**
   * Counter for cache accesses - triggers cleanup periodically
   */
  private cacheAccessCount = 0;

  /**
   * Clear expired cache entries (called periodically)
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.validationCache.entries()) {
      if (now - value.timestamp > CUSTOMER_VALIDATION_CACHE_TTL_MS) {
        this.validationCache.delete(key);
      }
    }
  }

  /**
   * Get Polar API URL based on environment
   */
  private getPolarApiUrl(server: string): string {
    return server === "sandbox" ? POLAR_SANDBOX_URL : POLAR_PRODUCTION_URL;
  }

  /**
   * Validate if Polar customer exists in Polar's system
   * Returns false if customer doesn't exist (does NOT auto-clear)
   * Implements caching to prevent excessive API calls
   */
  private async validatePolarCustomer(
    organizationId: string,
    polarCustomerId: string
  ): Promise<boolean> {
    if (!isPolarEnabled() || !polarCustomerId) {
      return true; // No validation needed if Polar disabled or no customer ID
    }

    // Check cache first
    const cacheKey = `${organizationId}:${polarCustomerId}`;
    const cached = this.validationCache.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.timestamp < CUSTOMER_VALIDATION_CACHE_TTL_MS
    ) {
      return cached.valid;
    }

    // Clean expired cache entries periodically (every 50 accesses or when size > 100)
    this.cacheAccessCount++;
    if (this.cacheAccessCount >= 50 || this.validationCache.size > 100) {
      this.cleanExpiredCache();
      this.cacheAccessCount = 0;
    }


    try {
      const config = getPolarConfig();
      if (!config) {
        console.warn("[SubscriptionService] Polar config not found");
        return false;
      }

      const polarUrl = this.getPolarApiUrl(config.server);

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        POLAR_API_TIMEOUT_MS
      );

      try {
        const response = await fetch(
          `${polarUrl}/v1/customers/${polarCustomerId}`,
          {
            headers: {
              Authorization: `Bearer ${config.accessToken}`,
              "Content-Type": "application/json",
            },
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        let isValid = false;
        if (response.ok) {
          isValid = true; // Customer exists in Polar
        } else if (response.status === 404) {
          console.warn(
            `[SubscriptionService] Polar customer not found (org: ${organizationId.substring(0, 8)}...)`
          );
          isValid = false;
        } else {
          console.error(
            `[SubscriptionService] Polar API error: ${response.status} (org: ${organizationId.substring(0, 8)}...)`
          );
          isValid = false;
        }

        // Cache the result
        this.validationCache.set(cacheKey, {
          valid: isValid,
          timestamp: Date.now(),
        });
        return isValid;
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    } catch (error) {
      // Handle timeout specifically
      if (error instanceof Error && error.name === "AbortError") {
        console.error(
          "[SubscriptionService] Polar API timeout - treating as invalid for safety"
        );
      } else {
        console.error(
          "[SubscriptionService] Error validating Polar customer:",
          error
        );
      }
      // Don't cache errors - allow retry on next request
      return false;
    }
  }

  /**
   * Block API operations if Polar customer doesn't exist
   * Use this middleware to protect resource creation endpoints
   */
  async requireValidPolarCustomer(organizationId: string): Promise<void> {
    if (!isPolarEnabled()) {
      return; // Self-hosted: no validation needed
    }

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    if (!org) {
      throw new Error("Organization not found");
    }

    // If no Polar customer ID, user needs to subscribe
    if (!org.polarCustomerId) {
      throw new Error(
        "No Polar customer found. Please subscribe to a plan to continue."
      );
    }

    // Validate customer exists in Polar
    const customerExists = await this.validatePolarCustomer(
      organizationId,
      org.polarCustomerId
    );
    if (!customerExists) {
      throw new Error(
        "Polar customer not found. Please contact support or subscribe to a new plan."
      );
    }
  }

  /**
   * Check if organization requires an active subscription (cloud mode)
   * Returns false for self-hosted installations
   */
  requiresSubscription(): boolean {
    return isPolarEnabled(); // True in cloud mode, false in self-hosted
  }

  /**
   * Check if organization has an active paid subscription
   * Returns false if cloud mode and no subscription or customer doesn't exist in Polar
   *
   * IMPORTANT: This handles the canceled subscription grace period:
   * - status === "active": Always has access
   * - status === "canceled": Has access until subscriptionEndsAt date
   * - status === "past_due": Has access (payment will be retried)
   * - status === "none" or null plan: No access
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

    // If we have a Polar customer ID, validate it exists
    if (org.polarCustomerId) {
      const customerExists = await this.validatePolarCustomer(
        organizationId,
        org.polarCustomerId
      );
      if (!customerExists) {
        // Customer doesn't exist in Polar
        return false;
      }
    }

    // Must have a plan to have access
    if (!org.subscriptionPlan) {
      return false;
    }

    // SECURITY: Reject unlimited plan in cloud mode
    // This prevents orgs created in self-hosted mode from having unlimited access
    // when the environment is switched to cloud mode
    if (org.subscriptionPlan === "unlimited") {
      console.error(
        `[SubscriptionService] SECURITY: hasActiveSubscription rejecting unlimited plan for org ${organizationId.substring(0, 8)}... in cloud mode`
      );
      return false;
    }

    // SECURITY: Only allow plus/pro plans in cloud mode
    if (!["plus", "pro"].includes(org.subscriptionPlan)) {
      console.error(
        `[SubscriptionService] SECURITY: hasActiveSubscription rejecting invalid plan ${org.subscriptionPlan} for org ${organizationId.substring(0, 8)}... in cloud mode`
      );
      return false;
    }

    // Check subscription status
    switch (org.subscriptionStatus) {
      case "active":
        // Active subscription - full access
        return true;

      case "canceled":
        // Canceled subscription - access until period end
        // User retains access until subscriptionEndsAt date
        if (org.subscriptionEndsAt) {
          const now = new Date();
          const endsAt = new Date(org.subscriptionEndsAt);
          return now < endsAt;
        }
        // If no end date set, default to no access (shouldn't happen normally)
        console.warn(
          `[SubscriptionService] Canceled subscription for org ${organizationId.substring(0, 8)}... has no end date`
        );
        return false;

      case "past_due":
        // Past due - still has access while payment is being retried
        // Polar will revoke if payment ultimately fails
        return true;

      case "none":
      default:
        // No subscription or unknown status
        return false;
    }
  }

  /**
   * Get the subscription plan information for an organization
   * For cloud mode: returns actual plan or throws if no subscription (use getOrganizationPlanSafe for non-throwing version)
   * For self-hosted: always returns unlimited
   *
   * IMPORTANT: This handles canceled subscriptions with grace period
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

    // SECURITY: Validate plan is legitimate for cloud mode FIRST
    // This catches tampered plans before checking subscription status
    if (org.subscriptionPlan === "unlimited") {
      console.error(
        `[SubscriptionService] SECURITY: Organization ${organizationId.substring(0, 8)}... has unlimited plan in cloud mode - possible database tampering`
      );
      throw new Error(
        "Invalid subscription plan detected. Please contact support."
      );
    }

    if (org.subscriptionPlan && !["plus", "pro"].includes(org.subscriptionPlan)) {
      console.error(
        `[SubscriptionService] SECURITY: Organization ${organizationId.substring(0, 8)}... has invalid plan ${org.subscriptionPlan} in cloud mode`
      );
      throw new Error(
        `Invalid subscription plan: ${org.subscriptionPlan}. Only plus and pro plans are available.`
      );
    }

    // Cloud mode: require subscription with valid access
    // This handles active, canceled (with grace period), and past_due
    const hasAccess = await this.hasActiveSubscription(organizationId);
    if (!org.subscriptionPlan || !hasAccess) {
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
   * Validates Polar customer existence but doesn't auto-clear
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

    // If we have a Polar customer ID, validate it exists
    if (org.polarCustomerId) {
      const customerExists = await this.validatePolarCustomer(
        organizationId,
        org.polarCustomerId
      );
      if (!customerExists) {
        // Customer doesn't exist in Polar, return blocked state for UI
        return this.getPlanLimits("blocked");
      }
    }

    // Cloud mode: return actual plan if subscribed and has access
    // Handle canceled subscriptions with grace period
    if (org.subscriptionPlan) {
      // SECURITY: Validate plan is legitimate for cloud mode BEFORE checking access
      // This catches tampered unlimited/invalid plans even if hasActiveSubscription returns false
      if (org.subscriptionPlan === "unlimited") {
        console.error(
          `[SubscriptionService] SECURITY: Organization ${organizationId.substring(0, 8)}... has unlimited plan in cloud mode (getOrganizationPlanSafe) - possible database tampering`
        );
        // Return blocked state instead of unlimited for security
        return this.getPlanLimits("blocked");
      }

      if (!["plus", "pro"].includes(org.subscriptionPlan)) {
        console.error(
          `[SubscriptionService] SECURITY: Organization ${organizationId.substring(0, 8)}... has invalid plan ${org.subscriptionPlan} in cloud mode (getOrganizationPlanSafe)`
        );
        // Return blocked state for invalid plans
        return this.getPlanLimits("blocked");
      }

      const hasAccess = await this.hasActiveSubscription(organizationId);

      if (hasAccess) {
        return this.getPlanLimits(org.subscriptionPlan);
      }
    }

    // Return plus plan limits for display purposes (user will see what they'd get)
    return this.getPlanLimits("plus");
  }

  /**
   * Get plan limit configuration for a specific plan
   * Falls back to unlimited if plan not found
   * Special handling for "blocked" plan when Polar customer doesn't exist
   */
  async getPlanLimits(
    plan: SubscriptionPlan | "blocked"
  ): Promise<typeof planLimits.$inferSelect> {
    // Handle special "blocked" plan for deleted Polar customers
    if (plan === "blocked") {
      return {
        ...BLOCKED_PLAN_LIMITS,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const limits = await db.query.planLimits.findFirst({
      where: eq(planLimits.plan, plan as SubscriptionPlan),
    });

    if (!limits) {
      if (isPolarEnabled()) {
        // Cloud mode: NEVER fall back to unlimited - this is a critical error
        console.error(
          `CRITICAL: Plan limits not found for plan: ${plan} in cloud mode. Database may not be seeded.`
        );
        throw new Error(
          `Plan limits not found for plan: ${plan}. Please contact support or ensure database is properly seeded.`
        );
      } else {
        // Self-hosted mode: fall back to unlimited (expected behavior)
        console.warn(
          `Plan limits not found for plan: ${plan} in self-hosted mode, falling back to unlimited`
        );
        // Fallback to extracted constants to prevent infinite recursion
        return {
          ...FALLBACK_UNLIMITED_LIMITS,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
    }

    return limits;
  }

  /**
   * Update subscription information for an organization
   * Used by webhook handlers when subscription changes
   * SECURITY: Validates that unlimited plans are only set in self-hosted mode
   */
  async updateSubscription(
    organizationId: string,
    data: {
      subscriptionPlan?: SubscriptionPlan | null;
      subscriptionStatus?: "active" | "canceled" | "past_due" | "none";
      subscriptionId?: string;
      polarCustomerId?: string;
      // Polar subscription billing period dates
      subscriptionStartedAt?: Date | null;
      subscriptionEndsAt?: Date | null;
    }
  ) {
    // SECURITY: Block unlimited plans in cloud mode
    if (isPolarEnabled() && data.subscriptionPlan === "unlimited") {
      console.error(
        `[SubscriptionService] SECURITY: Attempted to set unlimited plan in cloud mode for org ${organizationId.substring(0, 8)}...`
      );
      throw new Error("Unlimited plan is only available in self-hosted mode");
    }

    // SECURITY: Only allow plus/pro plans in cloud mode
    if (
      isPolarEnabled() &&
      data.subscriptionPlan &&
      !["plus", "pro"].includes(data.subscriptionPlan)
    ) {
      console.error(
        `[SubscriptionService] SECURITY: Invalid plan ${data.subscriptionPlan} attempted in cloud mode for org ${organizationId.substring(0, 8)}...`
      );
      throw new Error(
        `Invalid plan ${data.subscriptionPlan}. Only plus and pro plans are available in cloud mode.`
      );
    }

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
   * Track K6 VU minutes for an organization
   * Increments the usage counter for the current billing period
   */
  async trackK6Usage(organizationId: string, vuMinutes: number) {
    if (!isPolarEnabled()) {
      // Don't track for self-hosted
      return;
    }

    await db
      .update(organization)
      .set({
        k6VuMinutesUsed: sql`COALESCE(${organization.k6VuMinutesUsed}, 0) + ${vuMinutes}`,
      })
      .where(eq(organization.id, organizationId));
  }

  /**
   * Track AI credit usage for an organization
   * Each AI fix or AI create action consumes 1 credit
   */
  async trackAIUsage(organizationId: string, credits: number = 1) {
    if (!isPolarEnabled()) {
      // Don't track for self-hosted
      return;
    }

    await db
      .update(organization)
      .set({
        aiCreditsUsed: sql`COALESCE(${organization.aiCreditsUsed}, 0) + ${credits}`,
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
      k6VuMinutes: {
        used: org.k6VuMinutesUsed || 0,
        included: plan.k6VuMinutesIncluded,
        overage: Math.max(
          0,
          (org.k6VuMinutesUsed || 0) - plan.k6VuMinutesIncluded
        ),
      },
      aiCredits: {
        used: org.aiCreditsUsed || 0,
        included: plan.aiCreditsIncluded,
        overage: Math.max(0, (org.aiCreditsUsed || 0) - plan.aiCreditsIncluded),
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
      k6VuMinutes: {
        used: org.k6VuMinutesUsed || 0,
        included: plan.k6VuMinutesIncluded,
        overage: Math.max(
          0,
          (org.k6VuMinutesUsed || 0) - plan.k6VuMinutesIncluded
        ),
      },
      aiCredits: {
        used: org.aiCreditsUsed || 0,
        included: plan.aiCreditsIncluded,
        overage: Math.max(0, (org.aiCreditsUsed || 0) - plan.aiCreditsIncluded),
      },
      periodStart: org.usagePeriodStart,
      periodEnd: org.usagePeriodEnd,
    };
  }

  /**
   * Reset usage counters for a new billing period
   * Called when subscription renews or manually for testing
   * @deprecated Use resetUsageCountersWithDates instead for proper Polar billing
   */
  async resetUsageCounters(organizationId: string) {
    // Fetch organization to get subscription dates
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    if (org?.subscriptionStartedAt && org?.subscriptionEndsAt) {
      // Use existing Polar subscription dates
      await this.resetUsageCountersWithDates(
        organizationId,
        org.subscriptionStartedAt,
        org.subscriptionEndsAt
      );
    } else {
      // Fallback: calculate 30-day period from now (for testing or self-hosted)
      const now = new Date();
      const thirtyDaysLater = new Date(now);
      thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

      await db
        .update(organization)
        .set({
          playwrightMinutesUsed: 0,
          k6VuMinutesUsed: 0,
          aiCreditsUsed: 0,
          usagePeriodStart: now,
          usagePeriodEnd: thirtyDaysLater,
        })
        .where(eq(organization.id, organizationId));
    }
  }

  /**
   * Reset usage counters using Polar's subscription dates
   * This ensures billing period matches the actual subscription cycle
   * @param organizationId - Organization to reset
   * @param startsAt - Subscription period start from Polar (or null to use now)
   * @param endsAt - Subscription period end from Polar (or null to calculate 30 days)
   */
  async resetUsageCountersWithDates(
    organizationId: string,
    startsAt: Date | null,
    endsAt: Date | null
  ) {
    const now = new Date();

    // Use Polar dates if available, otherwise calculate defaults
    const periodStart = startsAt || now;

    // If no end date from Polar, calculate 30 days from start (monthly billing)
    let periodEnd: Date;
    if (endsAt) {
      periodEnd = endsAt;
    } else {
      periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + 30);
    }

    await db
      .update(organization)
      .set({
        playwrightMinutesUsed: 0,
        k6VuMinutesUsed: 0,
        aiCreditsUsed: 0,
        usagePeriodStart: periodStart,
        usagePeriodEnd: periodEnd,
        // Also update the subscription dates for reference
        subscriptionStartedAt: startsAt,
        subscriptionEndsAt: endsAt,
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
      if (
        error instanceof Error &&
        error.message.includes("No active subscription")
      ) {
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
