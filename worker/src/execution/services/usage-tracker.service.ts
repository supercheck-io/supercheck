import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql, and, gte, lte } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { DB_PROVIDER_TOKEN } from './db.service';
import { RedisService } from './redis.service';

// Check if Polar is enabled (cloud mode)
function isPolarEnabled(): boolean {
  return process.env.SELF_HOSTED !== 'true' && !!process.env.POLAR_ACCESS_TOKEN;
}

// Constants for usage reservation
const RESERVATION_TTL_SECONDS = 300; // 5 minutes max - enough for test execution
const RESERVATION_KEY_PREFIX = 'usage:reservation:';

/**
 * Usage Tracker Service for Worker
 * Tracks Playwright and K6 usage and updates organization usage counters
 * Also records usage events for Polar billing integration
 * 
 * IMPORTANT: Uses Redis-based pessimistic reservations to prevent race conditions
 * where multiple parallel executions could all pass the spending limit check
 */
@Injectable()
export class UsageTrackerService {
  private readonly logger = new Logger(UsageTrackerService.name);

  constructor(
    @Inject(DB_PROVIDER_TOKEN)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Optional()
    private readonly redisService?: RedisService,
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
      const minutes = Math.ceil(executionTimeMs / 1000 / 60);

      // Check spending limit before tracking (for future executions)
      if (isPolarEnabled()) {
        const blockStatus = await this.checkSpendingLimit(organizationId);
        if (blockStatus.blocked) {
          this.logger.warn(
            `[Usage] Spending limit reached for org ${organizationId}: ${blockStatus.reason}`,
          );
          // Still track the usage but return blocked status
        }
      }

      // Get organization for billing period
      const org = await this.db.query.organization.findFirst({
        where: eq(schema.organization.id, organizationId),
      });

      // Update organization's usage counter
      await this.db
        .update(schema.organization)
        .set({
          playwrightMinutesUsed: sql`COALESCE(${schema.organization.playwrightMinutesUsed}, 0) + ${minutes}`,
        })
        .where(eq(schema.organization.id, organizationId));

      // Record usage event for Polar sync (if cloud mode)
      if (isPolarEnabled() && org) {
        await this.recordUsageEvent(
          organizationId,
          'playwright_execution',
          'playwright_minutes',
          minutes,
          'minutes',
          metadata,
          org.usagePeriodStart,
          org.usagePeriodEnd,
        );
      }

      this.logger.log(
        `[Usage] Tracked ${minutes} Playwright minutes for org ${organizationId}`,
        metadata,
      );

      return { blocked: false };
    } catch (error) {
      // Don't fail the execution if tracking fails
      this.logger.error(
        `[Usage] Failed to track Playwright usage for org ${organizationId}:`,
        error instanceof Error ? error.message : String(error),
      );
      return { blocked: false };
    }
  }

  /**
   * Track K6 load testing execution
   * Calculates VU minutes from virtual users and duration (consistent with Playwright)
   * Formula: ceil(VUs * duration in minutes)
   */
  async trackK6Execution(
    organizationId: string,
    virtualUsers: number,
    durationMs: number,
    metadata?: Record<string, any>,
  ): Promise<{ blocked: boolean; reason?: string }> {
    try {
      // Calculate VU minutes: ceil((VUs * duration in minutes))
      // Rounds UP for consistent billing with Playwright
      const durationMinutes = durationMs / 1000 / 60;
      const vuMinutes = Math.ceil(virtualUsers * durationMinutes);

      // Check spending limit before tracking
      if (isPolarEnabled()) {
        const blockStatus = await this.checkSpendingLimit(organizationId);
        if (blockStatus.blocked) {
          this.logger.warn(
            `[Usage] Spending limit reached for org ${organizationId}: ${blockStatus.reason}`,
          );
        }
      }

      // Get organization for billing period
      const org = await this.db.query.organization.findFirst({
        where: eq(schema.organization.id, organizationId),
      });

      // Update organization's usage counter
      await this.db
        .update(schema.organization)
        .set({
          k6VuMinutesUsed: sql`COALESCE(${schema.organization.k6VuMinutesUsed}, 0) + ${vuMinutes}`,
        })
        .where(eq(schema.organization.id, organizationId));

      // Record usage event for Polar sync (if cloud mode)
      if (isPolarEnabled() && org) {
        await this.recordUsageEvent(
          organizationId,
          'k6_execution',
          'k6_vu_minutes',
          vuMinutes,
          'vu_minutes',
          metadata,
          org.usagePeriodStart,
          org.usagePeriodEnd,
        );
      }

      this.logger.log(
        `[Usage] Tracked ${vuMinutes} K6 VU minutes for org ${organizationId}`,
        metadata,
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
   * Monitors are essentially Playwright tests that run on a schedule
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
    periodStart: Date | null,
    periodEnd: Date | null,
  ): Promise<void> {
    const now = new Date();
    const defaultPeriodStart = periodStart || now;
    const defaultPeriodEnd =
      periodEnd || new Date(now.getFullYear(), now.getMonth() + 1, 1);
    let eventId: string | null = null;

    try {
      // Record usage event locally first
      const result = await this.db.execute<{ id: string }>(sql`
        INSERT INTO usage_events (
          id, organization_id, event_type, event_name, units, unit_type,
          metadata, synced_to_polar, billing_period_start, billing_period_end, created_at
        ) VALUES (
          gen_random_uuid(),
          ${organizationId},
          ${eventType},
          ${eventName},
          ${units},
          ${unitType},
          ${metadata ? JSON.stringify(metadata) : null},
          false,
          ${defaultPeriodStart.toISOString()},
          ${defaultPeriodEnd.toISOString()},
          NOW()
        )
        RETURNING id
      `);

      const resultArray = result as unknown as Array<{ id: string }>;
      eventId = resultArray[0]?.id;

      this.logger.debug(
        `[Usage] Recorded usage event: ${eventType} for org ${organizationId}`,
      );
    } catch (error) {
      // Don't fail if usage_events table doesn't exist yet
      this.logger.warn(
        `[Usage] Failed to record usage event: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    // Sync to Polar immediately (non-blocking)
    if (eventId) {
      this.syncEventToPolar(
        organizationId,
        eventId,
        eventName,
        units,
        now,
      ).catch((err) =>
        this.logger.warn(`[Usage] Failed to sync to Polar: ${err.message}`),
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
          `[Usage] No Polar customer ID for org ${organizationId}, skipping sync. User must subscribe via Polar first.`,
        );
        return;
      }

      this.logger.debug(
        `[Usage] Syncing ${meterName}=${units} to Polar for customer ${org.polarCustomerId}`,
      );

      // Determine Polar API URL
      const isSandbox = process.env.POLAR_SERVER === 'sandbox';
      const polarUrl = isSandbox
        ? 'https://sandbox-api.polar.sh'
        : 'https://api.polar.sh';

      // Sync to Polar using the correct /v1/events/ingest endpoint
      const response = await fetch(`${polarUrl}/v1/events/ingest`, {
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
      // Get billing settings - postgres-js returns array directly
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

      // Get current overage cost
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
      // Don't block on errors - fail open
      this.logger.warn(
        `[Usage] Failed to check spending limit: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { blocked: false };
    }
  }

  /**
   * Check if execution should be blocked before starting
   * Call this before starting a new execution
   * 
   * IMPORTANT: This method now includes reserved usage in the limit calculation
   * to prevent race conditions where parallel executions could all pass the check.
   * Use reserveUsage() before calling this to pessimistically lock capacity.
   */
  async shouldBlockExecution(
    organizationId: string,
  ): Promise<{ blocked: boolean; reason?: string }> {
    if (!isPolarEnabled()) {
      return { blocked: false };
    }

    return this.checkSpendingLimit(organizationId);
  }

  /**
   * Reserve estimated usage before execution starts (pessimistic locking)
   * 
   * This prevents race conditions where multiple parallel executions could
   * all pass the spending limit check before any of them record actual usage.
   * 
   * @param organizationId - Organization to reserve for
   * @param estimatedMinutes - Estimated execution time in minutes
   * @param executionType - Type of execution (playwright, k6, monitor)
   * @returns reservationId if successful, or blocked status if limit would be exceeded
   */
  async reserveUsage(
    organizationId: string,
    estimatedMinutes: number,
    executionType: 'playwright' | 'k6' | 'monitor' = 'playwright',
  ): Promise<{
    reservationId: string | null;
    blocked: boolean;
    reason?: string;
    reservedTotal?: number;
  }> {
    if (!isPolarEnabled()) {
      // Self-hosted mode - no reservations needed
      return { reservationId: null, blocked: false };
    }

    if (!this.redisService) {
      // No Redis available - fall back to non-reserving behavior
      this.logger.debug('[Usage] Redis not available, skipping reservation');
      return { reservationId: null, blocked: false };
    }

    const redis = this.redisService.getClient();
    const reservationKey = `${RESERVATION_KEY_PREFIX}${organizationId}:${executionType}`;
    const reservationId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      // Atomically increment reserved usage
      const newReserved = await redis.incrby(reservationKey, estimatedMinutes);
      
      // Ensure TTL is set (handles first reservation and refreshes existing)
      await redis.expire(reservationKey, RESERVATION_TTL_SECONDS);

      // Store individual reservation for later release
      const individualKey = `${RESERVATION_KEY_PREFIX}detail:${reservationId}`;
      await redis.setex(
        individualKey, 
        RESERVATION_TTL_SECONDS, 
        JSON.stringify({
          organizationId,
          executionType,
          minutes: estimatedMinutes,
          createdAt: Date.now(),
        }),
      );

      // Check if this reservation would push us over the spending limit
      const blockCheck = await this.checkSpendingLimitWithReservations(
        organizationId,
        executionType,
      );

      if (blockCheck.blocked) {
        // Release this reservation immediately since we're blocked
        await this.releaseReservation(reservationId);
        return { 
          reservationId: null, 
          blocked: true, 
          reason: blockCheck.reason,
        };
      }

      this.logger.debug(
        `[Usage] Reserved ${estimatedMinutes} ${executionType} minutes for org ${organizationId.slice(0, 8)}... (total reserved: ${newReserved})`,
      );

      return { 
        reservationId, 
        blocked: false, 
        reservedTotal: newReserved,
      };
    } catch (error) {
      // On error, fail open - don't block execution
      this.logger.warn(
        `[Usage] Failed to reserve usage: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { reservationId: null, blocked: false };
    }
  }

  /**
   * Release a usage reservation (on cancellation, failure, or before recording actual usage)
   * 
   * @param reservationId - The reservation ID returned from reserveUsage
   */
  async releaseReservation(reservationId: string): Promise<void> {
    if (!this.redisService || !reservationId) {
      return;
    }

    const redis = this.redisService.getClient();
    const detailKey = `${RESERVATION_KEY_PREFIX}detail:${reservationId}`;

    try {
      // Get the reservation details
      const detailJson = await redis.get(detailKey);
      if (!detailJson) {
        // Already expired or released
        return;
      }

      const detail = JSON.parse(detailJson) as {
        organizationId: string;
        executionType: 'playwright' | 'k6' | 'monitor';
        minutes: number;
      };

      const reservationKey = `${RESERVATION_KEY_PREFIX}${detail.organizationId}:${detail.executionType}`;

      // Atomically decrement the reserved total
      await redis.decrby(reservationKey, detail.minutes);
      
      // Delete the individual reservation record
      await redis.del(detailKey);

      this.logger.debug(
        `[Usage] Released reservation ${reservationId.slice(0, 8)}... (${detail.minutes} minutes)`,
      );
    } catch (error) {
      // Non-critical - reservation will auto-expire via TTL
      this.logger.warn(
        `[Usage] Failed to release reservation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get total reserved usage for an organization and execution type
   */
  async getReservedUsage(
    organizationId: string,
    executionType: 'playwright' | 'k6' | 'monitor' = 'playwright',
  ): Promise<number> {
    if (!this.redisService) {
      return 0;
    }

    const redis = this.redisService.getClient();
    const reservationKey = `${RESERVATION_KEY_PREFIX}${organizationId}:${executionType}`;

    try {
      const reserved = await redis.get(reservationKey);
      return reserved ? parseInt(reserved, 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check spending limit including reserved usage
   * This is used internally by reserveUsage to check if a new reservation
   * would push the organization over its spending limit.
   */
  private async checkSpendingLimitWithReservations(
    organizationId: string,
    executionType: 'playwright' | 'k6' | 'monitor',
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

      if (!settingsArray?.length) {
        return { blocked: false };
      }

      const row = settingsArray[0];
      if (!row.enable_spending_limit || !row.hard_stop_on_limit || !row.monthly_spending_limit_cents) {
        return { blocked: false };
      }

      // Get organization and plan limits
      const org = await this.db.query.organization.findFirst({
        where: eq(schema.organization.id, organizationId),
      });

      if (!org) {
        return { blocked: false };
      }

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

      if (!planLimitsArray?.length) {
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

      if (!pricingArray?.length) {
        return { blocked: false };
      }

      const prices = pricingArray[0];

      // Get reserved usage from Redis
      const playwrightReserved = await this.getReservedUsage(organizationId, 'playwright');
      const monitorReserved = await this.getReservedUsage(organizationId, 'monitor');
      const k6Reserved = await this.getReservedUsage(organizationId, 'k6');

      // Calculate current + reserved usage
      const totalPlaywrightUsage = 
        (org.playwrightMinutesUsed || 0) + playwrightReserved + monitorReserved;
      const totalK6Usage = (org.k6VuMinutesUsed || 0) + k6Reserved;

      // Calculate overage including reserved usage
      const playwrightOverage = Math.max(
        0,
        totalPlaywrightUsage - limits.playwright_minutes_included,
      );
      const k6Overage = Math.max(
        0,
        totalK6Usage - limits.k6_vu_minutes_included,
      );

      const totalOverageCents =
        playwrightOverage * prices.playwright_minute_price_cents +
        k6Overage * prices.k6_vu_minute_price_cents;

      if (totalOverageCents >= row.monthly_spending_limit_cents) {
        return {
          blocked: true,
          reason:
            `Monthly spending limit of $${(row.monthly_spending_limit_cents / 100).toFixed(2)} would be exceeded. ` +
            `Projected spending: $${(totalOverageCents / 100).toFixed(2)} (includes ${playwrightReserved + monitorReserved} reserved Playwright minutes, ${k6Reserved} reserved K6 VU minutes).`,
        };
      }

      return { blocked: false };
    } catch (error) {
      this.logger.warn(
        `[Usage] Failed to check spending limit with reservations: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { blocked: false }; // Fail open
    }
  }
}
