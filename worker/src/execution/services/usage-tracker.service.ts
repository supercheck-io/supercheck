import { v7 as uuidv7 } from 'uuid';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { DB_PROVIDER_TOKEN } from './db.service';

// Check if Polar is enabled (cloud mode)
function isPolarEnabled(): boolean {
  return process.env.SELF_HOSTED !== 'true' && !!process.env.POLAR_ACCESS_TOKEN;
}

/**
 * Usage Tracker Service for Worker
 *
 * Tracks Playwright and K6 usage and updates organization usage counters.
 * Also records usage events for Polar billing integration.
 *
 * ARCHITECTURE:
 * - Updates local database counters immediately
 * - Records usage events to usage_events table for audit trail
 * - Syncs events to Polar API for billing (async, non-blocking)
 *
 * The spending limit check (shouldBlockExecution) runs BEFORE execution
 * starts and provides a "best effort" check based on current recorded usage.
 */
@Injectable()
export class UsageTrackerService {
  private readonly logger = new Logger(UsageTrackerService.name);

  constructor(
    @Inject(DB_PROVIDER_TOKEN)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Track Playwright execution time
   * Updates local database usage counter and records usage event
   */
  async trackPlaywrightExecution(
    organizationId: string,
    executionTimeMs: number,
    metadata?: Record<string, any>,
  ): Promise<{ blocked: boolean; reason?: string }> {
    try {
      if (!Number.isFinite(executionTimeMs) || executionTimeMs < 0) {
        throw new Error('Invalid Playwright execution duration');
      }
      // Match the four-decimal ledger precision before updating either sink.
      // No whole-minute minimum: a five-second check uses 0.0833 minutes.
      const minutes = Math.round((executionTimeMs / 60_000) * 10_000) / 10_000;

      await this.recordUsageEvent(
        organizationId,
        'playwright_execution',
        'playwright_minutes',
        minutes,
        'minutes',
        metadata,
      );

      this.logger.debug(
        `[Usage] Tracked ${minutes} Playwright minutes for org ${organizationId?.slice(0, 8)}...`,
      );

      return { blocked: false };
    } catch (error) {
      // Don't fail the execution if tracking fails - graceful degradation
      this.logger.error(
        `[Usage] Failed to track Playwright usage for org ${organizationId}:`,
        error instanceof Error ? error.message : String(error),
      );
      return { blocked: false };
    }
  }

  /**
   * Track K6 load testing execution
   * Calculates VU minutes from virtual users and duration
   * Formula: ceil(VUs * duration in minutes)
   */
  async trackK6Execution(
    organizationId: string,
    virtualUsers: number,
    durationMs: number,
    metadata?: Record<string, any>,
  ): Promise<{ blocked: boolean; reason?: string }> {
    try {
      // Calculate VU minutes: ceil(VUs * duration in minutes)
      const durationMinutes = durationMs / 1000 / 60;
      const vuMinutes = Math.ceil(virtualUsers * durationMinutes);

      await this.recordUsageEvent(
        organizationId,
        'k6_execution',
        'k6_vu_minutes',
        vuMinutes,
        'vu_minutes',
        metadata,
      );

      this.logger.debug(
        `[Usage] Tracked ${vuMinutes} K6 VU minutes for org ${organizationId?.slice(0, 8)}...`,
      );

      return { blocked: false };
    } catch (error) {
      this.logger.error(
        `[Usage] Failed to track K6 usage for org ${organizationId}:`,
        error instanceof Error ? error.message : String(error),
      );
      return { blocked: false };
    }
  }

  /**
   * Track monitor execution (counts as Playwright minutes)
   * Monitors are Playwright tests that run on a schedule
   */
  async trackMonitorExecution(
    organizationId: string,
    executionTimeMs: number,
    metadata?: Record<string, any>,
  ): Promise<{ blocked: boolean; reason?: string }> {
    return this.trackPlaywrightExecution(organizationId, executionTimeMs, {
      type: 'monitor',
      ...metadata,
    });
  }

  /**
   * Record a usage event and sync to Polar
   */
  private async recordUsageEvent(
    organizationId: string,
    eventType: 'playwright_execution' | 'k6_execution' | 'monitor_execution',
    eventName: string,
    units: number,
    unitType: string,
    metadata: Record<string, any> | undefined,
  ): Promise<void> {
    if (!Number.isFinite(units) || units < 0) {
      throw new Error('Invalid execution usage amount');
    }
    const billable = isPolarEnabled();
    const now = new Date();
    const event = await this.db.transaction(async (tx) => {
      // Serialize with subscription rollover and other usage writers before
      // reading the period. Counter and durable ledger must commit together.
      const [org] = await tx
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .for('update');
      if (!org) throw new Error('Billing organization not found');

      const runId = typeof metadata?.runId === 'string' ? metadata.runId : null;
      if (billable && runId) {
        const existing = await tx.query.usageEvents.findFirst({
          where: and(
            eq(schema.usageEvents.organizationId, organizationId),
            eq(schema.usageEvents.eventType, eventType),
            sql`${schema.usageEvents.metadata}->>'runId' = ${runId}`,
          ),
        });
        // The scheduler will retry any unsynced existing event.
        if (existing) return null;
      }

      await tx
        .update(schema.organization)
        .set(
          eventType === 'k6_execution'
            ? {
                k6VuMinutesUsed: sql`COALESCE(${schema.organization.k6VuMinutesUsed}, 0) + ${units}`,
              }
            : {
                playwrightMinutesUsed: sql`COALESCE(${schema.organization.playwrightMinutesUsed}, 0) + ${units}`,
              },
        )
        .where(eq(schema.organization.id, organizationId));

      if (!billable) return null;
      const [created] = await tx
        .insert(schema.usageEvents)
        .values({
          id: uuidv7(),
          organizationId,
          eventType,
          eventName,
          units: String(units),
          unitType,
          metadata,
          syncedToPolar: false,
          billingPeriodStart: org.usagePeriodStart ?? now,
          billingPeriodEnd:
            org.usagePeriodEnd ??
            new Date(now.getFullYear(), now.getMonth() + 1, 1),
          createdAt: now,
        })
        .returning({ id: schema.usageEvents.id });
      if (!created) throw new Error('Usage ledger insert returned no event');
      return created;
    });

    // External requests happen only after the ledger transaction commits.
    if (event) {
      this.syncEventToPolar(
        organizationId,
        event.id,
        eventName,
        units,
        now,
      ).catch((error: unknown) =>
        this.logger.warn(
          `[Usage] Failed to sync to Polar: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  /**
   * Sync a usage event directly to Polar API
   */
  private async syncEventToPolar(
    organizationId: string,
    eventId: string,
    meterName: string,
    units: number,
    timestamp: Date,
  ): Promise<void> {
    const accessToken = process.env.POLAR_ACCESS_TOKEN;
    if (!accessToken) {
      this.logger.debug(
        `[Usage] POLAR_ACCESS_TOKEN not configured, skipping Polar sync`,
      );
      return;
    }

    try {
      // Get organization's Polar customer ID
      const org = await this.db.query.organization.findFirst({
        where: eq(schema.organization.id, organizationId),
        columns: { polarCustomerId: true },
      });

      if (!org?.polarCustomerId) {
        this.logger.warn(
          `[Usage] No Polar customer ID for org ${organizationId?.slice(0, 8)}..., skipping sync.`,
        );
        return;
      }

      this.logger.debug(
        `[Usage] Syncing ${meterName}=${units} to Polar for customer ${org.polarCustomerId?.slice(0, 8)}...`,
      );

      // Determine Polar API URL
      const isSandbox = process.env.POLAR_SERVER === 'sandbox';
      const polarUrl = isSandbox
        ? 'https://sandbox-api.polar.sh'
        : 'https://api.polar.sh';

      // Sync to Polar using the /v1/events/ingest endpoint
      const response = await fetch(`${polarUrl}/v1/events/ingest`, {
        signal: AbortSignal.timeout(10000),
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          events: [
            {
              customer_id: org.polarCustomerId,
              name: meterName,
              // Use the durable local ledger ID as Polar's deduplication key.
              // Scheduler retries send this same external_id.
              external_id: eventId,
              timestamp: timestamp.toISOString(),
              metadata: {
                event_id: eventId,
                value: units,
              },
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Polar API error (${response.status}): ${errorText}`);
      }

      // Mark as synced
      await this.db.execute(sql`
        UPDATE usage_events 
        SET synced_to_polar = true, last_sync_attempt = NOW(), sync_error = NULL
        WHERE id = ${eventId}::uuid
      `);

      this.logger.debug(
        `[Usage] ✅ Synced event ${eventId.substring(0, 8)}... to Polar`,
      );
    } catch (error) {
      // Update sync error but don't fail
      await this.db
        .execute(
          sql`
        UPDATE usage_events 
        SET sync_attempts = sync_attempts + 1, 
            last_sync_attempt = NOW(),
            sync_error = ${error instanceof Error ? error.message : 'Unknown error'}
        WHERE id = ${eventId}::uuid
      `,
        )
        .catch(() => {
          /* ignore */
        });

      throw error;
    }
  }

  /**
   * Check if usage should be blocked due to spending limit
   */
  private async checkSpendingLimit(
    organizationId: string,
  ): Promise<{ blocked: boolean; reason?: string }> {
    try {
      // Get billing settings
      const settings = await this.db.execute<{
        enable_spending_limit: boolean;
        hard_stop_on_limit: boolean;
        monthly_spending_limit_cents: number | null;
      }>(sql`
        SELECT 
          enable_spending_limit,
          hard_stop_on_limit,
          monthly_spending_limit_cents
        FROM billing_settings
        WHERE organization_id = ${organizationId}
      `);

      const settingsArray = settings as unknown as Array<{
        enable_spending_limit: boolean;
        hard_stop_on_limit: boolean;
        monthly_spending_limit_cents: number | null;
      }>;

      if (!settingsArray || settingsArray.length === 0) {
        return { blocked: false };
      }

      const row = settingsArray[0];

      if (
        !row.enable_spending_limit ||
        !row.hard_stop_on_limit ||
        !row.monthly_spending_limit_cents
      ) {
        return { blocked: false };
      }

      // Get organization usage
      const org = await this.db.query.organization.findFirst({
        where: eq(schema.organization.id, organizationId),
      });

      if (!org) {
        return { blocked: false };
      }

      // Get plan limits
      const planLimitsResult = await this.db.execute<{
        playwright_minutes_included: number;
        k6_vu_minutes_included: number;
      }>(sql`
        SELECT
          playwright_minutes_included,
          k6_vu_minutes_included
        FROM plan_limits
        WHERE plan = ${org.subscriptionPlan || 'plus'}
      `);

      const planLimitsArray = planLimitsResult as unknown as Array<{
        playwright_minutes_included: number;
        k6_vu_minutes_included: number;
      }>;

      if (!planLimitsArray || planLimitsArray.length === 0) {
        return { blocked: false };
      }

      const limits = planLimitsArray[0];

      // Get overage pricing
      const pricingResult = await this.db.execute<{
        playwright_minute_price_cents: number;
        k6_vu_minute_price_cents: number;
      }>(sql`
        SELECT
          playwright_minute_price_cents,
          k6_vu_minute_price_cents
        FROM overage_pricing
        WHERE plan = ${org.subscriptionPlan || 'plus'}
      `);

      const pricingArray = pricingResult as unknown as Array<{
        playwright_minute_price_cents: number;
        k6_vu_minute_price_cents: number;
      }>;

      if (!pricingArray || pricingArray.length === 0) {
        return { blocked: false };
      }

      const prices = pricingArray[0];

      // Calculate current overage cost
      const playwrightOverage = Math.max(
        0,
        (org.playwrightMinutesUsed || 0) - limits.playwright_minutes_included,
      );
      const k6Overage = Math.max(
        0,
        (org.k6VuMinutesUsed || 0) - limits.k6_vu_minutes_included,
      );

      const totalOverageCents =
        playwrightOverage * prices.playwright_minute_price_cents +
        k6Overage * prices.k6_vu_minute_price_cents;

      if (totalOverageCents >= row.monthly_spending_limit_cents) {
        return {
          blocked: true,
          reason:
            `Monthly spending limit of $${(row.monthly_spending_limit_cents / 100).toFixed(2)} reached. ` +
            `Current spending: $${(totalOverageCents / 100).toFixed(2)}.`,
        };
      }

      return { blocked: false };
    } catch (error) {
      this.logger.error(
        `[Usage] Failed to check spending limit for org ${organizationId?.slice(0, 8)}...: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        blocked: true,
        reason: 'Unable to verify the organization spending limit',
      };
    }
  }

  /**
   * Check if execution should be blocked before starting
   * Call this before starting a new execution
   */
  async shouldBlockExecution(
    organizationId: string,
  ): Promise<{ blocked: boolean; reason?: string }> {
    const isCloudProduction =
      process.env.NODE_ENV === 'production' &&
      process.env.SELF_HOSTED?.toLowerCase() !== 'true';
    if (isCloudProduction && !process.env.POLAR_ACCESS_TOKEN) {
      return {
        blocked: true,
        reason: 'Cloud billing enforcement is not configured',
      };
    }

    if (!isPolarEnabled()) {
      return { blocked: false };
    }

    return this.checkSpendingLimit(organizationId);
  }
}
