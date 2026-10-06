import { ceilUsageCostCents } from '../../common/utils/usage-cost';
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
  private lastMigrationWarningAt = Number.NEGATIVE_INFINITY;

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
        .returning({
          id: schema.usageEvents.id,
          billingPeriodEnd: schema.usageEvents.billingPeriodEnd,
        });
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
        event.billingPeriodEnd,
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
    billingPeriodEnd: Date,
  ): Promise<void> {
    const accessToken = process.env.POLAR_ACCESS_TOKEN;
    if (!accessToken) {
      this.logger.debug(
        `[Usage] POLAR_ACCESS_TOKEN not configured, skipping Polar sync`,
      );
      return;
    }

    try {
      if (!billingPeriodEnd || billingPeriodEnd.getTime() <= Date.now()) {
        throw new Error(
          'Billing period closed; manual reconciliation required',
        );
      }
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
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('Polar did not acknowledge the usage event');
      }
      const inserted = 'inserted' in result ? result.inserted : undefined;
      const duplicates = 'duplicates' in result ? (result.duplicates ?? 0) : 0;
      if (
        typeof inserted !== 'number' ||
        !Number.isInteger(inserted) ||
        inserted < 0 ||
        typeof duplicates !== 'number' ||
        !Number.isInteger(duplicates) ||
        duplicates < 0 ||
        inserted + duplicates !== 1
      ) {
        throw new Error('Polar did not acknowledge the usage event');
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
   * Read pricing during the worker-first additive migration window.
   */
  private async getAdmissionPricing(plan: 'plus' | 'pro') {
    const where = eq(schema.overagePricing.plan, plan);
    try {
      return await this.db.query.overagePricing.findFirst({ where });
    } catch (error) {
      // Workers roll out before the app runs additive migrations. Only the
      // known new column may fall back; DB outages/other schema errors still
      // fail closed. Do not cache this, so migration completion takes effect
      // on the next admission check.
      const cause: unknown =
        error instanceof Error && error.cause ? error.cause : error;
      if (
        !cause ||
        typeof cause !== 'object' ||
        !('code' in cause) ||
        cause.code !== '42703' ||
        !('message' in cause) ||
        typeof cause.message !== 'string' ||
        !/\bk6_vu_minute_price_cents_override\b/.test(cause.message)
      ) {
        throw error;
      }
      const now = Date.now();
      if (now - this.lastMigrationWarningAt >= 60_000) {
        this.lastMigrationWarningAt = now;
        this.logger.warn(
          '[Usage] Migration 0025 is pending; admission uses legacy K6 pricing',
        );
      }
      const legacy = await this.db.query.overagePricing.findFirst({
        where,
        columns: { k6VuMinutePriceCentsOverride: false },
      });
      return legacy
        ? { ...legacy, k6VuMinutePriceCentsOverride: null }
        : legacy;
    }
  }

  private async checkSpendingLimit(
    organizationId: string,
    org: typeof schema.organization.$inferSelect,
  ): Promise<{ blocked: boolean; reason?: string }> {
    const settings = await this.db.query.billingSettings.findFirst({
      where: eq(schema.billingSettings.organizationId, organizationId),
    });
    if (!settings?.enableSpendingLimit || !settings.hardStopOnLimit) {
      return { blocked: false };
    }
    if (
      !settings.monthlySpendingLimitCents ||
      settings.monthlySpendingLimitCents <= 0
    ) {
      throw new Error('Invalid spending limit configuration');
    }

    const plan = org.subscriptionPlan;
    if (plan !== 'plus' && plan !== 'pro') {
      throw new Error('Invalid cloud subscription plan');
    }
    const [limits, prices] = await Promise.all([
      this.db.query.planLimits.findFirst({
        where: eq(schema.planLimits.plan, plan),
      }),
      this.getAdmissionPricing(plan),
    ]);
    if (!limits || !prices) {
      throw new Error('Billing plan or pricing is unavailable');
    }

    // Match the app's estimate: the cap covers all billable meters, including
    // completed SRE investigations. AI credits have no overage charge.
    const playwrightOverage = Math.max(
      0,
      (org.playwrightMinutesUsed ?? 0) - limits.playwrightMinutesIncluded,
    );
    const k6Overage = Math.max(
      0,
      (org.k6VuMinutesUsed ?? 0) - limits.k6VuMinutesIncluded,
    );
    const sreOverage = Math.max(
      0,
      Number(org.sreInvestigationUnitsUsed ?? 0) -
        Number(limits.sreInvestigationUnitsIncluded),
    );
    const totalOverageCents =
      playwrightOverage * prices.playwrightMinutePriceCents +
      ceilUsageCostCents(
        k6Overage,
        prices.k6VuMinutePriceCentsOverride ?? prices.k6VuMinutePriceCents,
      ) +
      ceilUsageCostCents(sreOverage, prices.sreInvestigationUnitPriceCents);
    if (!Number.isFinite(totalOverageCents)) {
      throw new Error('Invalid usage or pricing configuration');
    }

    if (totalOverageCents >= settings.monthlySpendingLimitCents) {
      return {
        blocked: true,
        reason:
          `Monthly spending limit of $${(settings.monthlySpendingLimitCents / 100).toFixed(2)} reached. ` +
          `Current spending: $${(totalOverageCents / 100).toFixed(2)}.`,
      };
    }
    return { blocked: false };
  }

  /**
   * Check if execution should be blocked before starting
   * Call this before starting a new execution
   */
  async shouldBlockExecution(
    organizationId: string,
    options: { checkSpendingLimit?: boolean } = {},
  ): Promise<{ blocked: boolean; reason?: string }> {
    if (isSelfHosted()) return { blocked: false };
    if (!process.env.POLAR_ACCESS_TOKEN) {
      return {
        blocked: true,
        reason: 'Cloud billing enforcement is not configured',
      };
    }

    try {
      // Recheck at execution time: queued jobs and recurring monitors can
      // outlive the subscription that originally authorized them.
      const org = await this.db.query.organization.findFirst({
        where: eq(schema.organization.id, organizationId),
      });
      const hasAccess =
        org &&
        org.polarCustomerId &&
        (org.subscriptionPlan === 'plus' || org.subscriptionPlan === 'pro') &&
        (org.subscriptionStatus === 'active' ||
          org.subscriptionStatus === 'past_due' ||
          (org.subscriptionStatus === 'canceled' &&
            org.subscriptionEndsAt &&
            org.subscriptionEndsAt.getTime() > Date.now()));
      if (!hasAccess || !org) {
        return { blocked: true, reason: 'An active subscription is required' };
      }
      if (options.checkSpendingLimit === false) return { blocked: false };
      return await this.checkSpendingLimit(organizationId, org);
    } catch (error) {
      this.logger.error(
        `[Usage] Failed to check billing for org ${organizationId?.slice(0, 8)}...: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        blocked: true,
        reason: 'Unable to verify the organization spending limit',
      };
    }
  }
}
