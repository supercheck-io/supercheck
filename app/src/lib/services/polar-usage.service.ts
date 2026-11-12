import { ceilUsageCostCents } from "@/lib/billing/usage-cost";
import { DEFAULT_OVERAGE_PRICING_CENTS } from "@/lib/billing/pricing-defaults";
import { getBillingReconciliationStatus, REJECTED_USAGE_EVENT_ERROR } from "@/lib/billing/reconciliation-status";
import { reconcilePolarSubscriptions } from "./subscription-reconciliation";
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
 *   API-level enforcement, and batch retry of failed syncs via scheduler.
 */

import { withUsageSyncLease } from "@/lib/billing/usage-sync-lease";
import { db } from "@/utils/db";
import {
  organization,
  usageEvents,
  overagePricing,
  planLimits,
} from "@/db/schema";
import { eq, and, sql, gt, lte, or, isNull, isNotNull, ne, notInArray } from "drizzle-orm";
import { isPolarEnabled, getPolarConfig } from "@/lib/feature-flags";
import { createLogger } from "@/lib/logger/index";
import {
  createPolarClient,
  POLAR_API_VERSION,
  type PolarClient,
} from "@/lib/billing/polar-client";
import { billingSettingsService } from "./billing-settings.service";
import { checkedTick } from "@/lib/sentry-lazy";

// Matches the scheduler interval so the cron monitor does not report missed check-ins.
const usageSyncIntervalMinutes = () => (Number(process.env.USAGE_SYNC_INTERVAL_MS) > 0 ? Number(process.env.USAGE_SYNC_INTERVAL_MS) : 5 * 60_000) / 60_000;

const logger = createLogger({ module: "polar-usage" }) as {
  info: (data: unknown, message?: string) => void;
  warn: (data: unknown, message?: string) => void;
  error: (data: unknown, message?: string) => void;
};

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
  sreInvestigations: {
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

const POLAR_INGEST_TIMEOUT_MS = 15_000;
// Bounds the final flush that runs while an organization delete holds its row lock.
/** A request's timeout: the usual limit, cut to what is left of the caller's deadline (at least 1 ms). */
export function ingestTimeoutMs(deadline?: number, now = Date.now()): number {
  return deadline === undefined ? POLAR_INGEST_TIMEOUT_MS : Math.max(1, Math.min(POLAR_INGEST_TIMEOUT_MS, deadline - now));
}

const MIN_INGEST_BUDGET_MS = 250;
const ORGANIZATION_FLUSH_LIMIT = 200;
const ORGANIZATION_FLUSH_BUDGET_MS = 30_000;
export { POLAR_API_VERSION };
export const CLOSED_USAGE_PERIOD_ERROR = "Billing period closed; manual reconciliation required";
const MAX_REJECTED_USAGE_ATTEMPTS = 3;

/** Polar's HTTP status only: response bodies can echo customer identifiers, so they are never kept. */
class PolarIngestError extends Error {
  constructor(readonly status: number) {
    super(`Polar API error (${status})`);
  }
}

/**
 * Rejections specific to one event that a retry cannot fix. Other 4xx (401/403 credentials, 402, 408,
 * 409, 425, 429) are about the account or a temporary condition, so they stay retryable.
 */
export function isNonRetryableIngestStatus(status: number): boolean {
  return [400, 404, 410, 413, 422].includes(status);
}

type UsageSyncResult = {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
  reconciliation?: Awaited<ReturnType<typeof getBillingReconciliationStatus>>;
};
const FALLBACK_OVERAGE_PRICING_CENTS = DEFAULT_OVERAGE_PRICING_CENTS;

/**
 * Whole percent reached, floored after removing floating-point noise.
 * No allowance (or invalid input) reports 100% so alerts fail safe.
 */
function usagePercentage(used: number, included: number): number {
  if (!(included > 0) || !Number.isFinite(used)) return 100;
  return Math.max(0, Math.floor(Number(((used * 100) / included).toFixed(6))));
}

class PolarUsageService {
  private polarClient: PolarClient | null = null;

  private async checkRecentUsageNotifications(scanUntil: Date) {
    const scanSince = new Date(scanUntil.getTime() - 24 * 60 * 60 * 1000);
    const changedOrganizations = await db
      .selectDistinct({ organizationId: organization.id })
      .from(organization)
      .leftJoin(usageEvents, and(
        eq(usageEvents.organizationId, organization.id),
        gt(usageEvents.createdAt, scanSince),
        lte(usageEvents.createdAt, scanUntil),
      ))
      .where(
        and(
          // AI credits are local quota writes, not billable ledger events.
          or(gt(organization.aiCreditsUsed, 0), isNotNull(usageEvents.id)),
          isNotNull(organization.polarCustomerId),
          or(eq(organization.subscriptionPlan, "plus"), eq(organization.subscriptionPlan, "pro")),
          or(eq(organization.subscriptionStatus, "active"), eq(organization.subscriptionStatus, "past_due"),
            and(eq(organization.subscriptionStatus, "canceled"), gt(organization.subscriptionEndsAt, scanUntil))),
        )
      );

    if (changedOrganizations.length === 0) {
      return;
    }

    const { usageNotificationService } = await import(
      "@/lib/services/usage-notification.service"
    );

    for (const { organizationId } of changedOrganizations) {
      await usageNotificationService.checkAndNotify(organizationId);
    }

  }

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
      const config = getPolarConfig();
      
      if (!config?.accessToken) {
        logger.warn({}, "No Polar access token configured");
        return null;
      }

      this.polarClient = createPolarClient({
        accessToken: config.accessToken,
        server: config.server,
      });

      return this.polarClient;
    } catch (error) {
      logger.error({ error }, "Failed to initialize Polar client");
      return null;
    }
  }

  /**
   * Sync a usage event to Polar using their Events Ingestion API
   * Uses Polar SDK's usage metering endpoint
   */
  private async syncEventToPolar(
    eventId: string,
    database: Pick<typeof db, "query" | "update"> = db,
    /** Latest time this send may take; bounds the request so a caller holding locks has a hard limit. */
    deadline?: number,
  ): Promise<boolean> {
    try {
      const polar = await this.getPolarClient();
      if (!polar) {
        logger.warn({}, "Polar client unavailable; skipping usage sync");
        return false;
      }

      // Fetch the usage event
      const usageEvent = await database.query.usageEvents.findFirst({
        where: eq(usageEvents.id, eventId),
      });

      if (!usageEvent) {
        logger.warn({ eventId }, "Polar usage event not found");
        return false;
      }
      if (usageEvent.syncedToPolar) return true;
      // Polar bills by receipt time. Replaying a closed period into a new
      // cycle can charge the wrong allowance, so retain it for reconciliation.
      if (!usageEvent.billingPeriodEnd || usageEvent.billingPeriodEnd.getTime() <= Date.now()) {
        throw new Error(CLOSED_USAGE_PERIOD_ERROR);
      }

      // Get organization with Polar customer ID
      const org = await database.query.organization.findFirst({
        where: eq(organization.id, usageEvent.organizationId),
      });

      if (!org?.polarCustomerId) {
        throw new Error("Organization has no Polar customer ID");
      }

      // Get the Polar config
      const config = getPolarConfig();
      if (!config?.accessToken) {
        logger.warn({}, "No Polar access token configured");
        return false;
      }

      // Determine the meter name based on event type
      // These meter names should match what's configured in Polar dashboard
      let meterName: string;
      if (usageEvent.eventType === 'k6_execution') {
        meterName = 'k6_vu_minutes';
      } else if (usageEvent.eventType === 'ai_usage') {
        meterName = 'ai_credits';
      } else if (usageEvent.eventType === 'sre_investigation') {
        meterName = 'sre_investigations';
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
            'Polar-Version': POLAR_API_VERSION,
          },
          body: JSON.stringify({
            events: [{
              // Customer ID for this event
              customer_id: org.polarCustomerId,
              // Event name matches the meter filter in Polar
              name: meterName,
              // Polar deduplicates retries by external_id. Both the worker's
              // immediate sender and this scheduler use the same ledger ID.
              external_id: eventId,
              // Timestamp when the usage occurred
              timestamp: usageEvent.createdAt?.toISOString() || new Date().toISOString(),
              // Metadata including the usage value
              metadata: {
                event_id: eventId,
                event_type: usageEvent.eventType,
                unit_type: usageEvent.unitType,
                value: Number(usageEvent.units),
                ...(typeof usageEvent.metadata?.useLiveConnectors === "boolean"
                  ? {
                      useLiveConnectors: usageEvent.metadata.useLiveConnectors,
                    }
                  : {}),
              },
            }],
          }),
          signal: AbortSignal.timeout(ingestTimeoutMs(deadline)),
        }
      );

      if (!response.ok) {
        throw new PolarIngestError(response.status);
      }

      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Polar did not acknowledge the usage event");
      }
      const inserted = "inserted" in result ? result.inserted : undefined;
      const duplicates = "duplicates" in result ? (result.duplicates ?? 0) : 0;
      if (
        typeof inserted !== "number" || !Number.isInteger(inserted) || inserted < 0 ||
        typeof duplicates !== "number" || !Number.isInteger(duplicates) || duplicates < 0 ||
        inserted + duplicates !== 1
      ) {
        throw new Error("Polar did not acknowledge the usage event");
      }

      // Mark as synced
      await database
        .update(usageEvents)
        .set({
          syncedToPolar: true,
          polarEventId: eventId,
          lastSyncAttempt: new Date(),
          syncError: null,
        })
        .where(eq(usageEvents.id, eventId));

      logger.info({ eventId }, "Synced usage event to Polar");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error({ message, eventId }, "Failed to sync usage event to Polar");
      const rejected = error instanceof PolarIngestError && isNonRetryableIngestStatus(error.status);

      // shortcut: syncAttempts is cumulative, so earlier transient failures count toward parking; fine for a safety net, count rejections separately if it parks too eagerly.
      // Update sync status with error; a repeatedly rejected event is parked instead of retried forever
      await database
        .update(usageEvents)
        .set({
          syncError: rejected
            ? sql`CASE WHEN ${usageEvents.syncAttempts} + 1 >= ${MAX_REJECTED_USAGE_ATTEMPTS} THEN ${REJECTED_USAGE_EVENT_ERROR} ELSE ${message} END`
            : message,
          syncAttempts: sql`${usageEvents.syncAttempts} + 1`,
          lastSyncAttempt: new Date(),
        })
        .where(eq(usageEvents.id, eventId));

      return false;
    }
  }

  /**
   * Sends an organization's unsynced usage now. Called before its subscription is cancelled
   * immediately, because Polar invoices only the usage ingested up to the cancellation.
   * Events of a closed billing period stay parked, as in the scheduled sync.
   * Returns how many syncable events are still unsent (0 means everything was delivered).
   */
  async flushOrganizationUsage(organizationId: string): Promise<{ synced: number; pending: number }> {
    const pendingEvents = await db.query.usageEvents.findMany({
      where: and(
        eq(usageEvents.organizationId, organizationId),
        eq(usageEvents.syncedToPolar, false),
        gt(usageEvents.billingPeriodEnd, new Date()),
        or(isNull(usageEvents.syncError), ne(usageEvents.syncError, REJECTED_USAGE_EVENT_ERROR)),
      ),
      columns: { id: true },
      orderBy: (events, { asc }) => [asc(events.createdAt)],
      limit: ORGANIZATION_FLUSH_LIMIT + 1,
    });
    const deadline = Date.now() + ORGANIZATION_FLUSH_BUDGET_MS;
    let synced = 0;
    // Send a bounded batch; any remainder is reported as pending and a retry continues from there.
    for (const event of pendingEvents.slice(0, ORGANIZATION_FLUSH_LIMIT)) {
      // Too little budget left to finish a request: stop without recording a failed attempt for a healthy event.
      if (deadline - Date.now() < MIN_INGEST_BUDGET_MS) break;
      // Stop on the first failure: the deletion aborts anyway, so do not hold its locks for more sends.
      if (await this.syncEventToPolar(event.id, db, deadline)) synced++;
      else break;
    }
    return { synced, pending: pendingEvents.length - synced };
  }

  /**
   * Get detailed usage metrics for an organization
   */
  async getUsageMetrics(organizationId: string, projection?: { database: Pick<typeof db, "query">; additionalSreUnits: number }): Promise<UsageMetrics> {
    const database = projection?.database ?? db;
    const org = await database.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    if (!org) {
      throw new Error("Organization not found");
    }

    // Get plan limits
    const { subscriptionService } = await import("./subscription-service");
    const plan = projection
      ? await database.query.planLimits.findFirst({ where: eq(planLimits.plan, org.subscriptionPlan ?? "plus") })
      : await subscriptionService.getOrganizationPlanSafe(organizationId);
    if (!plan) throw new Error("Billing plan configuration unavailable");

    // Get overage pricing
    const pricing = await this.getOveragePricing(org.subscriptionPlan || "plus", database);

    const playwrightUsed = org.playwrightMinutesUsed || 0;
    const k6Used = org.k6VuMinutesUsed || 0;
    const aiCreditsUsed = org.aiCreditsUsed || 0;
    const sreInvestigationsUsed = Number(org.sreInvestigationUnitsUsed || 0) + (projection?.additionalSreUnits ?? 0);

    const playwrightOverage = Math.max(0, playwrightUsed - plan.playwrightMinutesIncluded);
    const k6Overage = Math.max(0, k6Used - plan.k6VuMinutesIncluded);
    const aiCreditsOverage = Math.max(0, aiCreditsUsed - plan.aiCreditsIncluded);
    const sreInvestigationsIncluded = Number(plan.sreInvestigationUnitsIncluded || 0);
    const sreInvestigationsOverage = Math.max(0, sreInvestigationsUsed - sreInvestigationsIncluded);

    const planForPricing = org.subscriptionPlan === "pro" ? "pro" : "plus";
    const fallbackPricing = FALLBACK_OVERAGE_PRICING_CENTS[planForPricing];
    const playwrightOverageCost =
      playwrightOverage *
      (pricing?.playwrightMinutePriceCents ?? fallbackPricing.playwrightMinutes);
    const k6OverageCost = ceilUsageCostCents(
      k6Overage, (pricing?.k6VuMinutePriceCentsOverride ?? pricing?.k6VuMinutePriceCents ?? fallbackPricing.k6VuMinutes)
    );
    // AI credits use hard-limit model (no overage billing)
    const aiCreditsOverageCost = 0;
    const sreInvestigationsOverageCost = ceilUsageCostCents(
      sreInvestigationsOverage,
        (pricing?.sreInvestigationUnitPriceCents ?? fallbackPricing.sreInvestigationUnits)
    );

    // Floor so threshold alerts fire only once usage has actually reached
    // the threshold; rounding would report 99.5% of a quota as 100%.
    const playwrightPercentage = usagePercentage(playwrightUsed, plan.playwrightMinutesIncluded);
    const k6Percentage = usagePercentage(k6Used, plan.k6VuMinutesIncluded);
    const aiPercentage = usagePercentage(aiCreditsUsed, plan.aiCreditsIncluded);
    const sreInvestigationsPercentage = usagePercentage(sreInvestigationsUsed, sreInvestigationsIncluded);

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
      sreInvestigations: {
        used: sreInvestigationsUsed,
        included: sreInvestigationsIncluded,
        overage: sreInvestigationsOverage,
        overageCostCents: sreInvestigationsOverageCost,
        percentage: sreInvestigationsPercentage,
      },
      totalOverageCostCents: playwrightOverageCost + k6OverageCost + sreInvestigationsOverageCost,
      periodStart: org.usagePeriodStart,
      periodEnd: org.usagePeriodEnd,
    };
  }

  /**
   * Get spending status for an organization
   */
  async getSpendingStatus(organizationId: string, projection?: { database: Pick<typeof db, "query">; additionalSreUnits: number }): Promise<SpendingStatus> {
    // Get billing settings
    const cap = await billingSettingsService.getEffectiveSpendingLimit(organizationId, projection?.database ?? db);

    // Get current usage metrics
    const metrics = await this.getUsageMetrics(organizationId, projection);
    const currentSpendingCents = metrics.totalOverageCostCents;

    const limitEnabled = cap.enabled;
    const limitCents = cap.limitCents || null;
    const hardStopEnabled = cap.hardStop;

    let percentageUsed = 0;
    let isAtLimit = false;
    let remainingCents: number | null = null;

    if (limitEnabled && limitCents !== null && limitCents > 0) {
      percentageUsed = Math.floor((currentSpendingCents * 100) / limitCents);
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
  async getOveragePricing(plan: "plus" | "pro" | "unlimited", database: Pick<typeof db, "query"> = db) {
    if (plan === "unlimited") {
      return null; // No overage for unlimited plan
    }

    return database.query.overagePricing.findFirst({
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
   * Safe to call from the app scheduler, an external cron, or manually.
   */
  async syncPendingEvents(batchSize: number = 50): Promise<UsageSyncResult> {
    if (!isPolarEnabled()) {
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    }

    try {
      // Only the lease holder checks in, so idle replicas never report.
      const result = await withUsageSyncLease((assertOwned) =>
        checkedTick("usage-sync", { type: "interval", value: Math.max(1, Math.round(usageSyncIntervalMinutes())), unit: "minute" }, () =>
          this.syncPendingEventsLocked(batchSize, assertOwned),
          // Failures are returned, not thrown: report them so a Polar outage is visible.
          (r) => (r.failed > 0 && r.succeeded === 0 ? "error" : true),
        ),
      );

      if (!result) {
        logger.info({}, "Usage sync already running; skipping this run");
        return { processed: 0, succeeded: 0, failed: 0, errors: [] };
      }

      return result;
    } catch (error) {
      logger.error({ error }, "Polar batch sync failed");
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  private async syncPendingEventsLocked(batchSize: number, assertOwned: () => void): Promise<UsageSyncResult> {
    const errors: string[] = [];
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      try {
        await reconcilePolarSubscriptions(assertOwned);
      } catch (error) {
        logger.error({ error }, "Polar subscription reconciliation scan failed");
      }
      assertOwned();
      // Recover successful AI SRE runs whose post-run ledger write failed.
      // consumeSreInvestigationCredit is idempotent by investigation run ID.
      try {
        const {
          failStuckSreInvestigationRuns,
          reconcileUnbilledSreInvestigations,
        } = await import(
          "@/lib/sre/investigation-billing"
        );
        try {
          await failStuckSreInvestigationRuns();
        } catch (error) {
          logger.error({ error }, "Failed to recover stuck SRE investigation runs");
        }

        const reconciliation = await reconcileUnbilledSreInvestigations();
        if (reconciliation.processed > 0 || reconciliation.failed > 0) {
          logger.info(reconciliation, "Reconciled SRE billing");
        }
      } catch (error) {
        logger.error({ error }, "SRE billing reconciliation failed");
      }

      const deadline = Date.now() + 45_000;
      const scanUntil = new Date();
      const attemptedIds: string[] = [];
      const batchLimit = Math.min(500, Math.max(1, Math.floor(batchSize) || 50));
      while (processed < 500 && Date.now() < deadline) {
        assertOwned();
        const limit = Math.min(batchLimit, 500 - processed);
        const pendingEvents = await db.query.usageEvents.findMany({
          where: and(
            eq(usageEvents.syncedToPolar, false),
            lte(usageEvents.createdAt, scanUntil),
            ...(attemptedIds.length ? [notInArray(usageEvents.id, attemptedIds)] : []),
            or(isNull(usageEvents.syncError), notInArray(usageEvents.syncError, [CLOSED_USAGE_PERIOD_ERROR, REJECTED_USAGE_EVENT_ERROR])),
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
          limit,
          orderBy: (events, { asc }) => [
            sql`${events.lastSyncAttempt} ASC NULLS FIRST`,
            asc(events.createdAt),
          ],
        });
        for (const event of pendingEvents) {
          if (Date.now() >= deadline) break;
          assertOwned();
          processed++;
          attemptedIds.push(event.id);
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
            logger.error({ error, errorMsg }, "Polar event sync failed");
          }
        }
        if (pendingEvents.length < limit) break;
      }

      assertOwned();
      // Run notification checks while this replica still owns the global usage
      // sync lock. The durable notification ledger suppresses repeat thresholds.
      try {
        await this.checkRecentUsageNotifications(new Date());
      } catch (error) {
        logger.error({ error }, "Usage notification scan failed");
      }

      if (processed > 0) {
        logger.info(
          { succeeded, failed, processed },
          "Polar batch sync complete",
        );
      }

      let reconciliation: Awaited<ReturnType<typeof getBillingReconciliationStatus>> | undefined;
      try {
        reconciliation = await getBillingReconciliationStatus();
        if (reconciliation.requiresAttention) {
          logger.error({ reconciliation }, "Billing reconciliation requires attention");
        }
      } catch (error) {
        logger.error({ error }, "Billing reconciliation status unavailable");
      }

      return {
        processed,
        succeeded,
        failed,
        errors,
        reconciliation,
      };
    } catch (error) {
      logger.error({ error }, "Polar batch sync failed");
      return {
        processed,
        succeeded,
        failed,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }
}

// Export singleton instance
export const polarUsageService = new PolarUsageService();
