/**
 * Usage Tracker Service
 *
 * Tracks AI credit usage for billing purposes. This service is used by the
 * Next.js app for enforcing AI credit limits with atomic operations.
 *
 * ARCHITECTURE NOTE:
 * - AI usage: Uses atomic increment-and-check to prevent TOCTOU race conditions.
 *   No overage billing - users get a fixed quota per billing cycle.
 * - Playwright/K6 usage tracking and Polar sync are handled entirely by the
 *   worker's UsageTrackerService, which has direct access to execution timing.
 */

import { subscriptionService } from "./subscription-service";
import { isPolarEnabled } from "@/lib/feature-flags";
import { db } from "@/utils/db";
import { organization } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

export class UsageTracker {
  /**
   * Atomically consume an AI credit and check if within limit
   *
   * This method uses a single atomic SQL statement to prevent TOCTOU race conditions.
   * The increment only happens if the current value is below the limit.
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
      // Get the plan limits first
      const plan = await subscriptionService.getOrganizationPlan(organizationId);
      const limit = plan.aiCreditsIncluded;

      // ATOMIC: Increment only if under limit by putting the condition in WHERE.
      // If the WHERE doesn't match (already at/above limit), no rows are returned,
      // giving us a clear signal that the limit was reached without consuming a credit.
      const result = await db
        .update(organization)
        .set({
          aiCreditsUsed: sql`COALESCE(${organization.aiCreditsUsed}, 0) + 1`,
        })
        .where(
          and(
            eq(organization.id, organizationId),
            sql`COALESCE(${organization.aiCreditsUsed}, 0) < ${limit}`
          )
        )
        .returning({ aiCreditsUsed: organization.aiCreditsUsed });

      if (result.length > 0) {
        // Credit consumed successfully
        return { allowed: true, used: result[0].aiCreditsUsed ?? 0, limit };
      }

      // No rows updated — either org not found or limit reached.
      // Query current usage to distinguish and provide accurate feedback.
      const current = await db
        .select({ aiCreditsUsed: organization.aiCreditsUsed })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1);

      if (!current.length) {
        console.error(`[UsageTracker] Organization not found: ${organizationId.slice(0, 8)}...`);
        return { allowed: true }; // Fail open if org not found
      }

      const used = current[0].aiCreditsUsed ?? 0;
      return {
        allowed: false,
        reason: `You've used all ${limit} AI credits included in your ${plan.plan} plan this month. Credits reset at the start of your next billing cycle.`,
        used,
        limit,
      };
    } catch (error) {
      // Fail open - allow AI usage if we can't check the limit
      console.error("[UsageTracker] Failed to consume AI credit:", error);
      return { allowed: true };
    }
  }
}

// Export singleton instance
export const usageTracker = new UsageTracker();
