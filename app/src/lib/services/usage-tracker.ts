/**
 * Usage Tracker Service
 *
 * Tracks usage for billing purposes. This service is used by the Next.js app
 * for tracking:
 * - AI credits (local counter only - hard limit enforced, no overage billing)
 * - Playwright/K6 minutes (local counter only - worker handles Polar sync)
 *
 * ARCHITECTURE NOTE:
 * - AI usage: Uses atomic increment-and-check to prevent race conditions.
 *   No overage billing - users get a fixed quota per billing cycle.
 * - Playwright/K6: Local counter updated here, but Polar sync happens in the worker
 *   via UsageTrackerService which has direct access to execution timing.
 */

import { subscriptionService } from "./subscription-service";
import { isPolarEnabled } from "@/lib/feature-flags";
import { db } from "@/utils/db";
import { organization } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export class UsageTracker {
  /**
   * Track Playwright execution time
   * Updates local database counter only.
   *
   * NOTE: Polar sync is handled by the worker's UsageTrackerService
   * which has accurate execution timing from the actual test run.
   */
  async trackPlaywrightExecution(
    organizationId: string,
    executionTimeMs: number,
    metadata?: Record<string, unknown>
  ) {
    if (!organizationId || typeof organizationId !== "string") {
      console.error("[UsageTracker] Invalid organizationId for Playwright tracking");
      return;
    }

    const minutes = Math.ceil(executionTimeMs / 1000 / 60);

    // Update local database counter
    await subscriptionService.trackPlaywrightUsage(organizationId, minutes);
  }

  /**
   * Track K6 load testing execution
   * Updates local database counter only.
   *
   * NOTE: Polar sync is handled by the worker's UsageTrackerService
   * which has accurate VU and duration data from the actual test run.
   */
  async trackK6Execution(
    organizationId: string,
    virtualUsers: number,
    durationMs: number,
    metadata?: Record<string, unknown>
  ) {
    if (!organizationId || typeof organizationId !== "string") {
      console.error("[UsageTracker] Invalid organizationId for K6 tracking");
      return;
    }

    // Calculate VU minutes: ceil(VUs * duration in minutes)
    const durationMinutes = durationMs / 1000 / 60;
    const vuMinutes = Math.ceil(virtualUsers * durationMinutes);

    // Update local database counter
    await subscriptionService.trackK6Usage(organizationId, vuMinutes);
  }

  /**
   * Track monitor execution (counts as Playwright minutes)
   * Monitors are Playwright tests that run on a schedule.
   */
  async trackMonitorExecution(
    organizationId: string,
    executionTimeMs: number,
    metadata?: Record<string, unknown>
  ) {
    await this.trackPlaywrightExecution(organizationId, executionTimeMs, {
      type: "monitor",
      ...metadata,
    });
  }

  /**
   * Track AI credit usage
   * Each AI action (fix, create, analyze) consumes 1 credit.
   *
   * NOTE: This only updates the local counter for display purposes.
   * AI credits have a HARD LIMIT - no overage billing.
   * Use consumeAICredit() instead for atomic limit enforcement.
   */
  async trackAIUsage(
    organizationId: string,
    actionType: "ai_fix" | "ai_create" | "ai_analyze",
    metadata?: Record<string, unknown>
  ) {
    if (!organizationId || typeof organizationId !== "string") {
      console.error("[UsageTracker] Invalid organizationId for AI tracking");
      return;
    }

    const credits = 1; // Each AI action costs 1 credit

    // Update local database counter
    await subscriptionService.trackAIUsage(organizationId, credits);
  }

  /**
   * Atomically consume an AI credit and check if within limit
   *
   * This method solves the TOCTOU (Time-Of-Check-To-Time-Of-Use) race condition
   * by using atomic database operations:
   * 1. Increment the counter first
   * 2. Check if we're over the limit
   * 3. If over, rollback the increment
   *
   * This ensures that concurrent requests cannot bypass the limit.
   *
   * @returns { allowed: true } if credit was consumed successfully
   * @returns { allowed: false, reason: string } if limit exceeded (no credit consumed)
   */
  async consumeAICredit(
    organizationId: string,
    actionType: "ai_fix" | "ai_create" | "ai_analyze"
  ): Promise<{ allowed: boolean; reason?: string; used?: number; limit?: number }> {
    // Validate input
    if (!organizationId || typeof organizationId !== "string") {
      console.error("[UsageTracker] Invalid organizationId for consumeAICredit");
      return { allowed: true }; // Fail open for invalid input
    }

    // Self-hosted mode - unlimited AI credits, no tracking needed
    if (!isPolarEnabled()) {
      return { allowed: true };
    }

    try {
      // Step 1: Get the plan limits first (we need this for the limit check)
      const plan = await subscriptionService.getOrganizationPlan(organizationId);
      const limit = plan.aiCreditsIncluded;

      // Step 2: Atomically increment and get new value
      const result = await db
        .update(organization)
        .set({
          aiCreditsUsed: sql`COALESCE(${organization.aiCreditsUsed}, 0) + 1`,
        })
        .where(eq(organization.id, organizationId))
        .returning({ aiCreditsUsed: organization.aiCreditsUsed });

      if (!result.length) {
        console.error(`[UsageTracker] Organization not found: ${organizationId.slice(0, 8)}...`);
        return { allowed: true }; // Fail open if org not found
      }

      const used = result[0].aiCreditsUsed ?? 1;

      // Step 3: Check if we exceeded the limit
      if (used > limit) {
        // Over limit - rollback the increment
        await db
          .update(organization)
          .set({
            aiCreditsUsed: sql`GREATEST(COALESCE(${organization.aiCreditsUsed}, 0) - 1, 0)`,
          })
          .where(eq(organization.id, organizationId));

        return {
          allowed: false,
          reason: `You've used all ${limit} AI credits included in your ${plan.plan} plan this month. Credits reset at the start of your next billing cycle.`,
          used: used - 1, // Return the actual used count (before our failed attempt)
          limit,
        };
      }

      // Success - credit was consumed
      return { allowed: true, used, limit };
    } catch (error) {
      // Fail open - allow AI usage if we can't check the limit
      console.error("[UsageTracker] Failed to consume AI credit:", error);
      return { allowed: true };
    }
  }

  /**
   * Check if AI credits limit has been reached (read-only check)
   *
   * WARNING: This is a non-atomic check. For enforcement, use consumeAICredit() instead.
   * This method is useful for displaying usage info in the UI.
   */
  async checkAICreditsLimit(
    organizationId: string
  ): Promise<{ allowed: boolean; reason?: string; used?: number; limit?: number }> {
    // Validate input
    if (!organizationId || typeof organizationId !== "string") {
      console.error("[UsageTracker] Invalid organizationId for checkAICreditsLimit");
      return { allowed: true }; // Fail open for invalid input
    }

    if (!isPolarEnabled()) {
      // Self-hosted mode - unlimited AI credits
      return { allowed: true };
    }

    try {
      const plan = await subscriptionService.getOrganizationPlan(organizationId);
      const usage = await subscriptionService.getUsage(organizationId);

      const used = usage.aiCredits.used;
      const limit = plan.aiCreditsIncluded;

      if (used >= limit) {
        return {
          allowed: false,
          reason: `You've used all ${limit} AI credits included in your ${plan.plan} plan this month. Credits reset at the start of your next billing cycle.`,
          used,
          limit,
        };
      }

      return { allowed: true, used, limit };
    } catch (error) {
      // Fail open - allow AI usage if we can't check the limit
      console.error("[UsageTracker] Failed to check AI credits limit:", error);
      return { allowed: true };
    }
  }
}

// Export singleton instance
export const usageTracker = new UsageTracker();
