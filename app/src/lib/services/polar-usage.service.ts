/**
 * Polar Usage Service
 * 
 * Handles usage metrics, spending limits, and Polar sync retry for billing:
 * - Usage metrics calculation (overage, costs)
 * - Spending limit enforcement (hard-stop checks)
 * - Batch retry of failed Polar event syncs (cron-driven)
 * 
 * ARCHITECTURE NOTE:
 * - The worker's UsageTrackerService handles real-time usage tracking and
 *   immediate Polar sync after each execution.
 * - This service provides: metrics queries, spending limit checks for
 *   API-level enforcement, and batch retry of failed syncs via cron.
 */

import { db } from "@/utils/db";
import {
  organization,
  usageEvents,
  billingSettings,
  overagePricing
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { isPolarEnabled, getPolarConfig } from "@/lib/feature-flags";
import type { Polar } from "@polar-sh/sdk";

export interface UsageMetrics {
  playwrightMinutes: {
    used: number;
    included: number;
    overage: number;
    overageCostCents: number;
    percentage: number;
  };
  k6VuMinutes: {
    used: number;
    included: number;
    overage: number;
    overageCostCents: number;
    percentage: number;
  };
  aiCredits: {
    used: number;
    included: number;
    overage: number;
    overageCostCents: number;
    percentage: number;
  };
  totalOverageCostCents: number;
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface SpendingStatus {
  currentSpendingCents: number;
  limitCents: number | null;
  limitEnabled: boolean;
  hardStopEnabled: boolean;
  percentageUsed: number;
  isAtLimit: boolean;
  remainingCents: number | null;
}

class PolarUsageService {
  private polarClient: InstanceType<typeof Polar> | null = null;

  /**
   * Initialize Polar client if enabled
   */
  private async getPolarClient() {
    if (!isPolarEnabled()) {
      return null;
    }

    if (this.polarClient) {
      return this.polarClient;
    }

    try {
      const { Polar } = await import("@polar-sh/sdk");
      const config = getPolarConfig();
      
      if (!config?.accessToken) {
        console.warn("[PolarUsage] No access token configured");
        return null;
      }

      this.polarClient = new Polar({
        accessToken: config.accessToken,
        server: config.server,
      });

      return this.polarClient;
    } catch (error) {
      console.error("[PolarUsage] Failed to initialize Polar client:", error);
      return null;
    }
  }

  /**
   * Sync a usage event to Polar using their Events Ingestion API
   * Uses Polar SDK's usage metering endpoint
   */
  private async syncEventToPolar(eventId: string): Promise<boolean> {
    try {
      const polar = await this.getPolarClient();
      if (!polar) {
        console.warn("[PolarUsage] Polar client not available, skipping sync");
        return false;
      }

      // Fetch the usage event
      const usageEvent = await db.query.usageEvents.findFirst({
        where: eq(usageEvents.id, eventId),
      });

      if (!usageEvent) {
        console.warn(`[PolarUsage] Event ${eventId} not found`);
        return false;
      }

      // Get organization with Polar customer ID
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, usageEvent.organizationId),
      });

      if (!org?.polarCustomerId) {
        console.warn(`[PolarUsage] No Polar customer ID for org ${usageEvent.organizationId}`);
        return false;
      }

      // Get the Polar config
      const config = getPolarConfig();
      if (!config?.accessToken) {
        console.warn("[PolarUsage] No Polar access token configured");
        return false;
      }

      // Determine the meter name based on event type
      // These meter names should match what's configured in Polar dashboard
      let meterName: string;
      if (usageEvent.eventType === 'k6_execution') {
        meterName = 'k6_vu_minutes';
      } else if (usageEvent.eventType === 'ai_usage') {
        meterName = 'ai_credits';
      } else {
        meterName = 'playwright_minutes';
      }

      // Use Polar's event ingestion API
      // POST to /v1/events/ingest (correct endpoint)
      const polarUrl = config.server === 'sandbox' 
        ? 'https://sandbox-api.polar.sh' 
        : 'https://api.polar.sh';

      const response = await fetch(
        `${polarUrl}/v1/events/ingest`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            events: [{
              // Customer ID for this event
              customer_id: org.polarCustomerId,
              // Event name matches the meter filter in Polar
              name: meterName,
              // Timestamp when the usage occurred
              timestamp: usageEvent.createdAt?.toISOString() || new Date().toISOString(),
              // Metadata including the usage value
              metadata: {
                event_id: eventId,
                event_type: usageEvent.eventType,
                unit_type: usageEvent.unitType,
                value: Number(usageEvent.units),
                ...(usageEvent.metadata ?? {}),
              },
            }],
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Polar API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      
      // Mark as synced
      await db
        .update(usageEvents)
        .set({
          syncedToPolar: true,
          polarEventId: result.id || eventId,
          lastSyncAttempt: new Date(),
          syncError: null,
        })
        .where(eq(usageEvents.id, eventId));

      console.log(`[PolarUsage] ✅ Synced event ${eventId.substring(0, 8)}... to Polar`);
      return true;
    } catch (error) {
      console.error("[PolarUsage] Failed to sync event to Polar:", error);
      
      // Update sync status with error
      await db
        .update(usageEvents)
        .set({
          syncError: error instanceof Error ? error.message : "Unknown error",
          syncAttempts: sql`${usageEvents.syncAttempts} + 1`,
          lastSyncAttempt: new Date(),
        })
        .where(eq(usageEvents.id, eventId));

      return false;
    }
  }

  /**
   * Get detailed usage metrics for an organization
   */
  async getUsageMetrics(organizationId: string): Promise<UsageMetrics> {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    if (!org) {
      throw new Error("Organization not found");
    }

    // Get plan limits
    const { subscriptionService } = await import("./subscription-service");
    const plan = await subscriptionService.getOrganizationPlanSafe(organizationId);

    // Get overage pricing
    const pricing = await this.getOveragePricing(org.subscriptionPlan || "plus");

    const playwrightUsed = org.playwrightMinutesUsed || 0;
    const k6Used = org.k6VuMinutesUsed || 0;
    const aiCreditsUsed = org.aiCreditsUsed || 0;

    const playwrightOverage = Math.max(0, playwrightUsed - plan.playwrightMinutesIncluded);
    const k6Overage = Math.max(0, k6Used - plan.k6VuMinutesIncluded);
    const aiCreditsOverage = Math.max(0, aiCreditsUsed - plan.aiCreditsIncluded);

    const playwrightOverageCost = playwrightOverage * (pricing?.playwrightMinutePriceCents || 10);
    const k6OverageCost = Math.ceil(k6Overage * (pricing?.k6VuMinutePriceCents || 1));
    // AI credits use hard-limit model (no overage billing)
    const aiCreditsOverageCost = 0;

    const playwrightPercentage =
      plan.playwrightMinutesIncluded > 0
        ? Math.round((playwrightUsed / plan.playwrightMinutesIncluded) * 100)
        : 100;
    const k6Percentage =
      plan.k6VuMinutesIncluded > 0
        ? Math.round((k6Used / plan.k6VuMinutesIncluded) * 100)
        : 100;
    const aiPercentage =
      plan.aiCreditsIncluded > 0
        ? Math.round((aiCreditsUsed / plan.aiCreditsIncluded) * 100)
        : 100;

    return {
      playwrightMinutes: {
        used: playwrightUsed,
        included: plan.playwrightMinutesIncluded,
        overage: playwrightOverage,
        overageCostCents: playwrightOverageCost,
        percentage: playwrightPercentage,
      },
      k6VuMinutes: {
        used: k6Used,
        included: plan.k6VuMinutesIncluded,
        overage: k6Overage,
        overageCostCents: k6OverageCost,
        percentage: k6Percentage,
      },
      aiCredits: {
        used: aiCreditsUsed,
        included: plan.aiCreditsIncluded,
        overage: aiCreditsOverage,
        overageCostCents: aiCreditsOverageCost,
        percentage: aiPercentage,
      },
      totalOverageCostCents: playwrightOverageCost + k6OverageCost,
      periodStart: org.usagePeriodStart,
      periodEnd: org.usagePeriodEnd,
    };
  }

  /**
   * Get spending status for an organization
   */
  async getSpendingStatus(organizationId: string): Promise<SpendingStatus> {
    // Get billing settings
    const settings = await db.query.billingSettings.findFirst({
      where: eq(billingSettings.organizationId, organizationId),
    });

    // Get current usage metrics
    const metrics = await this.getUsageMetrics(organizationId);
    const currentSpendingCents = metrics.totalOverageCostCents;

    const limitEnabled = settings?.enableSpendingLimit || false;
    const limitCents = settings?.monthlySpendingLimitCents || null;
    const hardStopEnabled = settings?.hardStopOnLimit || false;

    let percentageUsed = 0;
    let isAtLimit = false;
    let remainingCents: number | null = null;

    if (limitEnabled && limitCents !== null && limitCents > 0) {
      percentageUsed = Math.round((currentSpendingCents / limitCents) * 100);
      isAtLimit = currentSpendingCents >= limitCents;
      remainingCents = Math.max(0, limitCents - currentSpendingCents);
    }

    return {
      currentSpendingCents,
      limitCents,
      limitEnabled,
      hardStopEnabled,
      percentageUsed,
      isAtLimit,
      remainingCents,
    };
  }

  /**
   * Get overage pricing for a plan
   */
  async getOveragePricing(plan: "plus" | "pro" | "unlimited") {
    if (plan === "unlimited") {
      return null; // No overage for unlimited plan
    }

    return db.query.overagePricing.findFirst({
      where: eq(overagePricing.plan, plan),
    });
  }

  /**
   * Check if usage should be blocked due to spending limit
   */
  async shouldBlockUsage(organizationId: string): Promise<{ blocked: boolean; reason?: string }> {
    if (!isPolarEnabled()) {
      return { blocked: false };
    }

    const status = await this.getSpendingStatus(organizationId);

    if (status.limitEnabled && status.hardStopEnabled && status.isAtLimit) {
      return {
        blocked: true,
        reason: `Monthly spending limit of $${((status.limitCents || 0) / 100).toFixed(2)} reached. ` +
                `Current spending: $${(status.currentSpendingCents / 100).toFixed(2)}. ` +
                `Please increase your limit or disable hard stop to continue.`,
      };
    }

    return { blocked: false };
  }

  /**
   * Sync all pending usage events to Polar
   * Should be called periodically via scheduled job (e.g., every 5 minutes)
   */
  async syncPendingEvents(batchSize: number = 50): Promise<{ 
    processed: number; 
    succeeded: number; 
    failed: number;
    errors: string[];
  }> {
    if (!isPolarEnabled()) {
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    }

    const errors: string[] = [];

    try {
      // Find events that haven't been synced yet
      // Uses exponential backoff: only retry after appropriate delay based on attempt count
      // Delays: 1s, 5s, 30s, 120s, 300s (for attempts 1-5)
      const pendingEvents = await db.query.usageEvents.findMany({
        where: and(
          eq(usageEvents.syncedToPolar, false),
          sql`${usageEvents.syncAttempts} < 5`, // Max 5 retry attempts
          // Exponential backoff: only retry after appropriate delay
          sql`(
            ${usageEvents.lastSyncAttempt} IS NULL 
            OR ${usageEvents.lastSyncAttempt} < NOW() - INTERVAL '1 second' * (
              CASE ${usageEvents.syncAttempts}
                WHEN 0 THEN 0
                WHEN 1 THEN 1
                WHEN 2 THEN 5
                WHEN 3 THEN 30
                WHEN 4 THEN 120
                ELSE 300
              END
            )
          )`
        ),
        limit: batchSize,
        orderBy: (events, { asc }) => [asc(events.createdAt)],
      });

      let succeeded = 0;
      let failed = 0;

      for (const event of pendingEvents) {
        try {
          const synced = await this.syncEventToPolar(event.id);
          if (synced) {
            succeeded++;
          } else {
            failed++;
            const errorMsg = `Event ${event.id.substring(0, 8)}...: sync failed`;
            errors.push(errorMsg);
          }
        } catch (error) {
          failed++;
          const errorMsg = `Event ${event.id.substring(0, 8)}...: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          console.error(`[PolarUsage] Sync failed for event:`, errorMsg);
        }
      }

      if (pendingEvents.length > 0) {
        console.log(`[PolarUsage] Batch sync complete: ${succeeded}/${pendingEvents.length} succeeded, ${failed} failed`);
      }

      return { 
        processed: pendingEvents.length, 
        succeeded, 
        failed,
        errors 
      };
    } catch (error) {
      console.error("[PolarUsage] Batch sync failed:", error);
      return { 
        processed: 0, 
        succeeded: 0, 
        failed: 0, 
        errors: [error instanceof Error ? error.message : 'Unknown error'] 
      };
    }
  }
}

// Export singleton instance
export const polarUsageService = new PolarUsageService();
