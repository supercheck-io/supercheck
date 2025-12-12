/**
 * Polar Usage Service
 * 
 * Handles usage-based billing integration with Polar:
 * - Event ingestion for usage tracking
 * - Customer meter management
 * - Usage synchronization
 * 
 * Uses the Better Auth Polar plugin's usage functionality
 */

import { db } from "@/utils/db";
import {
  organization,
  usageEvents,
  billingSettings,
  overagePricing
} from "@/db/schema";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import { isPolarEnabled, getPolarConfig } from "@/lib/feature-flags";
import type { Polar } from "@polar-sh/sdk";

// Event types for usage tracking
export type UsageEventType = "playwright_execution" | "k6_execution" | "monitor_execution" | "ai_usage";

export interface UsageIngestionParams {
  organizationId: string;
  eventType: UsageEventType;
  eventName: string;
  units: number;
  unitType: "minutes" | "vu_minutes" | "credits";
  metadata?: Record<string, unknown>;
}

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
   * Ingest a usage event
   * Records locally and syncs to Polar for billing
   */
  async ingestUsageEvent(params: UsageIngestionParams): Promise<{ success: boolean; eventId?: string; error?: string }> {
    const { organizationId, eventType, eventName, units, unitType, metadata } = params;

    try {
      // Get organization details
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, organizationId),
      });

      if (!org) {
        return { success: false, error: "Organization not found" };
      }

      // Get billing period
      const periodStart = org.usagePeriodStart || new Date();
      const periodEnd = org.usagePeriodEnd || this.getNextMonthDate(periodStart);

      // Check spending limit before allowing usage
      const spendingStatus = await this.getSpendingStatus(organizationId);
      if (spendingStatus.limitEnabled && spendingStatus.hardStopEnabled && spendingStatus.isAtLimit) {
        return { 
          success: false, 
          error: "Spending limit reached. Please increase your limit or disable hard stop to continue." 
        };
      }

      // Record usage event locally
      const [usageEvent] = await db.insert(usageEvents).values({
        organizationId,
        eventType,
        eventName,
        units: units.toString(),
        unitType,
        metadata: metadata ? JSON.stringify(metadata) : null,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        syncedToPolar: false,
      }).returning();

      // Update organization usage counters
      if (unitType === "minutes") {
        await db
          .update(organization)
          .set({
            playwrightMinutesUsed: sql`COALESCE(${organization.playwrightMinutesUsed}, 0) + ${Math.ceil(units)}`,
          })
          .where(eq(organization.id, organizationId));
      } else if (unitType === "vu_minutes") {
        await db
          .update(organization)
          .set({
            k6VuMinutesUsed: sql`COALESCE(${organization.k6VuMinutesUsed}, 0) + ${units}`,
          })
          .where(eq(organization.id, organizationId));
      } else if (unitType === "credits") {
        await db
          .update(organization)
          .set({
            aiCreditsUsed: sql`COALESCE(${organization.aiCreditsUsed}, 0) + ${Math.ceil(units)}`,
          })
          .where(eq(organization.id, organizationId));
      }

      // Sync to Polar if enabled
      if (isPolarEnabled() && org.polarCustomerId) {
        await this.syncEventToPolar(usageEvent.id);
      }

      console.log(`[PolarUsage] Ingested ${units} ${unitType} for org ${organizationId}`);

      return { success: true, eventId: usageEvent.id };
    } catch (error) {
      console.error("[PolarUsage] Failed to ingest usage event:", error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }

  /**
   * Sync a usage event to Polar using their Events Ingestion API
   * Uses Polar SDK's usage metering endpoint
   */
  private async syncEventToPolar(eventId: string): Promise<void> {
    try {
      const polar = await this.getPolarClient();
      if (!polar) {
        console.warn("[PolarUsage] Polar client not available, skipping sync");
        return;
      }

      // Fetch the usage event
      const usageEvent = await db.query.usageEvents.findFirst({
        where: eq(usageEvents.id, eventId),
      });

      if (!usageEvent) {
        console.warn(`[PolarUsage] Event ${eventId} not found`);
        return;
      }

      // Get organization with Polar customer ID
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, usageEvent.organizationId),
      });

      if (!org?.polarCustomerId) {
        console.warn(`[PolarUsage] No Polar customer ID for org ${usageEvent.organizationId}`);
        return;
      }

      // Get the Polar config
      const config = getPolarConfig();
      if (!config?.accessToken) {
        console.warn("[PolarUsage] No Polar access token configured");
        return;
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
                ...(usageEvent.metadata ? JSON.parse(usageEvent.metadata) : {}),
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
    const plan = await subscriptionService.getOrganizationPlan(organizationId);

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
    const aiCreditsOverageCost = aiCreditsOverage * (pricing?.aiCreditPriceCents || 5);

    return {
      playwrightMinutes: {
        used: playwrightUsed,
        included: plan.playwrightMinutesIncluded,
        overage: playwrightOverage,
        overageCostCents: playwrightOverageCost,
        percentage: Math.round((playwrightUsed / plan.playwrightMinutesIncluded) * 100),
      },
      k6VuMinutes: {
        used: k6Used,
        included: plan.k6VuMinutesIncluded,
        overage: k6Overage,
        overageCostCents: k6OverageCost,
        percentage: Math.round((k6Used / plan.k6VuMinutesIncluded) * 100),
      },
      aiCredits: {
        used: aiCreditsUsed,
        included: plan.aiCreditsIncluded,
        overage: aiCreditsOverage,
        overageCostCents: aiCreditsOverageCost,
        percentage: Math.round((aiCreditsUsed / plan.aiCreditsIncluded) * 100),
      },
      totalOverageCostCents: playwrightOverageCost + k6OverageCost + aiCreditsOverageCost,
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
   * Get usage events for a billing period
   */
  async getUsageEvents(
    organizationId: string,
    periodStart: Date,
    periodEnd: Date,
    options?: { limit?: number; offset?: number; eventType?: UsageEventType }
  ) {
    const conditions = [
      eq(usageEvents.organizationId, organizationId),
      gte(usageEvents.billingPeriodStart, periodStart),
      lte(usageEvents.billingPeriodEnd, periodEnd),
    ];

    if (options?.eventType) {
      conditions.push(eq(usageEvents.eventType, options.eventType));
    }

    return db.query.usageEvents.findMany({
      where: and(...conditions),
      limit: options?.limit || 100,
      offset: options?.offset || 0,
      orderBy: (events, { desc }) => [desc(events.createdAt)],
    });
  }

  /**
   * Helper to calculate billing period end (30 days from start)
   * Uses 30-day intervals instead of calendar months for consistency
   */
  private getNextBillingPeriodEnd(from: Date): Date {
    const next = new Date(from);
    next.setDate(next.getDate() + 30);
    return next;
  }

  /**
   * @deprecated Use getNextBillingPeriodEnd instead
   */
  private getNextMonthDate(from: Date): Date {
    return this.getNextBillingPeriodEnd(from);
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
          await this.syncEventToPolar(event.id);
          succeeded++;
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

  /**
   * Retry failed Polar syncs
   * Should be called periodically via cron job
   */
  async retryFailedSyncs(maxRetries: number = 3): Promise<{ processed: number; succeeded: number; failed: number }> {
    const failedEvents = await db.query.usageEvents.findMany({
      where: and(
        eq(usageEvents.syncedToPolar, false),
        sql`${usageEvents.syncAttempts} < ${maxRetries}`
      ),
      limit: 100,
    });

    let succeeded = 0;
    let failed = 0;

    for (const event of failedEvents) {
      try {
        const org = await db.query.organization.findFirst({
          where: eq(organization.id, event.organizationId),
        });

        if (org?.polarCustomerId) {
          await this.syncEventToPolar(event.id);
          succeeded++;
        }
      } catch (error) {
        failed++;
        console.error(`[PolarUsage] Retry failed for event ${event.id}:`, error);
      }
    }

    return { processed: failedEvents.length, succeeded, failed };
  }
}

// Export singleton instance
export const polarUsageService = new PolarUsageService();
