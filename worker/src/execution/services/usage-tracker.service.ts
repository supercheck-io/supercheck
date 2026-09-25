import { v7 as uuidv7 } from 'uuid';
import {
  Injectable,
  Logger,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { DB_PROVIDER_TOKEN } from './db.service';
import {
  ExecutionUsageCompletion,
  ExecutionUsageTransaction,
  persistExecutionReceipt,
} from './execution-usage-receipts';

// Polar API version pinned to match stable quarterly release
const POLAR_API_VERSION = '2026-04';

// Check if Polar is enabled (cloud mode)
function isSelfHosted(): boolean {
  return process.env.SELF_HOSTED === 'true' || process.env.SELF_HOSTED === '1';
}

function isPolarEnabled(): boolean {
  return !isSelfHosted() && !!process.env.POLAR_ACCESS_TOKEN;
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
export class UsageTrackerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageTrackerService.name);
  private recoveryTimer?: ReturnType<typeof setInterval>;
  private recovering = false;

  constructor(
    @Inject(DB_PROVIDER_TOKEN)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  onModuleInit(): void {
    this.recoveryTimer = setInterval(() => {
      void this.reconcilePendingExecutionUsage().catch((error: unknown) => {
        this.logger.error(`Execution usage recovery failed: ${String(error)}`);
      });
    }, 60_000);
    this.recoveryTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }

  async completeRunWithUsage(
    input: ExecutionUsageCompletion,
    persistResult: (tx: ExecutionUsageTransaction) => Promise<void>,
  ): Promise<void> {
    if (!isPolarEnabled()) {
      await this.db.transaction(persistResult);
      return;
    }
    const receiptId = await persistExecutionReceipt(
      this.db,
      input,
      persistResult,
    );
    // Failure here leaves a durable receipt; another worker can settle it.
    await this.settleExecutionReceipt(receiptId);
  }

  async reconcilePendingExecutionUsage(): Promise<number> {
    if (!isPolarEnabled() || this.recovering) return 0;
    this.recovering = true;
    try {
      const pending = await this.db.query.executionUsageReceipts.findMany({
        where: and(
          isNull(schema.executionUsageReceipts.settledAt),
          lte(schema.executionUsageReceipts.nextAttemptAt, new Date()),
        ),
        orderBy: [asc(schema.executionUsageReceipts.nextAttemptAt)],
        limit: 50,
      });
      for (const receipt of pending)
        await this.settleExecutionReceipt(receipt.id);
      return pending.length;
    } finally {
      this.recovering = false;
    }
  }

  private async settleExecutionReceipt(id: string): Promise<void> {
    try {
      const receipt = await this.db.query.executionUsageReceipts.findFirst({
        where: eq(schema.executionUsageReceipts.id, id),
      });
      if (!receipt || receipt.settledAt) return;
      const k6 = receipt.eventType === 'k6_execution';
      await this.recordUsageEvent(
        receipt.organizationId,
        receipt.eventType,
        k6 ? 'k6_vu_minutes' : 'playwright_minutes',
        Number(receipt.units),
        k6 ? 'vu_minutes' : 'minutes',
        { ...receipt.metadata, runId: receipt.runId },
        id,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Execution usage receipt ${id} remains unsettled: ${message}`,
      );
      await this.db
        .update(schema.executionUsageReceipts)
        .set({
          lastError: message,
          nextAttemptAt:
            message ===
            'Execution usage billing period closed; manual reconciliation required'
              ? null
              : new Date(Date.now() + 60_000),
        })
        .where(
          and(
            eq(schema.executionUsageReceipts.id, id),
            isNull(schema.executionUsageReceipts.settledAt),
          ),
        )
        .catch((updateError: unknown) => {
          this.logger.error(
            `Could not record execution usage retry: ${String(updateError)}`,
          );
        });
    }
  }

  private async settleRecordedRun(
    organizationId: string,
    eventType: 'playwright_execution' | 'k6_execution',
    runId: unknown,
  ): Promise<boolean> {
    if (!isPolarEnabled() || typeof runId !== 'string') return false;
    const receipt = await this.db.query.executionUsageReceipts.findFirst({
      where: and(
        eq(schema.executionUsageReceipts.organizationId, organizationId),
        eq(schema.executionUsageReceipts.eventType, eventType),
        eq(schema.executionUsageReceipts.runId, runId),
      ),
    });
    if (!receipt) return false;
    await this.settleExecutionReceipt(receipt.id);
    return true;
  }

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

      if (
        await this.settleRecordedRun(
          organizationId,
          'playwright_execution',
          metadata?.runId,
        )
      )
        return { blocked: false };

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
      if (
        !Number.isFinite(virtualUsers) ||
        virtualUsers < 0 ||
        !Number.isFinite(durationMs) ||
        durationMs < 0
      ) {
        throw new Error('Invalid K6 execution usage');
      }
      // Calculate VU minutes: ceil(VUs * duration in minutes)
      const durationMinutes = durationMs / 1000 / 60;
      const vuMinutes = Math.ceil(virtualUsers * durationMinutes);

      if (
        await this.settleRecordedRun(
          organizationId,
          'k6_execution',
          metadata?.runId,
        )
      )
        return { blocked: false };

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
    receiptId?: string,
  ): Promise<void> {
    if (!Number.isFinite(units) || units < 0) {
      throw new Error('Invalid execution usage amount');
    }
    const billable = isPolarEnabled();
    let now = new Date();
    const event = await this.db.transaction(async (tx) => {
      // Serialize with subscription rollover and other usage writers before
      // reading the period. Counter and durable ledger must commit together.
      const [org] = await tx
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .for('update');
      if (!org) throw new Error('Billing organization not found');

      const receipt = receiptId
        ? await tx.query.executionUsageReceipts.findFirst({
            where: and(
              eq(schema.executionUsageReceipts.id, receiptId),
              eq(schema.executionUsageReceipts.organizationId, organizationId),
            ),
          })
        : undefined;
      if (receiptId && !receipt)
        throw new Error('Execution usage receipt not found');
      if (receipt?.settledAt) return null;
      if (receipt) now = receipt.createdAt;
      const markSettled = async () => {
        if (receipt)
          await tx
            .update(schema.executionUsageReceipts)
            .set({
              settledAt: new Date(),
              nextAttemptAt: null,
              lastError: null,
            })
            .where(eq(schema.executionUsageReceipts.id, receipt.id));
      };

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
        if (existing) {
          await markSettled();
          return null;
        }
      }

      // Never silently move a recovered charge into a new subscription period.
      if (
        receipt &&
        (receipt.billingPeriodEnd.getTime() <= Date.now() ||
          (org.usagePeriodStart &&
            org.usagePeriodStart.getTime() !==
              receipt.billingPeriodStart.getTime()) ||
          (org.usagePeriodEnd &&
            org.usagePeriodEnd.getTime() !==
              receipt.billingPeriodEnd.getTime()))
      ) {
        throw new Error(
          'Execution usage billing period closed; manual reconciliation required',
        );
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
          id: receipt?.id ?? uuidv7(),
          organizationId,
          eventType,
          eventName,
          units: String(units),
          unitType,
          metadata,
          syncedToPolar: false,
          billingPeriodStart:
            receipt?.billingPeriodStart ?? org.usagePeriodStart ?? now,
          billingPeriodEnd:
            receipt?.billingPeriodEnd ??
            org.usagePeriodEnd ??
            new Date(now.getFullYear(), now.getMonth() + 1, 1),
          createdAt: now,
        })
        .returning({ id: schema.usageEvents.id });
      if (!created) throw new Error('Usage ledger insert returned no event');
      await markSettled();
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
          'Polar-Version': POLAR_API_VERSION,
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
      process.env.NODE_ENV === 'production' && !isSelfHosted();
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
