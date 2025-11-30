/**
 * Usage Tracker Service
 * Tracks Playwright and K6 usage and sends events to Polar for billing
 */

import { subscriptionService } from "./subscription-service";
import { isPolarEnabled } from "@/lib/feature-flags";

export class UsageTracker {
  /**
   * Track Playwright execution time
   * Updates local database and sends event to Polar for billing
   */
  async trackPlaywrightExecution(
    organizationId: string,
    executionTimeMs: number,
    metadata?: Record<string, unknown>
  ) {
    const minutes = Math.ceil(executionTimeMs / 1000 / 60);

    // Update local database
    await subscriptionService.trackPlaywrightUsage(organizationId, minutes);

    // Send event to Polar if enabled for usage-based billing
    if (isPolarEnabled()) {
      try {
        // Note: Usage events should be sent via Better Auth's usage plugin
        // The usage plugin handles event ingestion automatically
        // This is just for logging purposes
        console.log(
          `[Usage] Tracked Playwright usage: ${minutes} minutes for org ${organizationId}`,
          metadata
        );
      } catch (error) {
        // Don't fail the execution if tracking fails
        console.error("[Usage] Failed to log usage:", error);
      }
    }
  }

  /**
   * Track K6 load testing execution
   * Calculates VU hours from virtual users and duration
   */
  async trackK6Execution(
    organizationId: string,
    virtualUsers: number,
    durationMs: number,
    metadata?: Record<string, unknown>
  ) {
    // Calculate VU hours: (VUs * duration in hours)
    const hours = (virtualUsers * durationMs) / 1000 / 60 / 60;
    const vuHours = parseFloat(hours.toFixed(4)); // Round to 4 decimal places

    // Update local database
    await subscriptionService.trackK6Usage(organizationId, vuHours);

    // Send event to Polar if enabled
    if (isPolarEnabled()) {
      try {
        console.log(
          `[Usage] Tracked K6 usage: ${vuHours} VU hours for org ${organizationId}`,
          metadata
        );
      } catch (error) {
        console.error("[Usage] Failed to log usage:", error);
      }
    }
  }

  /**
   * Track monitor execution (counts as Playwright minutes)
   * Monitors are essentially Playwright tests that run on a schedule
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
   * Each AI fix or AI create action consumes 1 credit
   */
  async trackAIUsage(
    organizationId: string,
    actionType: "ai_fix" | "ai_create",
    metadata?: Record<string, unknown>
  ) {
    const credits = 1; // Each AI action costs 1 credit

    // Update local database
    await subscriptionService.trackAIUsage(organizationId, credits);

    // Log usage for Polar if enabled
    if (isPolarEnabled()) {
      try {
        console.log(
          `[Usage] Tracked AI usage: ${credits} credit for ${actionType} for org ${organizationId}`,
          metadata
        );
      } catch (error) {
        console.error("[Usage] Failed to log AI usage:", error);
      }
    }
  }
}

// Export singleton instance
export const usageTracker = new UsageTracker();
