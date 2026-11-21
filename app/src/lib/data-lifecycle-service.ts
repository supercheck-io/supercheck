/**
 * Unified Data Lifecycle Management Service
 *
 * Enterprise-grade service for managing data retention, cleanup, and archival
 * across all entities (monitors, jobs, runs, playground, webhooks, etc.)
 *
 * Key Features:
 * - Pluggable cleanup strategies for different entities
 * - Two BullMQ queues: heavy retention strategies one at a time, short urgent ones (trial lifecycle,
 *   deletion sweep, credential revocation retry) on their own queue
 * - Token-owned Redis lock per strategy, renewed while a run is alive
 * - Comprehensive error handling and retry logic
 * - Detailed metrics and logging
 * - Configurable retention policies
 * - Per-entity cleanup tracking
 * - Dry-run support for testing
 * - Distributed locking to prevent concurrent cleanup
 * - Transaction support for multi-step operations
 * - **Multi-tenancy aware**: Organization-level isolation with plan-based retention
 * - **Plan-based retention**: Different retention periods per subscription plan
 *
 * Multi-Tenancy Design (Checkly-aligned):
 * - Each organization's data is cleaned based on their subscription plan's dataRetentionDays
 * - Plus plan: 7 days raw data, 30 days aggregated/job data
 * - Pro plan: 30 days raw data, 90 days aggregated/job data
 * - Unlimited plan: 7 days raw data, 90 days aggregated/job data (self-hosted seed)
 * - Daily aggregates are kept at least 90 days on every plan (status page uptime bar)
 * - No plan (trial, ended trial, never subscribed): the shortest raw window (the trial's)
 * - Cleanup is performed per-organization to respect plan limits
 *
 * PostgreSQL TTL Note:
 * - PostgreSQL does NOT have automatic TTL/row expiration like Redis or MongoDB
 * - The expiresAt column requires explicit cleanup via this service
 * - This is the recommended approach for PostgreSQL data lifecycle management
 *
 * @module data-lifecycle-service
 */

import {
  countPendingCredentialRevocations,
  retryPendingCredentialRevocations,
} from "@/lib/security/password-reset-cleanup";
import { db } from "@/utils/db";
import { TELEMETRY_RETENTION_RULES, buildCountSql, clampInt, purgeTelemetryTable, resolveBatchSize, resolveRetentionDays, resolveSafetyLimit } from "@/lib/telemetry-retention";
import { TRIAL_RETENTION } from "@/lib/execution/trial-limits";
import {
  monitorResults,
  monitors,
  runs,
  runCallbacks,
  reports,
  webhookIdempotency,
  organization,
  planLimits,
  monitorAggregates,
  jobs,
  alertHistory,
  auditLogs,
  executionEntitlements,
} from "@/db/schema";
import { sql, and, or, isNotNull, isNull, lt, lte, eq, inArray, gt, asc, type SQL } from "drizzle-orm";
import { Queue, Worker, QueueEvents } from "bullmq";
import type Redis from "ioredis";
import { buildRedisOptions, DATA_LIFECYCLE_CLEANUP_QUEUE, DATA_LIFECYCLE_URGENT_QUEUE } from "@/lib/queue";
import { acquireOwnedLock, type OwnedLock } from "@/lib/cleanup-lock";
import { watchConsumer } from "@/lib/consumer-watchdog";
import { createS3CleanupService, type ReportDeletionInput } from "./s3-cleanup";
import { isPolarEnabled } from "@/lib/feature-flags";
import { removeK6RunLinks } from "@/lib/resource-deletion/linked-records";
import { AGGREGATION_CONFIG, monitorAggregationService } from "./monitor-aggregation-service";
import { endExpiredTrials, reconcilePaidTrialSuspensions, sendTrialReminders, suspendLapsedOrganizations } from "@/lib/execution/trial-lifecycle";
import { AUDIT_RETENTION_DAYS, scrubAuditEmails } from "@/lib/audit-scrub";
import { reportProblem } from "@/lib/sentry-lazy";
import planCatalog from "@/lib/billing/plan-catalog.json";
import { rawCutoff } from "@/lib/raw-cutoff";
import { SHORTEST_RAW_RETENTION_DAYS } from "@/lib/raw-retention";
import { getRawRetentionByOrganization } from "@/lib/monitor-result-retention";

export { SHORTEST_RAW_RETENTION_DAYS, rawCutoff };
import { deliverTrialReminder } from "@/lib/execution/trial-reminder-delivery";

const QUEUE_EVENTS_READY_TIMEOUT_MS = 10_000;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Supported cleanup entity types
 * 
 * Each entity type represents a different data lifecycle operation:
 * 
 * DATA RETENTION (Cleanup Operations):
 * - "monitor_results": Raw monitor check results (individual pings, API calls)
 * - "monitor_aggregates": Computed hourly/daily metrics (P95, avg, uptime)
 * - "job_runs": Test execution results and artifacts
 * - "playground_artifacts": Temporary test runs from playground
 * - "webhook_idempotency": Webhook deduplication keys with TTL
 * - "credential_revocation_retry": Finishes credential revocations that failed after a password reset
 * - "deletion_sweep": Re-triggers stuck, due and orphaned background purges (jobs, monitors)
 * - "alert_history": Alert notification history records
 * - "audit_logs": User/system/security audit records
 * - "telemetry_retention": Agent heartbeats, finished private agent jobs, SRE health snapshots/observations/alert events, notification outbox events
 * - "trial_lifecycle": Ends expired trials (pauses monitors, archives status pages)
 * 
 * DATA PROCESSING (Aggregation Operations):
 * - "monitor_aggregation_hourly": Computes hourly metrics from raw results
 * - "monitor_aggregation_daily": Computes daily metrics from raw results
 */
export type CleanupEntityType =
  | "monitor_results"
  | "monitor_aggregates"
  | "monitor_aggregation_hourly"
  | "monitor_aggregation_daily"
  | "run_artifacts"
  | "job_runs"
  | "playground_artifacts"
  | "webhook_idempotency"
  | "credential_revocation_retry"
  | "deletion_sweep"
  | "alert_history"
  | "audit_logs"
  | "telemetry_retention"
  | "trial_lifecycle";

/**
 * Cleanup strategy configuration
 */
export interface CleanupStrategyConfig {
  /** Entity type this strategy handles */
  entityType: CleanupEntityType;

  /** Whether this strategy is enabled */
  enabled: boolean;

  /** Cron schedule for this cleanup */
  cronSchedule: string;

  /** Retention period in days (for time-based cleanup) */
  retentionDays?: number;

  /** Maximum records to delete per run */
  maxRecordsPerRun?: number;

  /** Batch size for deletion operations */
  batchSize?: number;

  /** Additional strategy-specific config */
  customConfig?: Record<string, unknown>;
}

/**
 * Result of a cleanup operation
 */
export interface CleanupOperationResult {
  success: boolean;
  entityType: CleanupEntityType;
  recordsDeleted: number;
  s3ObjectsDeleted?: number;
  duration: number;
  errors: string[];
  details: Record<string, unknown>;
}

/**
 * Data passed to cleanup jobs
 */
interface CleanupJobData {
  entityType: CleanupEntityType;
  scheduledAt: string;
  manual?: boolean;
  dryRun?: boolean;
  config: CleanupStrategyConfig;
}

/** Resume state that survives between runs (Redis in production). */
export interface CleanupCursorStore {
  get(key: string): Promise<string | null>;
  /** null clears the key. */
  set(key: string, value: string | null): Promise<void>;
}

/** Per-run context the service hands to a strategy. */
export interface CleanupContext {
  /** Aborted when the run's lock is lost: stop at the next batch boundary. */
  signal?: AbortSignal;
  cursor?: CleanupCursorStore;
}

/** Short, urgent strategies run on their own queue so a long retention sweep never delays them. */
export const URGENT_CLEANUP_ENTITY_TYPES: ReadonlySet<CleanupEntityType> = new Set([
  "trial_lifecycle",
  "deletion_sweep",
  "credential_revocation_retry",
]);

/** Lock TTL is longer than the longest run budget; a live holder renews it well before it lapses. */
const CLEANUP_LOCK_TTL_MS = 45 * 60_000;
const CLEANUP_LOCK_RENEW_MS = 5 * 60_000;
/** A run stuck past its budget stops renewing, so the lock lapses and another replica can take over. */
const CLEANUP_LOCK_MAX_HOLD_MS = 50 * 60_000;

/**
 * Organization retention info for multi-tenant cleanup
 */
interface OrganizationRetention {
  organizationId: string;
  retentionDays: number;
  plan: string;
}

// ============================================================================
// MULTI-TENANCY HELPERS
// ============================================================================

/**
 * Organizations on an active free trial. They have no subscription plan, so plan-based retention would give
 * them the default; their entitlement carries the shorter trial retention instead. An organization with a
 * plan always uses the plan, and an ended trial falls back to the default (never to a shorter period).
 * A failed lookup throws, so the caller skips cleanup rather than guessing.
 */
async function getActiveTrialOrganizationIds(): Promise<Set<string>> {
  const rows = await db
    .select({ organizationId: executionEntitlements.organizationId })
    .from(executionEntitlements)
    .where(gt(executionEntitlements.expiresAt, new Date()));
  return new Set(rows.map((row) => row.organizationId));
}

/**
 * A free trial is an organization with an unexpired entitlement and no billing history at all: no plan and no
 * subscription status. One that subscribed (even if the webhook has not set the plan yet) or whose plan was
 * cleared by a revocation keeps the default retention, so a destructive sweep never shortens it.
 */
function isOnFreeTrial(
  org: { organizationId: string; subscriptionStatus: string | null },
  activeTrials: Set<string>,
): boolean {
  return !org.subscriptionStatus && activeTrials.has(org.organizationId);
}

/** Drops settings whose window is not a positive number of days: a 0 or a negative value would delete everything. */
function withValidDays<T extends { organizationId: string }>(rows: T[], days: (row: T) => number, kind: string): T[] {
  return rows.filter((row) => {
    const value = days(row);
    if (Number.isInteger(value) && value >= 1) return true;
    console.error(`[DATA_LIFECYCLE] Skipping ${kind} cleanup of org ${row.organizationId.substring(0, 8)}: retention ${value} is not a positive number of days`);
    return false;
  });
}

/**
 * Raw monitor-result retention of every organization, ordered by organization id, by the shared rule in
 * `resolveRawRetention` (also used by the UI). Skipped organizations are logged and left out.
 * A failed lookup throws, so the caller skips cleanup rather than guessing.
 */
export async function getOrganizationRetentionSettings(): Promise<OrganizationRetention[]> {
  try {
    const settings: OrganizationRetention[] = [];
    for (const [organizationId, { plan, decision }] of await getRawRetentionByOrganization()) {
      if ("skip" in decision) {
        console.warn(`[DATA_LIFECYCLE] Skipping monitor_results cleanup of org ${organizationId.substring(0, 8)}: ${decision.skip}`);
      } else {
        settings.push({ organizationId, retentionDays: decision.days, plan });
      }
    }
    return settings;
  } catch (error) {
    console.warn(
      "[DATA_LIFECYCLE] Failed to fetch organization retention settings, skipping cleanup:",
      error
    );
    // A lookup outage must not shorten another organization's retention.
    throw error;
  }
}

/** Aggregated retention for an organization with no plan: the shortest window any plan (or the trial) keeps. */
export const SHORTEST_AGGREGATED_RETENTION_DAYS = Math.min(
  planCatalog.plus.limits.aggregatedDataRetentionDays,
  planCatalog.pro.limits.aggregatedDataRetentionDays,
  TRIAL_RETENTION.aggregatedDataRetentionDays,
);

/**
 * Get aggregated data retention settings for all organizations
 *
 * Returns a list of organization IDs with their aggregated data retention periods
 * based on subscription plans. Used by MonitorAggregatesCleanupStrategy.
 */
export async function getOrganizationAggregatedRetentionSettings(
  fallbackAggregatedRetentionDays: number
): Promise<
  Array<{
    organizationId: string;
    aggregatedRetentionDays: number;
    plan: string;
  }>
> {
  try {
    // In self-hosted mode, use the unlimited plan's retention from database
    if (!isPolarEnabled()) {
      // Ordered by id: the aggregate cleanup's resume cursor depends on it.
      const orgs = await db.select({ id: organization.id }).from(organization).orderBy(asc(organization.id));

      // Fetch the unlimited plan's aggregated retention from database
      const unlimitedPlan = await db
        .select({ aggregatedDataRetentionDays: planLimits.aggregatedDataRetentionDays })
        .from(planLimits)
        .where(eq(planLimits.plan, "unlimited"))
        .limit(1);

      // Use database value if available, otherwise fallback
      const aggregatedRetentionDays =
        unlimitedPlan[0]?.aggregatedDataRetentionDays ?? fallbackAggregatedRetentionDays;

      return withValidDays(
        orgs.map((org) => ({ organizationId: org.id, aggregatedRetentionDays, plan: "unlimited" })),
        (row) => row.aggregatedRetentionDays,
        "monitor_aggregates",
      );
    }

    // In cloud mode, fetch each org's plan and corresponding aggregated retention
    const orgsWithPlans = await db
      .select({
        organizationId: organization.id,
        subscriptionPlan: organization.subscriptionPlan,
        subscriptionStatus: organization.subscriptionStatus,
      })
      .from(organization)
      .orderBy(asc(organization.id));

    // Get all plan limits for lookup
    const plans = await db.select().from(planLimits);
    const planAggregatedRetentionMap = new Map(
      plans.map((p) => [p.plan, p.aggregatedDataRetentionDays])
    );

    return withValidDays(orgsWithPlans.map((org) => ({
      organizationId: org.organizationId,
      aggregatedRetentionDays: org.subscriptionPlan
        ? planAggregatedRetentionMap.get(org.subscriptionPlan) ??
          fallbackAggregatedRetentionDays
        : org.subscriptionStatus === "active" || org.subscriptionStatus === "past_due"
          // Plan not set yet by the webhook: never shorten, keep the long fallback.
          ? fallbackAggregatedRetentionDays
          // No plan (trial, ended trial, canceled, never subscribed): the shortest plan's window.
          : SHORTEST_AGGREGATED_RETENTION_DAYS,
      plan: org.subscriptionPlan || "none",
    })), (row) => row.aggregatedRetentionDays, "monitor_aggregates");
  } catch (error) {
    console.warn(
      "[DATA_LIFECYCLE] Failed to fetch organization aggregated retention settings, using fallback:",
      error
    );
    // No settings: this run deletes no aggregates.
    return [];
  }
}

/**
 * Get job data retention settings for all organizations
 *
 * Returns a list of organization IDs with their job data retention periods
 * based on subscription plans. Used by JobRunsCleanupStrategy.
 *
 * Industry standards:
 * - GitHub Actions: 90 days default (up to 400 for private repos)
 * - CircleCI: 30 days max
 * - GitLab CI: 30-90 days depending on plan
 *
 * Supercheck values:
 * - Plus: 30 days
 * - Pro: 90 days
 * - Unlimited: 90 days (self-hosted database seed and subscription-service fallback)
 */
export async function getOrganizationJobRetentionSettings(
  fallbackJobRetentionDays: number
): Promise<
  Array<{
    organizationId: string;
    jobRetentionDays: number;
    plan: string;
  }>
> {
  try {
    // In self-hosted mode, use the unlimited plan's retention from database
    if (!isPolarEnabled()) {
      const orgs = await db.select({ id: organization.id }).from(organization);

      // Fetch the unlimited plan's job retention from database
      const unlimitedPlan = await db
        .select({ jobDataRetentionDays: planLimits.jobDataRetentionDays })
        .from(planLimits)
        .where(eq(planLimits.plan, "unlimited"))
        .limit(1);

      // Use database value if available, otherwise fallback
      const jobRetentionDays =
        unlimitedPlan[0]?.jobDataRetentionDays ?? fallbackJobRetentionDays;

      return withValidDays(
        orgs.map((org) => ({ organizationId: org.id, jobRetentionDays, plan: "unlimited" })),
        (row) => row.jobRetentionDays,
        "job_runs",
      );
    }

    // In cloud mode, fetch each org's plan and corresponding job retention
    const orgsWithPlans = await db
      .select({
        organizationId: organization.id,
        subscriptionPlan: organization.subscriptionPlan,
        subscriptionStatus: organization.subscriptionStatus,
      })
      .from(organization);

    // Get all plan limits for lookup
    const plans = await db.select().from(planLimits);
    const planJobRetentionMap = new Map(
      plans.map((p) => [p.plan, p.jobDataRetentionDays])
    );

    const trialOrganizations = await getActiveTrialOrganizationIds();

    return withValidDays(orgsWithPlans.map((org) => ({
      organizationId: org.organizationId,
      jobRetentionDays: org.subscriptionPlan
        ? planJobRetentionMap.get(org.subscriptionPlan) ??
          fallbackJobRetentionDays
        : isOnFreeTrial(org, trialOrganizations)
          ? TRIAL_RETENTION.jobDataRetentionDays
          : fallbackJobRetentionDays,
      plan: org.subscriptionPlan || "fallback",
    })), (row) => row.jobRetentionDays, "job_runs");
  } catch (error) {
    console.warn(
      "[DATA_LIFECYCLE] Failed to fetch organization job retention settings, skipping cleanup:",
      error
    );
    // A lookup outage must not shorten another organization's retention.
    throw error;
  }
}

// ============================================================================
// CLEANUP STRATEGY INTERFACE
// ============================================================================

/**
 * Base interface for all cleanup strategies
 */
export interface ICleanupStrategy {
  entityType: CleanupEntityType;
  config: CleanupStrategyConfig;

  /**
   * Execute the cleanup operation. Long strategies stop at a batch boundary once `context.signal` aborts.
   */
  execute(dryRun?: boolean, context?: CleanupContext): Promise<CleanupOperationResult>;

  /**
   * Validate the strategy configuration
   */
  validate(): void;

  /**
   * Get current statistics for this entity
   */
  getStats(): Promise<{ totalRecords: number; oldRecords: number }>;
}

// ============================================================================
// CLEANUP STRATEGIES
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;
/** A run stops at a batch boundary after this long and reports `partial`; the next hourly run resumes. */
export const RETENTION_RUN_BUDGET_MS = 40 * 60_000;
/** One organization gets at most this share of a run's budget, so a slow backlog cannot hold up the ones after it. */
const ORG_BUDGET_SHARE = 4;
/** Lag past a class's window, in days, before cleanup is reported as falling behind. */
export const RETENTION_LAG_ALERT_DAYS = 2;
const MONITOR_RESULTS_CURSOR_KEY = "cleanup:monitor_results:org-cursor";
const MONITOR_AGGREGATES_CURSOR_KEY = "cleanup:monitor_aggregates:org-cursor";

/** Organizations after the cursor first, then the ones before it, so a stopped run continues where it ended. */
function resumeOrder<T extends { organizationId: string }>(orgs: T[], after: string | null): T[] {
  return after ? [...orgs.filter((o) => o.organizationId > after), ...orgs.filter((o) => o.organizationId <= after)] : orgs;
}
/** Artifact rows call object storage per row, so they go in smaller batches than the single-statement fast path. */
const ARTIFACT_BATCH_SIZE = 500;

/** Rows that may point at a stored report: deleted through object storage first. */
const hasArtifact = sql`(${monitorResults.testExecutionId} IS NOT NULL OR ${monitorResults.testReportS3Url} IS NOT NULL OR coalesce(${monitorResults.details} ? 'reportUrl', false))`;

type StopReason = "budget" | "lock";

interface RunLimits {
  deadline: number;
  signal?: AbortSignal;
  pauseMs: number;
}

const stopReason = ({ deadline, signal }: RunLimits): StopReason | null =>
  signal?.aborted ? "lock" : Date.now() >= deadline ? "budget" : null;

const pause = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** Budget, per-organization cap and pause for a run; `customConfig` overrides them (tests). */
function runSettings(config: CleanupStrategyConfig, defaults: { batchSize: number; perOrgCap: number }) {
  const custom = config.customConfig ?? {};
  const positive = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  return {
    batchSize: positive(config.batchSize, defaults.batchSize),
    perOrgCap: positive(config.maxRecordsPerRun, defaults.perOrgCap),
    budgetMs: positive(custom.timeBudgetMs, RETENTION_RUN_BUDGET_MS),
    pauseMs: typeof custom.pauseMs === "number" && custom.pauseMs >= 0 ? custom.pauseMs : 100,
  };
}

export interface RetentionLag {
  retentionDays: number;
  /** Age in days of the oldest row in this class that cleanup should already have removed. */
  oldestAgeDays: number;
  lagDays: number;
  organizations: number;
}

/**
 * Lag of each retention class from the oldest row per organization (one indexed top-1 lookup per monitor).
 * A class whose oldest row is more than RETENTION_LAG_ALERT_DAYS past its window is logged as a structured error
 * and captured as an error event (Cloud only), so falling behind is seen.
 */
export async function measureRetentionLag(
  table: "monitor_results" | "monitor_aggregates_hourly" | "monitor_aggregates_daily",
  oldestByOrg: Map<string, Date>,
  windowByOrg: Map<string, number>,
  now = Date.now(),
): Promise<RetentionLag[]> {
  const classes = new Map<number, RetentionLag>();
  for (const [organizationId, days] of windowByOrg) {
    const entry = classes.get(days) ?? { retentionDays: days, oldestAgeDays: 0, lagDays: 0, organizations: 0 };
    entry.organizations++;
    const oldest = oldestByOrg.get(organizationId);
    if (oldest) {
      const age = (now - oldest.getTime()) / DAY_MS;
      entry.oldestAgeDays = Math.max(entry.oldestAgeDays, Math.round(age * 100) / 100);
      entry.lagDays = Math.max(entry.lagDays, Math.round((age - days) * 100) / 100);
    }
    classes.set(days, entry);
  }
  const lags = [...classes.values()].sort((a, b) => a.retentionDays - b.retentionDays);
  for (const lag of lags.filter((l) => l.lagDays > RETENTION_LAG_ALERT_DAYS)) {
    console.error(JSON.stringify({ event: "retention_lag", table, ...lag }));
    reportProblem(`Retention cleanup is behind: ${table} ${lag.retentionDays}-day class`, ["retention-lag", table, String(lag.retentionDays)], { table, ...lag });
  }
  return lags;
}

/**
 * Monitor Results Cleanup Strategy
 *
 * Deletes raw monitor_results past each organization's raw retention (getOrganizationRetentionSettings):
 * - Organizations are walked in id order, each organization's monitors once per run.
 * - Per monitor, plain rows go in single-statement batches on (monitor_id, checked_at), then rows that may hold a
 *   report (object storage, then one transaction). Status-change rows are kept; their reports expire.
 * - A per-organization row cap keeps one heavy organization from starving the rest, and a time budget ends the
 *   run at a batch boundary with `partial: true` (a success, so no retry). A Redis cursor holding the last
 *   finished organization lets the next run carry on from there.
 */
export class MonitorResultsCleanupStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "monitor_results";
  config: CleanupStrategyConfig;
  private s3Service: ReturnType<typeof createS3CleanupService>;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
    this.s3Service = createS3CleanupService();
    this.validate();
  }

  validate(): void {}

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    // Planner estimates: exact counts scan the whole table. Old rows are those past the shortest raw window.
    const cutoff = new Date(Date.now() - SHORTEST_RAW_RETENTION_DAYS * DAY_MS);
    const [totalRecords, oldRecords] = await Promise.all([
      estimateTableRows("monitor_results"),
      estimateRows(sql`SELECT 1 FROM monitor_results WHERE checked_at < ${cutoff.toISOString()}::timestamptz AND NOT is_status_change`),
    ]);
    return { totalRecords, oldRecords };
  }

  async execute(dryRun = false, context: CleanupContext = {}): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const settings = runSettings(this.config, { batchSize: 5000, perOrgCap: 500_000 });
    const limits: RunLimits = { deadline: startTime + settings.budgetMs, signal: context.signal, pauseMs: settings.pauseMs };

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      s3ObjectsDeleted: 0,
      duration: 0,
      errors: [],
      details: { dryRun, multiTenant: true, organizationsProcessed: 0, partial: false },
    };
    const orgStats: Record<string, { deleted: number; retentionDays: number; capped?: boolean }> = {};

    try {
      const orgRetentions = await getOrganizationRetentionSettings();

      if (dryRun) {
        for (const org of orgRetentions) {
          const count = await this.countResultsToClean(org, settings.perOrgCap);
          if (count.deleted > 0) orgStats[org.organizationId] = { deleted: count.deleted, retentionDays: org.retentionDays };
          result.recordsDeleted += count.deleted;
          result.details.recordsProcessed = Number(result.details.recordsProcessed ?? 0) + count.processed;
        }
        result.details.organizationsProcessed = orgRetentions.length;
      } else {
        const ordered = resumeOrder(orgRetentions, (await context.cursor?.get(MONITOR_RESULTS_CURSOR_KEY)) ?? null);
        let lastFinished: string | null = null;
        let stopped: StopReason | null = null;

        for (const org of ordered) {
          const outcome = await this.cleanOrganization(org, settings, limits, result);
          if (outcome.deleted > 0 || outcome.capped) {
            orgStats[org.organizationId] = {
              deleted: outcome.deleted,
              retentionDays: org.retentionDays,
              ...(outcome.capped ? { capped: true } : {}),
            };
          }
          result.recordsDeleted += outcome.deleted;
          if (outcome.stopped) {
            stopped = outcome.stopped;
            break;
          }
          lastFinished = org.organizationId;
          result.details.organizationsProcessed = Number(result.details.organizationsProcessed) + 1;
        }

        if (stopped) {
          result.details.partial = true;
          result.details.stopReason = stopped;
          // A run that lost its lock leaves the cursor to the new owner.
          if (stopped === "budget" && lastFinished) await context.cursor?.set(MONITOR_RESULTS_CURSOR_KEY, lastFinished);
        } else {
          await context.cursor?.set(MONITOR_RESULTS_CURSOR_KEY, null);
        }

        // A stopped run leaves the worker at once; the next full run measures lag.
        if (!stopped) {
          try {
            result.details.lag = await measureRetentionLag(
              "monitor_results",
              await oldestRawResultByOrg(),
              new Map(orgRetentions.map((o) => [o.organizationId, o.retentionDays])),
            );
          } catch (error) {
            console.error("[DATA_LIFECYCLE] [monitor_results] Lag check failed:", error);
          }
        }
      }

      result.details.perOrgStats = orgStats;
      if (result.recordsDeleted > 0) {
        console.log(
          `[DATA_LIFECYCLE] ${this.entityType}: ${dryRun ? "Would delete" : "Deleted"} ${result.recordsDeleted} records across ${Object.keys(orgStats).length} organizations${result.details.partial ? " (partial run)" : ""}`
        );
      }
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
      console.error(`[DATA_LIFECYCLE] [${this.entityType}] Cleanup failed:`, error);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /** One organization's monitors, each once, within its share of the budget, the per-org cap and the lock. */
  private async cleanOrganization(
    org: OrganizationRetention,
    settings: ReturnType<typeof runSettings>,
    runLimits: RunLimits,
    result: CleanupOperationResult,
  ): Promise<{ deleted: number; capped: boolean; stopped: StopReason | null }> {
    const outcome = await this.cleanOrganizationWithin(org, settings, {
      ...runLimits,
      deadline: Math.min(runLimits.deadline, Date.now() + settings.budgetMs / ORG_BUDGET_SHARE),
    }, result);
    // Out of its own slice, not the run's budget: treat like the row cap and move on to the next organization.
    if (outcome.stopped === "budget" && Date.now() < runLimits.deadline) return { ...outcome, capped: true, stopped: null };
    return outcome;
  }

  private async cleanOrganizationWithin(
    org: OrganizationRetention,
    settings: ReturnType<typeof runSettings>,
    limits: RunLimits,
    result: CleanupOperationResult,
  ): Promise<{ deleted: number; capped: boolean; stopped: StopReason | null }> {
    const cutoff = rawCutoff(org.retentionDays);
    const orgMonitors = await db
      .select({ id: monitors.id })
      .from(monitors)
      .where(eq(monitors.organizationId, org.organizationId))
      .orderBy(asc(monitors.id));

    let deleted = 0;
    let processed = 0;
    for (const { id: monitorId } of orgMonitors) {
      try {
        // Plain rows first: one statement per batch, no round trip through the app. They exclude every row that may
        // hold a report, so the order of the two passes does not affect what reaches storage. Kept rows are
        // re-scanned per batch, which is bounded by how many are kept.
        for (;;) {
          const stopped = stopReason(limits);
          if (stopped) return { deleted, capped: false, stopped };
          if (processed >= settings.perOrgCap) return { deleted, capped: true, stopped: null };
          const size = Math.min(settings.batchSize, settings.perOrgCap - processed);
          const removed = await deletePlainResults(monitorId, cutoff, size);
          processed += removed;
          deleted += removed;
          if (removed < size) break;
          await pause(limits.pauseMs);
        }
        // Then rows that may point at a report: object storage first, then the row. Running after the plain pass
        // means this scan only walks rows that are kept (status changes, reports whose storage delete failed), not
        // the whole expired backlog (locally, ~1.2k filtered rows instead of ~150k per batch).
        let cursor: { checkedAt: string; id: string } | undefined;
        for (;;) {
          const stopped = stopReason(limits);
          if (stopped) return { deleted, capped: false, stopped };
          if (processed >= settings.perOrgCap) return { deleted, capped: true, stopped: null };
          const rows = await db
            .select({
              id: monitorResults.id,
              checkedAt: sql<string>`${monitorResults.checkedAt}::text`,
              isStatusChange: monitorResults.isStatusChange,
              status: monitorResults.status,
              testExecutionId: monitorResults.testExecutionId,
              testReportS3Url: monitorResults.testReportS3Url,
              reportUrl: sql<string | null>`${monitorResults.details}->>'reportUrl'`,
            })
            .from(monitorResults)
            .where(
              and(
                eq(monitorResults.monitorId, monitorId),
                lt(monitorResults.checkedAt, cutoff),
                hasArtifact,
                // Keep PostgreSQL microseconds; Date truncation can reselect a row whose storage delete failed.
                cursor
                  ? or(
                      gt(monitorResults.checkedAt, sql`${cursor.checkedAt}::timestamptz`),
                      and(eq(monitorResults.checkedAt, sql`${cursor.checkedAt}::timestamptz`), gt(monitorResults.id, cursor.id))
                    )
                  : undefined,
              )
            )
            .orderBy(asc(monitorResults.monitorId), asc(monitorResults.checkedAt), asc(monitorResults.id))
            .limit(Math.min(ARTIFACT_BATCH_SIZE, settings.batchSize, settings.perOrgCap - processed));
          if (rows.length === 0) break;
          // Only rows actually handled count against the cap: rows whose storage delete failed stay for the next
          // run and must not use up the allowance the plain rows and later monitors need.
          const handled = await this.cleanupBatch(rows, result, limits.signal);
          processed += handled.handled;
          deleted += handled.deleted;
          // Lost the lock while storage answered: stop here as a lock stop, not as the end of the pass.
          if (limits.signal?.aborted) return { deleted, capped: false, stopped: "lock" };
          // Refused rows are kept and the cursor moves past them, so healthy reports behind a failing one still
          // expire this run; the plain rows already went first, and the organization's budget share bounds the time.
          const last = rows[rows.length - 1];
          cursor = { checkedAt: last.checkedAt, id: last.id };
        }

      } catch (error) {
        // Keep this monitor's remaining rows for the next run; other monitors and organizations still run. Not a
        // run failure (that would retry the whole budgeted run): the next hourly run tries this monitor again.
        result.details.partial = true;
        result.details.failedMonitors = Number(result.details.failedMonitors ?? 0) + 1;
        result.errors.push(error instanceof Error ? error.message : String(error));
        console.error(`[DATA_LIFECYCLE] [monitor_results] Monitor ${monitorId} cleanup failed:`, error);
      }
    }
    return { deleted, capped: false, stopped: null };
  }

  private async countResultsToClean(org: OrganizationRetention, limit: number) {
    const cutoff = rawCutoff(org.retentionDays);
    const orgMonitors = db.select({ id: monitors.id }).from(monitors).where(eq(monitors.organizationId, org.organizationId));
    const candidates = db.select({ isStatusChange: monitorResults.isStatusChange })
      .from(monitorResults)
      .where(and(
        inArray(monitorResults.monitorId, orgMonitors),
        lt(monitorResults.checkedAt, cutoff),
        or(eq(monitorResults.isStatusChange, false), hasArtifact),
      ))
      .limit(limit).as("expired_monitor_results");
    const [count] = await db.select({
      count: sql<number>`count(*)`,
      deleteCount: sql<number>`count(*) FILTER (WHERE ${candidates.isStatusChange} = false)`,
    }).from(candidates);
    return { processed: Number(count?.count || 0), deleted: Number(count?.deleteCount || 0) };
  }

  private async cleanupBatch(
    rows: Array<{
      id: string;
      isStatusChange: boolean;
      status: string;
      testExecutionId: string | null;
      testReportS3Url: string | null;
      reportUrl: string | null;
    }>,
    result: CleanupOperationResult,
    signal?: AbortSignal,
  ): Promise<{ deleted: number; handled: number }> {
    const inputs: ReportDeletionInput[] = rows
      .filter(row => row.testReportS3Url || row.reportUrl || (row.status !== "up" && row.testExecutionId))
      .map(row => ({
        entityType: "monitor",
        entityId: row.id,
        reportPath: row.testExecutionId || undefined,
        s3Url: row.testReportS3Url || row.reportUrl || undefined,
      }));
    let failedIds = new Set<string>();
    if (inputs.length > 0) {
      const s3Result = await this.s3Service.deleteReports(inputs);
      result.s3ObjectsDeleted! += s3Result.deletedObjects.length;
      if (!s3Result.success) {
        failedIds = this.s3Service.getFailedReportEntityIds(inputs, s3Result);
        // Not a run failure: the pointers stay and the next hourly run retries them.
        result.errors.push(`Monitor artifact cleanup had ${s3Result.failedObjects.length} S3 failures; preserving failed pointers for retry`);
      }
    }

    rows = rows.filter(row => !failedIds.has(row.id));
    // A run that lost its lock while storage answered writes nothing more; deleting stored reports twice is harmless.
    if (rows.length === 0 || signal?.aborted) return { deleted: 0, handled: 0 };
    const executionIds = rows.flatMap(row => row.testExecutionId ? [row.testExecutionId] : []);
    const urls = rows.flatMap(row => !row.testExecutionId && row.testReportS3Url ? [row.testReportS3Url] : []);
    const deleteIds = rows.filter(row => !row.isStatusChange).map(row => row.id);
    const statusIds = rows.filter(row => row.isStatusChange).map(row => row.id);
    await db.transaction(async tx => {
      if (executionIds.length > 0 || urls.length > 0) {
        await tx.delete(reports).where(and(
          eq(reports.entityType, "monitor"),
          or(
            executionIds.length > 0 ? inArray(reports.entityId, executionIds) : undefined,
            urls.length > 0 ? inArray(reports.s3Url, urls) : undefined
          )
        ));
      }
      if (deleteIds.length > 0) {
        await tx.delete(monitorResults).where(inArray(monitorResults.id, deleteIds));
      }
      if (statusIds.length > 0) {
        await tx.update(monitorResults).set({
          testExecutionId: null,
          testReportS3Url: null,
          details: sql`${monitorResults.details} - 'reportUrl'`,
        }).where(inArray(monitorResults.id, statusIds));
      }
    });
    result.details.statusArtifactsExpired = Number(result.details.statusArtifactsExpired || 0) + statusIds.length;
    return { deleted: deleteIds.length, handled: rows.length };
  }
}

/**
 * Deletes up to `limit` plain rows of one monitor older than `cutoff`: no status change and nothing that may point at
 * a report. Rows another transaction holds are skipped (SKIP LOCKED) and picked up by a later run.
 */
async function deletePlainResults(monitorId: string, cutoff: Date, limit: number): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH picked AS (
      SELECT id FROM monitor_results
      WHERE monitor_id = ${monitorId} AND checked_at < ${cutoff.toISOString()}::timestamptz
        AND NOT is_status_change AND test_execution_id IS NULL AND test_report_s3_url IS NULL
        AND NOT coalesce(details ? 'reportUrl', false)
      -- Leading monitor_id keeps the planner on (monitor_id, checked_at), never the global checked_at index.
      ORDER BY monitor_id, checked_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM monitor_results r USING picked WHERE r.id = picked.id
    RETURNING r.id`);
  return rows.length;
}

/** Oldest non-status-change row per organization, one top-1 index probe per monitor. */
async function oldestRawResultByOrg(): Promise<Map<string, Date>> {
  const rows = await db.execute<{ organization_id: string; oldest: string }>(sql`
    SELECT m.organization_id, min(o.checked_at)::text AS oldest
    FROM monitors m
    CROSS JOIN LATERAL (
      SELECT r.checked_at FROM monitor_results r
      WHERE r.monitor_id = m.id AND NOT r.is_status_change
      ORDER BY r.monitor_id, r.checked_at LIMIT 1
    ) o
    WHERE m.organization_id IS NOT NULL
    GROUP BY m.organization_id`);
  return new Map(rows.map((row) => [row.organization_id, new Date(row.oldest)]));
}

/** Planner row estimate for a table (pg_class.reltuples); 0 before the first ANALYZE. */
async function estimateTableRows(table: string): Promise<number> {
  const [row] = await db.execute<{ n: string | number }>(
    sql`SELECT greatest(reltuples, 0)::bigint AS n FROM pg_class WHERE oid = to_regclass(${table})`
  );
  return Number(row?.n ?? 0);
}

/** Planner row estimate for a query, without running it. */
async function estimateRows(query: SQL): Promise<number> {
  const [row] = await db.execute<{ "QUERY PLAN": Array<{ Plan: { "Plan Rows": number } }> }>(
    sql`EXPLAIN (FORMAT JSON) ${query}`
  );
  return Number(row?.["QUERY PLAN"]?.[0]?.Plan?.["Plan Rows"] ?? 0);
}

/**
 * Monitor Aggregates Cleanup Strategy
 *
 * Deletes monitor_aggregates past each organization's aggregated retention (plan aggregatedDataRetentionDays):
 * - Hourly aggregates: the plan's window (Plus 30 days, Pro and self-hosted 90 by default).
 * - Daily aggregates: the plan's window, but never less than 90 days, so the status page's 90-day uptime bar is
 *   complete on every plan.
 * Batched per monitor with the same time budget and per-organization cap as raw results; a run that stops early
 * reports `partial: true` and the next run carries on.
 */
export class MonitorAggregatesCleanupStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "monitor_aggregates";
  config: CleanupStrategyConfig;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
    this.validate();
  }

  validate(): void {
    // Config retentionDays is the fallback for aggregated data retention
    if (!this.config.retentionDays || this.config.retentionDays <= 0) {
      throw new Error("Monitor aggregates cleanup requires retentionDays > 0");
    }
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    // Planner estimates against the shortest windows (hourly: the trial's, daily: the 90-day floor).
    const hourlyCutoff = new Date(Date.now() - TRIAL_RETENTION.aggregatedDataRetentionDays * DAY_MS);
    const dailyCutoff = new Date(Date.now() - AGGREGATION_CONFIG.MIN_DAILY_RETENTION_DAYS * DAY_MS);
    const [totalRecords, oldRecords] = await Promise.all([
      estimateTableRows("monitor_aggregates"),
      estimateRows(sql`SELECT 1 FROM monitor_aggregates WHERE (period_type = 'hourly' AND period_start < ${hourlyCutoff.toISOString()}::timestamptz) OR (period_type = 'daily' AND period_start < ${dailyCutoff.toISOString()}::timestamptz)`),
    ]);
    return { totalRecords, oldRecords };
  }

  async execute(dryRun = false, context: CleanupContext = {}): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const settings = runSettings(this.config, { batchSize: 5000, perOrgCap: 500_000 });
    const limits: RunLimits = { deadline: startTime + settings.budgetMs, signal: context.signal, pauseMs: settings.pauseMs };

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      duration: 0,
      errors: [],
      details: { dryRun, multiTenant: true, partial: false },
    };

    try {
      const orgRetentions = await getOrganizationAggregatedRetentionSettings(this.config.retentionDays!);
      const windows = orgRetentions.map((org) => ({
        organizationId: org.organizationId,
        hourlyDays: org.aggregatedRetentionDays,
        dailyDays: Math.max(org.aggregatedRetentionDays, AGGREGATION_CONFIG.MIN_DAILY_RETENTION_DAYS),
      }));

      let totalDeleted = 0;
      let processed = 0;
      const orgStats: Record<string, { deleted: number; hourlyDays: number; dailyDays: number; capped?: boolean }> = {};
      const ordered = dryRun ? windows : resumeOrder(windows, (await context.cursor?.get(MONITOR_AGGREGATES_CURSOR_KEY)) ?? null);
      let lastFinished: string | null = null;

      for (const org of ordered) {
        const stopped = stopReason(limits);
        if (stopped) {
          result.details.partial = true;
          result.details.stopReason = stopped;
          break;
        }
        try {
          let deleted: number;
          let capped = false;
          if (dryRun) {
            // What one run can remove: the per-organization cap applies.
            deleted = Math.min(await this.countOldAggregatesForOrg(org.organizationId, org.hourlyDays, org.dailyDays), settings.perOrgCap);
          } else {
            // Each organization gets at most its share of the budget, like raw results.
            const orgDeadline = Math.min(limits.deadline, Date.now() + settings.budgetMs / ORG_BUDGET_SHARE);
            const outcome = await monitorAggregationService.cleanupOldAggregatesForOrg(
              org.organizationId,
              org.hourlyDays,
              org.dailyDays,
              {
                batchSize: settings.batchSize,
                maxRows: settings.perOrgCap,
                pauseMs: limits.pauseMs,
                shouldStop: () => Date.now() >= orgDeadline || stopReason(limits) !== null,
              }
            );
            deleted = outcome.deleted;
            const stoppedInside = stopReason(limits);
            if (!outcome.complete && stoppedInside) {
              result.details.partial = true;
              result.details.stopReason = stoppedInside;
            } else if (!outcome.complete) {
              capped = true; // row cap or its share of the budget: the next run carries on
            }
          }
          if (deleted > 0 || capped) {
            orgStats[org.organizationId] = {
              deleted,
              hourlyDays: org.hourlyDays,
              dailyDays: org.dailyDays,
              ...(capped ? { capped: true } : {}),
            };
          }
          totalDeleted += deleted;
          if (result.details.partial) break;
          processed++;
          lastFinished = org.organizationId;
        } catch (orgError) {
          // Recorded, not a run failure: the next run tries this organization again.
          result.details.failedOrganizations = Number(result.details.failedOrganizations ?? 0) + 1;
          console.error(
            `[DATA_LIFECYCLE] [monitor_aggregates] Error cleaning up org ${org.organizationId.substring(0, 8)}:`,
            orgError
          );
          result.errors.push(
            `Org ${org.organizationId.substring(0, 8)}: ${orgError instanceof Error ? orgError.message : String(orgError)}`
          );
        }
      }

      // An organization that failed makes the run partial (a success): it is tried again next run, and like any
      // partial run it skips the lag query.
      if (result.details.failedOrganizations) result.details.partial = true;

      // An empty list (no organizations, or a failed lookup) leaves the saved position alone.
      if (!dryRun && windows.length > 0) {
        if (!result.details.partial) await context.cursor?.set(MONITOR_AGGREGATES_CURSOR_KEY, null);
        else if (result.details.stopReason === "budget" && lastFinished) await context.cursor?.set(MONITOR_AGGREGATES_CURSOR_KEY, lastFinished);
      }

      if (!dryRun && !result.details.partial) {
        try {
          const oldest = await oldestAggregateByOrg();
          result.details.lag = {
            hourly: await measureRetentionLag("monitor_aggregates_hourly", oldest.hourly, new Map(windows.map((w) => [w.organizationId, w.hourlyDays]))),
            daily: await measureRetentionLag("monitor_aggregates_daily", oldest.daily, new Map(windows.map((w) => [w.organizationId, w.dailyDays]))),
          };
        } catch (error) {
          console.error("[DATA_LIFECYCLE] [monitor_aggregates] Lag check failed:", error);
        }
      }

      result.recordsDeleted = totalDeleted;
      result.details.organizationsProcessed = processed;
      result.details.perOrgStats = orgStats;

      if (totalDeleted > 0) {
        console.log(
          `[DATA_LIFECYCLE] ${this.entityType}: ${
            dryRun ? "Would delete" : "Deleted"
          } ${totalDeleted} aggregates across ${Object.keys(orgStats).length} organizations`
        );
      }
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      console.error(
        `[DATA_LIFECYCLE] [${this.entityType}] Cleanup failed:`,
        error
      );
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Count old aggregates for a specific organization (for dry-run)
   */
  private async countOldAggregatesForOrg(
    organizationId: string,
    hourlyRetentionDays: number,
    dailyRetentionDays: number
  ): Promise<number> {
    const hourlyCutoff = new Date(Date.now() - hourlyRetentionDays * DAY_MS);
    const dailyCutoff = new Date(Date.now() - dailyRetentionDays * DAY_MS);
    const orgMonitors = db.select({ id: monitors.id }).from(monitors).where(eq(monitors.organizationId, organizationId));

    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(monitorAggregates)
      .where(
        and(
          inArray(monitorAggregates.monitorId, orgMonitors),
          or(
            and(eq(monitorAggregates.periodType, "hourly"), lt(monitorAggregates.periodStart, hourlyCutoff)),
            and(eq(monitorAggregates.periodType, "daily"), lt(monitorAggregates.periodStart, dailyCutoff))
          )
        )
      );
    return Number(row?.count || 0);
  }
}

/** Oldest hourly and daily aggregate per organization, top-1 index probes per monitor. */
async function oldestAggregateByOrg(): Promise<{ hourly: Map<string, Date>; daily: Map<string, Date> }> {
  const rows = await db.execute<{ organization_id: string; hourly: string | null; daily: string | null }>(sql`
    SELECT m.organization_id, min(h.period_start)::text AS hourly, min(d.period_start)::text AS daily
    FROM monitors m
    LEFT JOIN LATERAL (
      SELECT a.period_start FROM monitor_aggregates a
      WHERE a.monitor_id = m.id AND a.period_type = 'hourly' ORDER BY a.monitor_id, a.period_start LIMIT 1
    ) h ON true
    LEFT JOIN LATERAL (
      SELECT a.period_start FROM monitor_aggregates a
      WHERE a.monitor_id = m.id AND a.period_type = 'daily' ORDER BY a.monitor_id, a.period_start LIMIT 1
    ) d ON true
    WHERE m.organization_id IS NOT NULL
    GROUP BY m.organization_id`);
  const hourly = new Map<string, Date>();
  const daily = new Map<string, Date>();
  for (const row of rows) {
    if (row.hourly) hourly.set(row.organization_id, new Date(row.hourly));
    if (row.daily) daily.set(row.organization_id, new Date(row.daily));
  }
  return { hourly, daily };
}

/**
 * Monitor Aggregation Strategy (Hourly)
 *
 * Computes hourly aggregates from raw monitor_results data.
 * This is NOT a cleanup strategy - it creates data, not deletes it.
 *
 * Schedule: Every hour at minute 5 (e.g., 1:05, 2:05, etc.)
 * This gives 5 minutes buffer after the hour for all checks to complete.
 */
export class MonitorAggregationHourlyStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "monitor_aggregation_hourly";
  config: CleanupStrategyConfig;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
  }

  validate(): void {
    // No validation needed for aggregation
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    // Planner estimate: an exact count scans the whole table. "Old records" does not apply to aggregation.
    return { totalRecords: await estimateTableRows("monitor_aggregates"), oldRecords: 0 };
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0, // Actually records created/updated
      duration: 0,
      errors: [],
      details: { dryRun, operation: "aggregation" },
    };

    try {
      if (dryRun) {
        // In dry-run, just report what would happen
        const activeMonitors = await db
          .select({ count: sql<number>`count(*)` })
          .from(monitors)
          .where(eq(monitors.enabled, true));

        result.details.monitorsToProcess = Number(
          activeMonitors[0]?.count || 0
        );
        result.duration = Date.now() - startTime;
        return result;
      }

      // Run hourly aggregation
      const aggregationResult =
        await monitorAggregationService.runHourlyAggregation();

      result.success = aggregationResult.success;
      result.recordsDeleted =
        aggregationResult.aggregatesCreated +
        aggregationResult.aggregatesUpdated;
      result.errors = aggregationResult.errors;
      result.details = {
        ...result.details,
        monitorsProcessed: aggregationResult.monitorsProcessed,
        aggregatesCreated: aggregationResult.aggregatesCreated,
        aggregatesUpdated: aggregationResult.aggregatesUpdated,
      };
      result.duration = Date.now() - startTime;

      if (aggregationResult.aggregatesCreated > 0) {
        console.log(
          `[DATA_LIFECYCLE] Hourly aggregation: created ${aggregationResult.aggregatesCreated}, updated ${aggregationResult.aggregatesUpdated} for ${aggregationResult.monitorsProcessed} monitors`
        );
      }
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      result.duration = Date.now() - startTime;
      console.error(`[DATA_LIFECYCLE] Hourly aggregation failed:`, error);
    }

    return result;
  }
}

/**
 * Monitor Aggregation Strategy (Daily)
 *
 * Computes daily aggregates from raw monitor_results data.
 * This is NOT a cleanup strategy - it creates data, not deletes it.
 *
 * Schedule: Daily at 00:15 UTC (15 minutes after midnight)
 * This gives time for all hourly aggregates to complete first.
 */
export class MonitorAggregationDailyStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "monitor_aggregation_daily";
  config: CleanupStrategyConfig;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
  }

  validate(): void {
    // No validation needed for aggregation
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    // Planner estimate of the daily rows, without scanning them.
    return { totalRecords: await estimateRows(sql`SELECT 1 FROM monitor_aggregates WHERE period_type = 'daily'`), oldRecords: 0 };
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      duration: 0,
      errors: [],
      details: { dryRun, operation: "aggregation" },
    };

    try {
      if (dryRun) {
        const activeMonitors = await db
          .select({ count: sql<number>`count(*)` })
          .from(monitors)
          .where(eq(monitors.enabled, true));

        result.details.monitorsToProcess = Number(
          activeMonitors[0]?.count || 0
        );
        result.duration = Date.now() - startTime;
        return result;
      }

      // Run daily aggregation
      const aggregationResult =
        await monitorAggregationService.runDailyAggregation();

      result.success = aggregationResult.success;
      result.recordsDeleted =
        aggregationResult.aggregatesCreated +
        aggregationResult.aggregatesUpdated;
      result.errors = aggregationResult.errors;
      result.details = {
        ...result.details,
        monitorsProcessed: aggregationResult.monitorsProcessed,
        aggregatesCreated: aggregationResult.aggregatesCreated,
        aggregatesUpdated: aggregationResult.aggregatesUpdated,
      };
      result.duration = Date.now() - startTime;

      if (aggregationResult.aggregatesCreated > 0) {
        console.log(
          `[DATA_LIFECYCLE] Daily aggregation: created ${aggregationResult.aggregatesCreated}, updated ${aggregationResult.aggregatesUpdated} for ${aggregationResult.monitorsProcessed} monitors`
        );
      }
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      result.duration = Date.now() - startTime;
      console.error(`[DATA_LIFECYCLE] Daily aggregation failed:`, error);
    }

    return result;
  }
}

/**
 * Job Runs Cleanup Strategy
 *
 * Manages retention of runs table with:
 * - **Multi-tenant aware**: Cleans up per organization based on plan's jobDataRetentionDays
 * - Time-based retention for both job runs and playground runs
 * - Associated S3 artifacts cleanup
 * - Report table cleanup
 *
 * Plan-Based Retention (industry standards):
 * - Plus: 30 days (matches CircleCI)
 * - Pro: 90 days (matches GitHub Actions default)
 * - Unlimited: 90 days (self-hosted database seed and subscription-service fallback)
 *
 * Note: This strategy handles ALL runs in the database:
 * - Job runs (where jobId is not null)
 * - Playground runs (where jobId is null and metadata.source = 'playground')
 */
/** Permanent tombstones cover PUTs that can commit after local failure or cleanup. */
export class RunArtifactsCleanupStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "run_artifacts";
  constructor(public config: CleanupStrategyConfig) {}
  validate(): void {}
  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    const [total] = await db.select({ count: sql<number>`count(*)` }).from(runCallbacks);
    const [due] = await db.select({ count: sql<number>`count(*)` }).from(runCallbacks)
      .where(sql`${runCallbacks.cleanupAt} <= now()` );
    return { totalRecords: Number(total.count), oldRecords: Number(due.count) };
  }
  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const start = Date.now();
    const result: CleanupOperationResult = {
      entityType: this.entityType, success: true, recordsDeleted: 0,
      s3ObjectsDeleted: 0, duration: 0, errors: [], details: {},
    };
    const limit = this.config.maxRecordsPerRun || 1000;
    const storage = createS3CleanupService();
    const due = await db.select().from(runCallbacks)
      .where(sql`${runCallbacks.cleanupAt} <= now()` )
      .orderBy(asc(runCallbacks.cleanupAt)).limit(limit);
    result.details.recordsProcessed = due.length;
    for (const callback of due) {
      if (dryRun) continue;
      // Claim briefly, then release the connection before storage I/O.
      const claimed = await db.update(runCallbacks)
        .set({ cleanupAt: new Date(Date.now() + 86400000) })
        .where(and(eq(runCallbacks.runId, callback.runId), sql`${runCallbacks.cleanupAt} <= now()`))
        .returning({ id: runCallbacks.runId });
      if (!claimed.length || !callback.bucket) continue;
      try {
        const cleanup = await storage.deleteRunArtifacts(callback.bucket, callback.runId);
        result.s3ObjectsDeleted! += cleanup.deletedObjects.length;
        if (!cleanup.success) throw new Error("Storage cleanup failed");
      } catch (error) {
        result.success = false;
        result.errors.push(`Run ${callback.runId}: ${error instanceof Error ? error.message : String(error)}`);
        await db.update(runCallbacks).set({ cleanupAt: new Date(Date.now() + 900000) })
          .where(eq(runCallbacks.runId, callback.runId));
      }
    }
    result.duration = Date.now() - start;
    return result;
  }
}

// Retention must never delete a run that is still queued or running.
const TERMINAL_RUN_STATUSES = ["passed", "failed", "error", "blocked"] as const;

export class JobRunsCleanupStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "job_runs";
  config: CleanupStrategyConfig;
  private s3Service: ReturnType<typeof createS3CleanupService>;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
    this.s3Service = createS3CleanupService();
    this.validate();
  }

  validate(): void {
    if (!this.config.retentionDays || this.config.retentionDays <= 0) {
      throw new Error("Job runs cleanup requires retentionDays > 0");
    }
    if (!Number.isFinite(this.playgroundMaxAgeHours) || this.playgroundMaxAgeHours <= 0) {
      throw new Error("Job runs cleanup requires playgroundMaxAgeHours > 0");
    }
  }

  private get playgroundMaxAgeHours(): number {
    return Number(this.config.customConfig?.playgroundMaxAgeHours ?? 24);
  }

  private playgroundCondition(cutoff: Date): SQL {
    return and(
      sql`${runs.jobId} IS NULL`,
      inArray(runs.status, TERMINAL_RUN_STATUSES),
      lt(sql`coalesce(${runs.completedAt}, ${runs.createdAt})`, sql`${cutoff.toISOString()}::timestamptz`)
    )!;
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    const cutoffDate = new Date(
      Date.now() - this.config.retentionDays! * 24 * 60 * 60 * 1000
    );

    const playgroundCutoff = new Date(Date.now() - this.playgroundMaxAgeHours * 3600000);
    // Get stats for all runs (job + playground)
    const [total, old, jobRuns, playgroundRuns, oldJobRuns, oldPlaygroundRuns] =
      await Promise.all([
        // Total runs count
        db.select({ count: sql<number>`count(*)` }).from(runs),
        // Old runs count (all types)
        db
          .select({ count: sql<number>`count(*)` })
          .from(runs)
          .where(or(
            and(sql`${runs.jobId} IS NOT NULL`, lt(runs.createdAt, cutoffDate)),
            this.playgroundCondition(playgroundCutoff)
          )),
        // Current job runs (jobId not null)
        db
          .select({ count: sql<number>`count(*)` })
          .from(runs)
          .where(sql`${runs.jobId} IS NOT NULL`),
        // Current playground runs (jobId is null)
        db
          .select({ count: sql<number>`count(*)` })
          .from(runs)
          .where(sql`${runs.jobId} IS NULL`),
        // Old job runs
        db
          .select({ count: sql<number>`count(*)` })
          .from(runs)
          .where(
            and(lt(runs.createdAt, cutoffDate), sql`${runs.jobId} IS NOT NULL`)
          ),
        // Old playground runs
        db
          .select({ count: sql<number>`count(*)` })
          .from(runs)
          .where(
            this.playgroundCondition(playgroundCutoff)
          ),
      ]);

    const totalCount = Number(total[0]?.count || 0);
    const oldCount = Number(old[0]?.count || 0);
    const jobRunsCount = Number(jobRuns[0]?.count || 0);
    const playgroundRunsCount = Number(playgroundRuns[0]?.count || 0);
    const oldJobRunsCount = Number(oldJobRuns[0]?.count || 0);
    const oldPlaygroundRunsCount = Number(oldPlaygroundRuns[0]?.count || 0);

    // Log breakdown for visibility
    console.log(
      `[DATA_LIFECYCLE] [${this.entityType}] Stats: ` +
        `Total=${totalCount} (Jobs=${jobRunsCount}, Playground=${playgroundRunsCount}), ` +
        `Old=${oldCount} (Jobs=${oldJobRunsCount}, Playground=${oldPlaygroundRunsCount})`
    );

    return {
      totalRecords: totalCount,
      oldRecords: oldCount,
    };
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const maxRecords = this.config.maxRecordsPerRun || 10000;
    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      s3ObjectsDeleted: 0,
      duration: 0,
      errors: [],
      details: { dryRun, multiTenant: true, organizationsProcessed: 0 },
    };
    try {
      const orgRetentions = await getOrganizationJobRetentionSettings(this.config.retentionDays!);
      // Global cleanup only when no organization exists, never when every organization was skipped.
      if (orgRetentions.length === 0 && (await db.select({ id: organization.id }).from(organization).limit(1)).length === 0) {
        result.details.multiTenant = false;
        await this.cleanupRuns(and(sql`${runs.jobId} IS NOT NULL`, inArray(runs.status, TERMINAL_RUN_STATUSES), lt(runs.createdAt, new Date(
          Date.now() - this.config.retentionDays! * 86400000
        )))!, dryRun, maxRecords, result);
      } else {
        const orgStats: Record<string, { deleted: number; s3Deleted: number; retentionDays: number }> = {};
        for (const orgRetention of orgRetentions) {
          if (Number(result.details.recordsProcessed || 0) >= maxRecords) break;
          const jobsInOrg = await db.select({ id: jobs.id }).from(jobs)
            .where(eq(jobs.organizationId, orgRetention.organizationId));
          if (jobsInOrg.length === 0) continue;
          const before = result.recordsDeleted;
          const beforeS3 = result.s3ObjectsDeleted!;
          try {
            await this.cleanupRuns(and(
              inArray(runs.jobId, jobsInOrg.map(job => job.id)),
              inArray(runs.status, TERMINAL_RUN_STATUSES),
              lt(runs.createdAt, new Date(Date.now() - orgRetention.jobRetentionDays * 86400000))
            )!, dryRun, maxRecords - Number(result.details.recordsProcessed || 0), result);
          } catch (error) {
            result.success = false;
            result.errors.push(error instanceof Error ? error.message : String(error));
          }
          orgStats[orgRetention.organizationId] = {
            deleted: result.recordsDeleted - before,
            s3Deleted: result.s3ObjectsDeleted! - beforeS3,
            retentionDays: orgRetention.jobRetentionDays,
          };
        }
        result.details.organizationsProcessed = Object.keys(orgStats).length;
        result.details.orgStats = orgStats;

      }
      // Standalone rows follow the configured playground artifact age.
      const before = result.recordsDeleted;
      const remaining = maxRecords - Number(result.details.recordsProcessed || 0);
      if (remaining > 0) {
        await this.cleanupRuns(this.playgroundCondition(
          new Date(Date.now() - this.playgroundMaxAgeHours * 3600000)
        ), dryRun, remaining, result);
      }
      result.details.playgroundRunsDeleted = result.recordsDeleted - before;
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
      console.error("[DATA_LIFECYCLE] [job_runs] Cleanup failed:", error);
    }
    result.duration = Date.now() - startTime;
    return result;
  }

  private async cleanupRuns(
    condition: SQL,
    dryRun: boolean,
    maxRecords: number,
    result: CleanupOperationResult
  ): Promise<void> {
    const batchSize = this.config.batchSize || 100;
    if (dryRun) {
      const count = await db.select({ count: sql<number>`count(*)` }).from(runs).where(condition);
      const processed = Math.min(Number(count[0]?.count || 0), maxRecords);
      result.recordsDeleted += processed;
      result.details.recordsProcessed = Number(result.details.recordsProcessed || 0) + processed;
      return;
    }
    let processed = 0;
    // Keep PostgreSQL microseconds; Date truncation can reselect retained failures.
    let cursor: { createdAt: string; id: string } | undefined;
    while (processed < maxRecords) {
      const limit = Math.min(batchSize, maxRecords - processed);
      const oldRuns = await db.select({
        id: runs.id, createdAt: sql<string>`${runs.createdAt}::text`, reportS3Url: runs.reportS3Url, logsS3Url: runs.logsS3Url, metadata: runs.metadata,
      }).from(runs)
        .where(and(condition, cursor ? or(
          gt(runs.createdAt, sql`${cursor.createdAt}::timestamptz`),
          and(eq(runs.createdAt, sql`${cursor.createdAt}::timestamptz`), gt(runs.id, cursor.id))
        ) : undefined))
        .orderBy(asc(runs.createdAt), asc(runs.id)).limit(limit);
      if (oldRuns.length === 0) break;
      processed += oldRuns.length;
      result.details.recordsProcessed = Number(result.details.recordsProcessed || 0) + oldRuns.length;
      const runIds = oldRuns.map(run => run.id);
      const associatedReports = await db.select().from(reports).where(and(
        inArray(reports.entityType, ["job", "test", "k6_test", "k6_job"]),
        or(inArray(reports.entityId, runIds), and(eq(reports.entityType, "test"),
          inArray(reports.reportPath, runIds.map(id => `${id}/report`))))
      ));
      const inputs: ReportDeletionInput[] = associatedReports.map(report => ({
        reportPath: report.reportPath,
        s3Url: report.s3Url || undefined,
        entityId: report.entityId,
        entityType: report.entityType as ReportDeletionInput["entityType"],
      }));
      const invalidRunIds = new Set<string>();
      for (const run of oldRuns) {
        try {
          inputs.push(...this.s3Service.getRunArtifactInputs(run));
        } catch (error) {
          invalidRunIds.add(run.id);
          result.success = false;
          result.errors.push(`Run ${run.id}: ${error instanceof Error ? error.message : String(error)}; preserving pointers for retry`);
        }
      }
      if (inputs.length > 0) {
        const s3Result = await this.s3Service.deleteReports(inputs);
        result.s3ObjectsDeleted! += s3Result.deletedObjects.length;
        if (!s3Result.success) {
          for (const id of this.s3Service.getFailedReportEntityIds(inputs, s3Result)) {
            invalidRunIds.add(id);
            for (const report of associatedReports.filter(report => report.entityId === id)) {
              const owner = report.reportPath.split("/")[0];
              if (runIds.includes(owner)) invalidRunIds.add(owner);
            }
          }
          result.success = false;
          result.errors.push(`Run artifact cleanup had ${s3Result.failedObjects.length} S3 failures; preserving failed pointers for retry`);
        }
      }
      const validRunIds = runIds.filter(id => !invalidRunIds.has(id));
      const validReportIds = associatedReports.filter(report => !invalidRunIds.has(report.entityId) && !invalidRunIds.has(report.reportPath.split("/")[0])).map(report => report.id);
      // Keep report pointers and runs together if either database deletion fails.
      if (validRunIds.length > 0) await db.transaction(async tx => {
        await tx.select({ id: runs.id }).from(runs).where(inArray(runs.id, validRunIds))
          .orderBy(asc(runs.id)).for("update");
        if (validReportIds.length > 0) {
          await tx.delete(reports).where(and(inArray(reports.id, validReportIds),
            or(inArray(reports.entityId, validRunIds), and(eq(reports.entityType, "test"),
              inArray(reports.reportPath, validRunIds.map(id => `${id}/report`))))));
        }
        await removeK6RunLinks(tx, validRunIds);
        await tx.delete(runs).where(inArray(runs.id, validRunIds));
      });
      const last = oldRuns[oldRuns.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
      result.recordsDeleted += validRunIds.length;
      if (oldRuns.length < limit) break;
      if (processed < maxRecords) await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

/**
 * Playground Artifacts Cleanup Strategy
 *
 * Manages cleanup of S3 playground artifacts (test reports that aren't in DB)
 */
export class PlaygroundArtifactsCleanupStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "playground_artifacts";
  config: CleanupStrategyConfig;
  private s3Service: ReturnType<typeof createS3CleanupService>;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
    this.s3Service = createS3CleanupService();
    this.validate();
  }

  validate(): void {
    const maxAgeHours = this.config.customConfig?.maxAgeHours;
    if (!maxAgeHours || Number(maxAgeHours) <= 0) {
      throw new Error(
        "Playground artifacts cleanup requires customConfig.maxAgeHours > 0"
      );
    }
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    const maxAgeHours = Number(this.config.customConfig?.maxAgeHours || 24);
    const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;
    const buckets = new Set([
      String(this.config.customConfig?.bucketName || process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts"),
      process.env.S3_K6_TEST_BUCKET_NAME || "k6-test-artifacts",
    ]);
    const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
      },
    });
    let totalRecords = 0;
    let oldRecords = 0;
    for (const bucket of buckets) {
      try {
        let continuationToken: string | undefined;
        do {
          const response = await s3Client.send(new ListObjectsV2Command({
            Bucket: bucket, ContinuationToken: continuationToken, MaxKeys: 1000,
          }));
          for (const obj of response.Contents || []) {
            totalRecords++;
            if (obj.LastModified && obj.LastModified.getTime() < cutoffTime) oldRecords++;
          }
          continuationToken = response.NextContinuationToken;
        } while (continuationToken);
      } catch (error: unknown) {
        const err = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
        if (err.name !== "NoSuchBucket" && err.Code !== "NoSuchBucket" && err.$metadata?.httpStatusCode !== 404) {
          console.error("[DATA_LIFECYCLE] [playground_artifacts] Failed to get bucket stats:", bucket, error);
        }
      }
    }
    return { totalRecords, oldRecords };
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const maxAgeHours = Number(this.config.customConfig?.maxAgeHours || 24);
    const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;
    
    // Clean up both Playwright and K6 test buckets
    const playwrightBucket = String(
      this.config.customConfig?.bucketName || process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts"
    );
    const k6Bucket = String(
      process.env.S3_K6_TEST_BUCKET_NAME || "k6-test-artifacts"
    );
    
    const bucketsToClean = [
      { bucketName: playwrightBucket, entityType: "test" as const },
      { bucketName: k6Bucket, entityType: "k6_test" as const },
    ];

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      s3ObjectsDeleted: 0,
      duration: 0,
      errors: [],
      details: {
        cutoffTime: new Date(cutoffTime).toISOString(),
        buckets: bucketsToClean.map(b => b.bucketName),
        dryRun,
      },
    };

    try {
      const { S3Client, ListObjectsV2Command, HeadBucketCommand } = await import(
        "@aws-sdk/client-s3"
      );

      const s3Client = new S3Client({
        region: process.env.AWS_REGION || "us-east-1",
        endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
        },
      });

      let totalDeleted = 0;
      const bucketResults: Record<string, number> = {};

      // Process each bucket
      for (const { bucketName } of bucketsToClean) {
        try {
          // Check if bucket exists
          await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
        } catch (error: unknown) {
          const err = error as { $metadata?: { httpStatusCode?: number }; Code?: string };
          if (err?.$metadata?.httpStatusCode === 404 || err?.Code === "NoSuchBucket") {
            console.log(`[DATA_LIFECYCLE] [playground_artifacts] Bucket '${bucketName}' does not exist, skipping`);
            bucketResults[bucketName] = 0;
            continue;
          }
          result.success = false;
          result.errors.push(`Cannot access bucket '${bucketName}': ${error instanceof Error ? error.message : String(error)}`);
          // Continue with other buckets, but report the failed cleanup.
          console.warn(`[DATA_LIFECYCLE] [playground_artifacts] Failed to access bucket '${bucketName}':`, err);
          bucketResults[bucketName] = 0;
          continue;
        }

        let continuationToken: string | undefined;
        bucketResults[bucketName] = 0;
        do {
          const response = await s3Client.send(new ListObjectsV2Command({
            Bucket: bucketName,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          }));
          const prefixes = [...new Set((response.Contents || []).flatMap(obj => obj.Key ? [obj.Key.split("/")[0]] : []))];
        // Test buckets also hold immutable run reports; only run retention may remove those.
        const retainedRuns = prefixes.length ? await db.select({ id: runs.id }).from(runs)
          .where(inArray(sql<string>`${runs.id}::text`, prefixes)) : [];
        const retainedRunIds = new Set(retainedRuns.map(run => run.id));
        const keys = (response.Contents || []).flatMap(obj =>
            obj.Key && !retainedRunIds.has(obj.Key.split("/")[0]) && obj.LastModified && obj.LastModified.getTime() < cutoffTime ? [obj.Key] : []
          );
          if (keys.length > 0) {
            if (dryRun) {
              bucketResults[bucketName] += keys.length;
              totalDeleted += keys.length;
            } else {
              const s3Result = await this.s3Service.deleteObjectsBatch(bucketName, keys);
              bucketResults[bucketName] += s3Result.deletedObjects.length;
              totalDeleted += s3Result.deletedObjects.length;
              if (!s3Result.success) {
                result.success = false;
                result.errors.push(`S3 cleanup for bucket '${bucketName}' had ${s3Result.failedObjects.length} failures`);
              }
            }
          }
          continuationToken = response.NextContinuationToken;
        } while (continuationToken);

        if (bucketResults[bucketName] > 0) {
          console.log(
            `[DATA_LIFECYCLE] [playground_artifacts] Bucket '${bucketName}': ${
              dryRun ? "Would delete" : "Deleted"
            } ${bucketResults[bucketName]} objects`
          );
        }
      }

      result.s3ObjectsDeleted = totalDeleted;
      result.details.bucketResults = bucketResults;
      result.duration = Date.now() - startTime;

      if (totalDeleted > 0) {
        console.log(
          `[DATA_LIFECYCLE] ${this.entityType}: Total ${
            dryRun ? "would delete" : "deleted"
          } ${totalDeleted} S3 objects across ${bucketsToClean.length} buckets`
        );
      }
    } catch (error: unknown) {
      result.success = false;
      result.duration = Date.now() - startTime;
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      console.error(
        `[DATA_LIFECYCLE] [${this.entityType}] Cleanup failed:`,
        error
      );
    }

    return result;
  }
}

/**
 * Webhook Idempotency Cleanup Strategy
 *
 * Manages cleanup of expired webhook idempotency records.
 * These records are stored to prevent duplicate webhook processing and
 * should be cleaned up after their TTL expires (24 hours by default).
 */
export class WebhookIdempotencyCleanupStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "webhook_idempotency";
  config: CleanupStrategyConfig;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
    this.validate();
  }

  validate(): void {
    // No special validation needed - uses expiresAt column
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    const now = new Date();

    try {
      const [total, expired] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(webhookIdempotency),
        db
          .select({ count: sql<number>`count(*)` })
          .from(webhookIdempotency)
          .where(lt(webhookIdempotency.expiresAt, now)),
      ]);

      return {
        totalRecords: Number(total[0]?.count || 0),
        oldRecords: Number(expired[0]?.count || 0),
      };
    } catch (error) {
      // Table might not exist yet (pre-migration)
      console.warn(
        `[DATA_LIFECYCLE] [webhook_idempotency] Failed to get stats (table may not exist):`,
        error
      );
      return { totalRecords: 0, oldRecords: 0 };
    }
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const now = new Date();
    const batchSize = this.config.batchSize || 1000;
    const maxRecords = this.config.maxRecordsPerRun || 100000;

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      duration: 0,
      errors: [],
      details: { cutoffTime: now.toISOString(), dryRun },
    };

    try {
      let totalDeleted = 0;
      let iterations = 0;
      const maxIterations = Math.ceil(maxRecords / batchSize);

      while (iterations < maxIterations) {
        if (dryRun) {
          // Dry-run: count expired records once (no loop needed since data isn't modified)
          const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(webhookIdempotency)
            .where(lt(webhookIdempotency.expiresAt, now));

          totalDeleted = Math.min(
            Number(countResult[0]?.count || 0),
            maxRecords
          );
          // Break out of loop - dry-run only needs a single count
          break;
        } else {
          // Get IDs of expired records to delete
          const idsToDelete = await db
            .select({ id: webhookIdempotency.id })
            .from(webhookIdempotency)
            .where(lt(webhookIdempotency.expiresAt, now))
            .limit(batchSize);

          if (idsToDelete.length === 0) break;

          // Delete expired records using safe parameterized query
          const ids = idsToDelete.map((r) => r.id);
          await db
            .delete(webhookIdempotency)
            .where(inArray(webhookIdempotency.id, ids));

          const batchDeleted = idsToDelete.length;
          totalDeleted += batchDeleted;

          // Small delay to prevent overwhelming the database
          if (batchDeleted === batchSize) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }

        iterations++;
      }

      result.recordsDeleted = totalDeleted;
      result.duration = Date.now() - startTime;
      result.details.iterations = iterations;

      if (totalDeleted > 0) {
        console.log(
          `[DATA_LIFECYCLE] ${this.entityType}: ${
            dryRun ? "Would delete" : "Deleted"
          } ${totalDeleted} expired records`
        );
      }
    } catch (error) {
      // Table might not exist yet (pre-migration) - don't fail
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("does not exist") ||
        errorMessage.includes("relation")
      ) {
        console.warn(
          `[DATA_LIFECYCLE] [${this.entityType}] Table may not exist yet (pre-migration), skipping cleanup`
        );
        result.duration = Date.now() - startTime;
        return result;
      }

      result.success = false;
      result.errors.push(errorMessage);
      result.duration = Date.now() - startTime;
      console.error(
        `[DATA_LIFECYCLE] [${this.entityType}] Cleanup failed:`,
        error
      );
    }

    return result;
  }
}

/**
 * Credential Revocation Retry Strategy
 *
 * Finishes the revocation of CLI tokens, extension keys and connected-app grants when it failed right
 * after a password reset. Job trigger keys are deliberately not revoked: they belong to a job, not to a
 * session, and deleting them would silently break CI pipelines that only hold the key.
 *
 * It deletes nothing of its own: a pending marker is removed once the revocation succeeds and is retried
 * until then. A run that leaves any revocation unfinished reports failure, so a stolen credential that is
 * still alive cannot sit behind a green dashboard.
 */
export class CredentialRevocationRetryStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "credential_revocation_retry";
  config: CleanupStrategyConfig;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
    this.validate();
  }

  validate(): void {
    // No special validation needed
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    // Every pending revocation is overdue by definition: the first attempt already failed.
    const pending = await countPendingCredentialRevocations();
    return { totalRecords: pending, oldRecords: pending };
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      duration: 0,
      errors: [],
      details: { dryRun },
    };
    if (!dryRun) {
      try {
        const { done, failed } = await retryPendingCredentialRevocations();
        result.details = {
          ...result.details,
          credentialRevocationsRetried: done,
          credentialRevocationsFailed: failed,
        };
        if (failed > 0) {
          result.success = false;
          result.errors.push(`${failed} credential revocation(s) are still failing and will be retried`);
        }
      } catch (error) {
        result.success = false;
        result.errors.push(error instanceof Error ? error.message : String(error));
        console.error("[DATA_LIFECYCLE] [credential_revocation_retry] Sweep failed:", error);
      }
    }
    result.duration = Date.now() - startTime;
    return result;
  }
}

/**
 * Safety net for background purges: BullMQ is only the trigger, so a lost message, a crashed pod or a missed
 * retry is re-triggered here from the deletion_jobs table. Reads partial indexes over unfinished rows only.
 */
export class DeletionSweepStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "deletion_sweep";
  config: CleanupStrategyConfig;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
  }

  validate(): void {}

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    return { totalRecords: 0, oldRecords: 0 };
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const result: CleanupOperationResult = {
      success: true, entityType: this.entityType, recordsDeleted: 0, duration: 0, errors: [], details: { dryRun },
    };
    if (!dryRun) {
      try {
        const { sweepDeletions } = await import("@/lib/deletion/queue");
        result.details = { ...result.details, ...(await sweepDeletions()) };
      } catch (error) {
        result.success = false;
        result.errors.push(error instanceof Error ? error.message : String(error));
        console.error("[DATA_LIFECYCLE] [deletion_sweep] Sweep failed:", error);
      }
    }
    result.duration = Date.now() - startTime;
    return result;
  }
}

/**
 * Alert history past retention. Claim rows (outage_key set) of a monitor that is still failing are kept: they
 * are what stops a retried alert of the open outage from sending again, so they outlive the retention window.
 */
function expiredAlertHistory(cutoffDate: Date) {
  return and(
    lt(alertHistory.sentAt, cutoffDate),
    sql`NOT (${alertHistory.outageKey} IS NOT NULL AND EXISTS (SELECT 1 FROM monitors WHERE monitors.id = ${alertHistory.monitorId} AND monitors.status IN ('down', 'error')))`,
  );
}

/**
 * Alert History Cleanup Strategy
 *
 * Manages cleanup of old alert history records to prevent unbounded table growth.
 * Uses time-based retention (default 90 days) with batch deletion.
 * Alert-heavy tenants can generate significant volume - this ensures storage pressure
 * and query performance remain manageable.
 */
export class AlertHistoryCleanupStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "alert_history";
  config: CleanupStrategyConfig;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
    this.validate();
  }

  validate(): void {
    if (
      this.config.retentionDays !== undefined &&
      this.config.retentionDays <= 0
    ) {
      throw new Error(
        "Alert history cleanup requires retentionDays > 0"
      );
    }
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    const retentionDays = this.config.retentionDays || 90;
    const cutoffDate = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000
    );

    try {
      const [total, old] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(alertHistory),
        db
          .select({ count: sql<number>`count(*)` })
          .from(alertHistory)
          .where(expiredAlertHistory(cutoffDate)),
      ]);

      return {
        totalRecords: Number(total[0]?.count || 0),
        oldRecords: Number(old[0]?.count || 0),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("does not exist") ||
        errorMessage.includes("relation")
      ) {
        return { totalRecords: 0, oldRecords: 0 };
      }
      console.warn(
        `[DATA_LIFECYCLE] [alert_history] Failed to get stats:`,
        error
      );
      return { totalRecords: 0, oldRecords: 0 };
    }
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const retentionDays = this.config.retentionDays || 90;
    const cutoffDate = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000
    );
    const batchSize = this.config.batchSize || 1000;
    const maxRecords = this.config.maxRecordsPerRun || 100000;

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      duration: 0,
      errors: [],
      details: {
        cutoffDate: cutoffDate.toISOString(),
        retentionDays,
        dryRun,
      },
    };

    try {
      if (dryRun) {
        // Count records that would be deleted (single query, no loop)
        const countResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(alertHistory)
          .where(expiredAlertHistory(cutoffDate));

        const count = Math.min(
          Number(countResult[0]?.count || 0),
          maxRecords
        );
        result.recordsDeleted = count;
      } else {
        let totalDeleted = 0;
        let iterations = 0;
        const maxIterations = Math.ceil(maxRecords / batchSize);

        while (iterations < maxIterations) {
          // Get IDs of old records to delete
          const idsToDelete = await db
            .select({ id: alertHistory.id })
            .from(alertHistory)
            .where(expiredAlertHistory(cutoffDate))
            .limit(batchSize);

          if (idsToDelete.length === 0) break;

          const ids = idsToDelete.map((r) => r.id);
          await db
            .delete(alertHistory)
            .where(inArray(alertHistory.id, ids));

          totalDeleted += idsToDelete.length;

          // Small delay to prevent overwhelming the database
          if (idsToDelete.length === batchSize) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          iterations++;
        }

        result.recordsDeleted = totalDeleted;
        result.details.iterations = iterations;
      }

      result.duration = Date.now() - startTime;

      if (result.recordsDeleted > 0) {
        console.log(
          `[DATA_LIFECYCLE] ${this.entityType}: ${
            dryRun ? "Would delete" : "Deleted"
          } ${result.recordsDeleted} records older than ${retentionDays} days`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("does not exist") ||
        errorMessage.includes("relation")
      ) {
        console.warn(
          `[DATA_LIFECYCLE] [${this.entityType}] Table may not exist yet (pre-migration), skipping cleanup`
        );
        result.duration = Date.now() - startTime;
        return result;
      }

      result.success = false;
      result.errors.push(errorMessage);
      result.duration = Date.now() - startTime;
      console.error(
        `[DATA_LIFECYCLE] [${this.entityType}] Cleanup failed:`,
        error
      );
    }

    return result;
  }
}

/**
 * Telemetry retention: purges operational telemetry tables by age in bounded batches.
 * Rules (tables, defaults, protected rows) live in telemetry-retention.ts.
 */
export class TelemetryRetentionStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "telemetry_retention";
  config: CleanupStrategyConfig;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
  }

  validate(): void {}

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    return { totalRecords: 0, oldRecords: 0 };
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      duration: 0,
      errors: [],
      details: { dryRun, tables: {} as Record<string, number> },
    };
    const run = async (statement: string) =>
      (await db.execute(sql.raw(statement))) as unknown as Record<string, unknown>[];
    for (const rule of TELEMETRY_RETENTION_RULES) {
      try {
        const days = resolveRetentionDays(rule);
        const deleted = dryRun
          ? Number((await run(buildCountSql(rule, days)))[0]?.n ?? 0)
          : await purgeTelemetryTable(run, rule, {
              days,
              batchSize: resolveBatchSize(this.config.batchSize),
              maxRecords: resolveSafetyLimit(this.config.maxRecordsPerRun),
              pauseMs: 50,
            });
        (result.details.tables as Record<string, number>)[rule.table] = deleted;
        result.recordsDeleted += deleted;
      } catch (error) {
        // One failing table must not block the others.
        result.success = false;
        result.errors.push(`${rule.table}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    result.duration = Date.now() - startTime;
    return result;
  }
}

/**
 * Audit Logs Cleanup Strategy
 *
 * Every record is kept for 12 months. After AUDIT_EMAIL_SCRUB_DAYS (default 30) email addresses in the details are
 * replaced by a stable hash, then the record is purged at 12 months.
 */
/**
 * Replace email addresses in audit details older than AUDIT_EMAIL_SCRUB_DAYS and mark the row, so each row is rewritten once.
 * Keyset-batched over the created_at index; the marker keeps finished rows out of later runs.
 */
export class AuditLogsCleanupStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "audit_logs";
  config: CleanupStrategyConfig;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
    this.validate();
  }

  validate(): void {
    if (
      this.config.retentionDays !== undefined &&
      this.config.retentionDays <= 0
    ) {
      throw new Error("Audit logs cleanup requires retentionDays > 0");
    }
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    const fallbackRetentionDays = this.config.retentionDays || 90;
    const cutoffDate = new Date(
      Date.now() - fallbackRetentionDays * 24 * 60 * 60 * 1000
    );

    try {
      const [total, old] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(auditLogs),
        db
          .select({ count: sql<number>`count(*)` })
          .from(auditLogs)
          .where(lt(auditLogs.createdAt, cutoffDate)),
      ]);

      return {
        totalRecords: Number(total[0]?.count || 0),
        oldRecords: Number(old[0]?.count || 0),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("does not exist") ||
        errorMessage.includes("relation")
      ) {
        return { totalRecords: 0, oldRecords: 0 };
      }
      console.warn(`[DATA_LIFECYCLE] [audit_logs] Failed to get stats:`, error);
      return { totalRecords: 0, oldRecords: 0 };
    }
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const batchSize = this.config.batchSize || 1000;
    const maxRecords = this.config.maxRecordsPerRun || 100000;

    // Owner decision: every audit record is kept for AUDIT_RETENTION_DAYS; the email scrub runs its own scan first.
    const minRetentionDays = AUDIT_RETENTION_DAYS;
    const minCutoffDate = new Date(
      Date.now() - minRetentionDays * 24 * 60 * 60 * 1000
    );

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      duration: 0,
      errors: [],
      details: {
        dryRun,
        minRetentionDays,
      },
    };

    try {
      // A scrub failure (for example a missing server secret) is reported but must not stop the retention delete below.
      try {
        result.details.emailsScrubbed = await scrubAuditEmails({ dryRun, batchSize, maxRecords });
      } catch (scrubError) {
        result.errors.push(`audit email scrub failed: ${scrubError instanceof Error ? scrubError.message : String(scrubError)}`);
        result.success = false;
      }
      let totalDeleted = 0;
      let scannedRecords = 0;
      let iterations = 0;
      const maxIterations = Math.ceil(maxRecords / batchSize);

      let lastSeenCreatedAt: Date | null = null;
      let lastSeenId: string | null = null;

      while (iterations < maxIterations) {
        const conditions = [
          lt(auditLogs.createdAt, minCutoffDate),
          sql`${auditLogs.createdAt} IS NOT NULL`,
        ];

        if (lastSeenCreatedAt && lastSeenId) {
          const cursorTs = lastSeenCreatedAt.toISOString();
          conditions.push(
            sql`(${auditLogs.createdAt} > ${cursorTs}::timestamptz OR (${auditLogs.createdAt} = ${cursorTs}::timestamptz AND ${auditLogs.id} > ${lastSeenId}))`
          );
        }

        const candidates = await db
          .select({
            id: auditLogs.id,
            action: auditLogs.action,
            createdAt: auditLogs.createdAt,
          })
          .from(auditLogs)
          .where(and(...conditions))
          .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))
          .limit(batchSize);

        if (candidates.length === 0) break;

        const lastCandidate = candidates[candidates.length - 1];
        lastSeenCreatedAt = lastCandidate.createdAt;
        lastSeenId = lastCandidate.id;

        scannedRecords += candidates.length;

        const eligibleIds = candidates.map((record) => record.id);

        const remainingQuota = maxRecords - totalDeleted;
        const quotaEligibleIds = eligibleIds.slice(0, Math.max(0, remainingQuota));

        if (!dryRun && quotaEligibleIds.length > 0) {
          await db
            .delete(auditLogs)
            .where(inArray(auditLogs.id, quotaEligibleIds));
        }

        totalDeleted += quotaEligibleIds.length;
        iterations++;

        if (totalDeleted >= maxRecords) break;

        if (candidates.length === batchSize) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      result.recordsDeleted = totalDeleted;
      result.duration = Date.now() - startTime;
      result.details.iterations = iterations;
      result.details.scannedRecords = scannedRecords;

      if (totalDeleted > 0) {
        console.log(
          `[DATA_LIFECYCLE] ${this.entityType}: ${
            dryRun ? "Would delete" : "Deleted"
          } ${totalDeleted} records`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("does not exist") ||
        errorMessage.includes("relation")
      ) {
        console.warn(
          `[DATA_LIFECYCLE] [${this.entityType}] Table may not exist yet (pre-migration), skipping cleanup`
        );
        result.duration = Date.now() - startTime;
        return result;
      }

      result.success = false;
      result.errors.push(errorMessage);
      result.duration = Date.now() - startTime;
      console.error(
        `[DATA_LIFECYCLE] [${this.entityType}] Cleanup failed:`,
        error
      );
    }

    return result;
  }
}

/**
 * Trial Lifecycle Strategy
 *
 * Ends expired trials: pauses the organization's monitors and archives its
 * published status pages. Nothing is deleted, and subscribing restores both.
 */
export class TrialLifecycleStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "trial_lifecycle";
  config: CleanupStrategyConfig;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
  }

  validate(): void {}

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    const [pending] = await db
      .select({ count: sql<number>`count(*)` })
      .from(executionEntitlements)
      .where(and(lte(executionEntitlements.expiresAt, new Date()), isNull(executionEntitlements.lifecycleEndedAt)));
    return { totalRecords: Number(pending?.count ?? 0), oldRecords: Number(pending?.count ?? 0) };
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      duration: 0,
      errors: [],
      details: { dryRun },
    };
    if (dryRun) {
      const stats = await this.getStats();
      result.details = { dryRun, expiredTrials: stats.oldRecords };
      result.duration = Date.now() - startTime;
      return result;
    }
    try {
      result.details = { ...(await endExpiredTrials()) };
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
    // A paid organization whose resources are still suspended (the activation webhook could not
    // restore them) is repaired here, independent of ending trials.
    try {
      result.details = { ...result.details, restored: await reconcilePaidTrialSuspensions() };
    } catch (error) {
      result.errors.push(`Trial restore reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    // An ended subscription (revoked, or canceled with the period over) stops consuming resources too.
    try {
      result.details = { ...result.details, lapsed: await suspendLapsedOrganizations() };
    } catch (error) {
      result.errors.push(`Lapsed organization suspension failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    // A plan change in the billing portal can leave more running than the new plan allows.
    try {
      const { enforcePlanResourceCaps } = await import("@/lib/billing/plan-caps");
      result.details = { ...result.details, planCaps: await enforcePlanResourceCaps() };
    } catch (error) {
      result.errors.push(`Plan limit enforcement failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Reminders are best effort and independent of ending trials: an email
    // problem must never stop monitors from being paused.
    try {
      result.details = { ...result.details, reminders: await sendTrialReminders({ deliver: deliverTrialReminder }) };
    } catch (error) {
      result.errors.push(`Trial reminders failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    result.duration = Date.now() - startTime;
    return result;
  }
}

// ============================================================================
// UNIFIED DATA LIFECYCLE SERVICE
// ============================================================================

/**
 * Main service coordinating all data lifecycle operations
 */
export class DataLifecycleService {
  private strategies: Map<CleanupEntityType, ICleanupStrategy> = new Map();
  /** Heavy retention strategies, one at a time. */
  private cleanupQueue: Queue<CleanupJobData> | null = null;
  /** Short urgent strategies (URGENT_CLEANUP_ENTITY_TYPES). */
  private urgentQueue: Queue<CleanupJobData> | null = null;
  private cleanupWorker: Worker<CleanupJobData, CleanupOperationResult> | null =
    null;
  private urgentWorker: Worker<CleanupJobData, CleanupOperationResult> | null = null;
  private queueEvents = new Map<string, QueueEvents>();
  private redisConnection: Redis | null = null;

  constructor(strategyConfigs: CleanupStrategyConfig[]) {
    // Initialize strategies
    for (const config of strategyConfigs) {
      if (!config.enabled) {
        continue;
      }

      let strategy: ICleanupStrategy;

      switch (config.entityType) {
        case "monitor_results":
          strategy = new MonitorResultsCleanupStrategy(config);
          break;
        case "monitor_aggregates":
          strategy = new MonitorAggregatesCleanupStrategy(config);
          break;
        case "monitor_aggregation_hourly":
          strategy = new MonitorAggregationHourlyStrategy(config);
          break;
        case "monitor_aggregation_daily":
          strategy = new MonitorAggregationDailyStrategy(config);
          break;
        case "run_artifacts":
          strategy = new RunArtifactsCleanupStrategy(config);
          break;
        case "job_runs":
          strategy = new JobRunsCleanupStrategy(config);
          break;
        case "playground_artifacts":
          strategy = new PlaygroundArtifactsCleanupStrategy(config);
          break;
        case "webhook_idempotency":
          strategy = new WebhookIdempotencyCleanupStrategy(config);
          break;
        case "credential_revocation_retry":
          strategy = new CredentialRevocationRetryStrategy(config);
          break;
        case "deletion_sweep":
          strategy = new DeletionSweepStrategy(config);
          break;
        case "alert_history":
          strategy = new AlertHistoryCleanupStrategy(config);
          break;
        case "audit_logs":
          strategy = new AuditLogsCleanupStrategy(config);
          break;
        case "telemetry_retention":
          strategy = new TelemetryRetentionStrategy(config);
          break;
        case "trial_lifecycle":
          strategy = new TrialLifecycleStrategy(config);
          break;
        default:
          console.warn(
            `[DATA_LIFECYCLE] Unknown entity type: ${config.entityType}`
          );
          continue;
      }

      this.strategies.set(config.entityType, strategy);
    }
  }

  async initialize(redisConnection: Redis): Promise<void> {
    if (this.strategies.size === 0) {
      return;
    }

    // Store Redis connection for distributed locking
    this.redisConnection = redisConnection;

    try {
      const defaultJobOptions = {
        removeOnComplete: 20,
        removeOnFail: 50,
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 60000,
        },
      };
      this.cleanupQueue = new Queue<CleanupJobData>(DATA_LIFECYCLE_CLEANUP_QUEUE, {
        connection: redisConnection,
        defaultJobOptions,
      });
      this.urgentQueue = new Queue<CleanupJobData>(DATA_LIFECYCLE_URGENT_QUEUE, {
        connection: redisConnection,
        defaultJobOptions,
      });

      // Both workers dispatch by entity type, so a job an older replica still schedules on the heavy queue runs too.
      const processor = (job: { data: CleanupJobData }) => this.runCleanupJob(job.data);
      this.cleanupWorker = new Worker<CleanupJobData, CleanupOperationResult>(
        DATA_LIFECYCLE_CLEANUP_QUEUE,
        processor,
        {
          connection: redisConnection,
          concurrency: 1, // Process one heavy cleanup at a time
        }
      );
      this.urgentWorker = new Worker<CleanupJobData, CleanupOperationResult>(
        DATA_LIFECYCLE_URGENT_QUEUE,
        processor,
        // One at a time, like the heavy queue: a second job of the same strategy waits instead of being skipped.
        { connection: redisConnection, concurrency: 1 }
      );

      for (const worker of [this.cleanupWorker, this.urgentWorker]) {
        // A cleanup Worker whose blocking connection ended after a failover would stall trial expiry silently.
        watchConsumer(worker);
        worker.on("completed", (job, result) => {
          if (!result.success || result.errors.length > 0) {
            console.error(
              `[DATA_LIFECYCLE] Job ${job.id} completed with errors:`,
              {
                entityType: result.entityType,
                errors: result.errors,
              }
            );
          }
        });
        worker.on("failed", (job, err) => {
          console.error(`[DATA_LIFECYCLE] Job ${job?.id} failed:`, err.message);
        });
      }

      // Schedule all enabled strategies
      for (const strategy of this.strategies.values()) {
        try {
          await this.scheduleCleanup(strategy.config);
        } catch (error) {
          console.error(
            `[DATA_LIFECYCLE] Failed to schedule ${strategy.config.entityType}, continuing with others:`,
            error
          );
          // Continue with other strategies even if one fails
        }
      }
    } catch (error) {
      console.error("[DATA_LIFECYCLE] Failed to initialize:", error);
      throw error;
    }
  }

  private queueFor(entityType: CleanupEntityType): Queue<CleanupJobData> | null {
    return URGENT_CLEANUP_ENTITY_TYPES.has(entityType) ? this.urgentQueue : this.cleanupQueue;
  }

  /** Runs one cleanup job under the entity's owned lock. */
  private async runCleanupJob(data: CleanupJobData): Promise<CleanupOperationResult> {
    const entityType = data.entityType;
    const strategy = this.strategies.get(entityType);
    if (!strategy) {
      throw new Error(`No strategy found for entity type: ${entityType}`);
    }

    const redis = this.redisConnection;
    let lock: OwnedLock | null = null;
    if (redis) {
      // A Redis error throws, so BullMQ retries; only a held lock is a successful skip.
      lock = await acquireOwnedLock(redis, `cleanup:${entityType}:lock`, {
        ttlMs: CLEANUP_LOCK_TTL_MS,
        renewEveryMs: CLEANUP_LOCK_RENEW_MS,
        maxHoldMs: CLEANUP_LOCK_MAX_HOLD_MS,
      });
      if (!lock) {
        console.log(`[DATA_LIFECYCLE] Skipping ${entityType} - another instance is running cleanup`);
        return {
          success: true,
          entityType,
          recordsDeleted: 0,
          duration: 0,
          errors: [],
          details: { skipped: true, reason: "Lock held by another instance" },
        };
      }
    } else {
      console.warn("[DATA_LIFECYCLE] No Redis connection - skipping distributed lock");
    }

    try {
      const result = await strategy.execute(data.dryRun || false, {
        signal: lock?.signal,
        cursor: redis && lock ? redisCursorStore(redis, lock) : undefined,
      });
      if (!result.success) {
        throw new Error(result.errors.join("; ") || `${entityType} cleanup failed`);
      }
      return result;
    } finally {
      await lock?.release();
    }
  }

  private async scheduleCleanup(config: CleanupStrategyConfig): Promise<void> {
    const queue = this.queueFor(config.entityType);
    if (!queue || !this.cleanupQueue) {
      throw new Error("Cleanup queue not initialized");
    }

    try {
      const name = `${config.entityType}-cleanup`;

      // upsertJobScheduler is atomic, so replicas starting together cannot drop a firing.
      await queue.upsertJobScheduler(
        name,
        { pattern: config.cronSchedule },
        {
          name,
          data: {
            entityType: config.entityType,
            scheduledAt: new Date().toISOString(),
            manual: false,
            dryRun: false,
            config,
          },
        }
      );

      // Removed after the upsert so a failed upsert never leaves nothing scheduled.
      if (queue !== this.cleanupQueue) {
        // Moved to the urgent queue: drop its old scheduler from the heavy queue (a no-op once gone).
        await this.cleanupQueue.removeJobScheduler(name);
      }
      // One-time, idempotent removal of the legacy repeatable (added with
      // `repeat` + jobId `<entity>-cleanup-recurring`). Scheduler entries share
      // this zset and the same name, but their key is the scheduler id.
      // An old replica still on the legacy code finds our scheduler by this name,
      // removes it and re-adds its repeatable: one firing either way.
      const existingJobs = await this.cleanupQueue.getRepeatableJobs();
      for (const legacy of existingJobs.filter((job) => job.name === name && job.key !== name)) {
        await this.cleanupQueue.removeRepeatableByKey(legacy.key);
      }
    } catch (error) {
      console.error(
        `[DATA_LIFECYCLE] Failed to schedule ${config.entityType}:`,
        error
      );
      // Don't throw error - continue with other strategies
    }
  }

  async triggerManualCleanup(
    entityType: CleanupEntityType,
    dryRun = false
  ): Promise<CleanupOperationResult> {
    const queue = this.queueFor(entityType);
    if (!queue || !this.redisConnection) {
      throw new Error("Cleanup queue not initialized");
    }

    const strategy = this.strategies.get(entityType);
    if (!strategy) {
      throw new Error(`No strategy found for entity type: ${entityType}`);
    }

    // Created on the first manual run of a queue only: QueueEvents holds a permanent blocking Redis connection.
    // Ready before add, so the completion event cannot be missed. shutdown() closes it.
    // Options, not the shared client: BullMQ then owns the blocking connection and close() quits it (AGENTS.md gotcha 5).
    let events = this.queueEvents.get(queue.name);
    if (!events) {
      events = watchConsumer(new QueueEvents(queue.name, {
        connection: buildRedisOptions({ lazyConnect: false }),
      }));
      events.on("error", (error) => {
        console.error("[DATA LIFECYCLE] Cleanup QueueEvents error:", error);
      });
      this.queueEvents.set(queue.name, events);
    }
    const created = events;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Bounded: a Redis that refuses new connections must fail this call, not hang it (and every later one).
      await Promise.race([
        created.waitUntilReady(),
        new Promise<never>((_, reject) => {
          readyTimer = setTimeout(() => reject(new Error("Cleanup QueueEvents not ready")), QUEUE_EVENTS_READY_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      // Do not cache a broken instance; a concurrent caller may already have cached a fresh one.
      if (this.queueEvents.get(queue.name) === created) this.queueEvents.delete(queue.name);
      // Not awaited: close() first awaits a client that may never connect, which would void the deadline.
      void created.close().catch(() => {});
      throw error;
    } finally {
      clearTimeout(readyTimer);
    }

    const job = await queue.add(
      `manual-${entityType}-cleanup`,
      {
        entityType,
        scheduledAt: new Date().toISOString(),
        manual: true,
        dryRun,
        config: strategy.config,
      },
      {
        priority: 10,
      }
    );

    const result = await job.waitUntilFinished(created);
    return result;
  }

  async getStatus(): Promise<{
    enabledStrategies: CleanupEntityType[];
    queueStatus: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    } | null;
    stats: Map<CleanupEntityType, { totalRecords: number; oldRecords: number }>;
  }> {
    let queueStatus = null;

    const queues = [this.cleanupQueue, this.urgentQueue].filter((queue) => queue !== null);
    if (queues.length > 0) {
      const counts = await Promise.all(
        queues.map((queue) => queue.getJobCounts("waiting", "active", "completed", "failed")),
      );
      const sum = (state: string) => counts.reduce((total, c) => total + (c[state] ?? 0), 0);
      queueStatus = {
        waiting: sum("waiting"),
        active: sum("active"),
        completed: sum("completed"),
        failed: sum("failed"),
      };
    }

    const stats = new Map<
      CleanupEntityType,
      { totalRecords: number; oldRecords: number }
    >();
    for (const [entityType, strategy] of this.strategies) {
      try {
        stats.set(entityType, await strategy.getStats());
      } catch (error) {
        console.error(
          `[DATA_LIFECYCLE] Failed to get stats for ${entityType}:`,
          error
        );
      }
    }

    return {
      enabledStrategies: Array.from(this.strategies.keys()),
      queueStatus,
      stats,
    };
  }

  /**
   * Gets the count of enabled strategies without querying the database.
   * Used during startup to avoid overwhelming DB connections with TLS handshakes.
   */
  getEnabledStrategiesCount(): number {
    return this.strategies.size;
  }

  async shutdown(): Promise<void> {
    const { cleanupWorker, urgentWorker, cleanupQueue, urgentQueue } = this;
    const events = [...this.queueEvents.values()];
    // Reset first so a repeated shutdown is a no-op.
    this.cleanupWorker = null;
    this.urgentWorker = null;
    this.cleanupQueue = null;
    this.urgentQueue = null;
    this.queueEvents = new Map();

    const results = await Promise.allSettled([
      cleanupWorker?.close(),
      urgentWorker?.close(),
      cleanupQueue?.close(),
      urgentQueue?.close(),
      ...events.map((e) => e.close()),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[DataLifecycle] Shutdown close failed:", result.reason instanceof Error ? result.reason.message : result.reason);
      }
    }
  }
}

// Writes or clears the cursor only while KEYS[1] still holds this owner's token.
const FENCED_CURSOR_SCRIPT = `if redis.call("get", KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[2] == "" then redis.call("del", KEYS[2]) else redis.call("set", KEYS[2], ARGV[2], "EX", ARGV[3]) end
return 1`;

/**
 * Cleanup resume cursors kept in Redis, fenced on the run's lock: a run that lost its lock cannot overwrite the
 * position its successor saved. They expire after a week so a removed strategy leaves nothing behind.
 */
export function redisCursorStore(redis: Redis, lock: Pick<OwnedLock, "key" | "token">): CleanupCursorStore {
  return {
    get: (key) => redis.get(key),
    async set(key, value) {
      await redis.eval(FENCED_CURSOR_SCRIPT, 2, lock.key, key, lock.token, value ?? "", String(7 * 24 * 3600));
    },
  };
}

// ============================================================================
// ENVIRONMENT VARIABLE PARSING UTILITIES
// ============================================================================

/**
 * Parse a boolean environment variable with a default value
 * Handles common truthy/falsy values and normalization
 *
 * @param envVar - The environment variable value
 * @param defaultValue - The default if env var is not set
 * @returns - boolean result
 */
function parseBooleanEnv(
  envVar: string | undefined,
  defaultValue: boolean
): boolean {
  if (envVar === undefined) {
    return defaultValue;
  }

  const normalized = envVar.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  // Invalid value - log and use default
  console.warn(
    `[DATA_LIFECYCLE] Invalid boolean env var value: "${envVar}", using default: ${defaultValue}`
  );
  return defaultValue;
}

/**
 * Parse and strip quotes from cron schedule string
 * Handles environment variables that may be quoted
 */
function parseCronSchedule(
  cronEnv: string | undefined,
  defaultCron: string
): string {
  const value = (cronEnv || defaultCron).trim();
  return value.replace(/^["']|["']$/g, "");
}

// ============================================================================
// FACTORY & GLOBAL INSTANCE
// ============================================================================

/**
 * Create data lifecycle service from environment variables
 * Uses consistent configuration parsing with sensible defaults
 */
export function createDataLifecycleService(): DataLifecycleService {
  const strategies: CleanupStrategyConfig[] = [
    // Monitor Results Cleanup
    // Enabled by default to prevent database bloat from monitor checks
    // Note: Actual retention is per-plan from database; retentionDays is fallback only
    {
      entityType: "monitor_results",
      enabled: parseBooleanEnv(process.env.MONITOR_CLEANUP_ENABLED, true),
      // Hourly: each run is bounded by a time budget and a per-organization cap, so frequent runs keep up.
      cronSchedule: parseCronSchedule(
        process.env.MONITOR_CLEANUP_CRON,
        "10 * * * *"
      ),
      batchSize: clampInt(process.env.MONITOR_CLEANUP_BATCH_SIZE, { min: 1, max: 10_000, fallback: 5000, name: "MONITOR_CLEANUP_BATCH_SIZE" }),
      // Rows per organization per run.
      maxRecordsPerRun: clampInt(process.env.MONITOR_CLEANUP_SAFETY_LIMIT, { min: 1, max: 100_000_000, fallback: 500_000, name: "MONITOR_CLEANUP_SAFETY_LIMIT" }),
    },

    // Monitor Aggregates Cleanup
    // Cleans up old aggregated metrics based on plan retention
    {
      entityType: "monitor_aggregates",
      enabled: parseBooleanEnv(
        process.env.MONITOR_AGGREGATES_CLEANUP_ENABLED,
        true
      ),
      cronSchedule: parseCronSchedule(
        process.env.MONITOR_AGGREGATES_CLEANUP_CRON,
        "30 2 * * *"
      ),
      retentionDays: 365, // Organizations without a plan row
      batchSize: clampInt(process.env.MONITOR_AGGREGATES_CLEANUP_BATCH_SIZE, { min: 1, max: 10_000, fallback: 5000, name: "MONITOR_AGGREGATES_CLEANUP_BATCH_SIZE" }),
      // Rows per organization per run.
      maxRecordsPerRun: clampInt(process.env.MONITOR_AGGREGATES_CLEANUP_SAFETY_LIMIT, { min: 1, max: 100_000_000, fallback: 500_000, name: "MONITOR_AGGREGATES_CLEANUP_SAFETY_LIMIT" }),
    },

    // Monitor Hourly Aggregation
    // Computes hourly P95, avg, uptime from raw monitor_results
    {
      entityType: "monitor_aggregation_hourly",
      enabled: parseBooleanEnv(
        process.env.MONITOR_AGGREGATION_HOURLY_ENABLED,
        true
      ),
      cronSchedule: parseCronSchedule(
        process.env.MONITOR_AGGREGATION_HOURLY_CRON,
        "5 * * * *"
      ),
    },

    // Monitor Daily Aggregation
    // Computes daily P95, avg, uptime from raw monitor_results
    {
      entityType: "monitor_aggregation_daily",
      enabled: parseBooleanEnv(
        process.env.MONITOR_AGGREGATION_DAILY_ENABLED,
        true
      ),
      cronSchedule: parseCronSchedule(
        process.env.MONITOR_AGGREGATION_DAILY_CRON,
        "15 0 * * *"
      ),
    },

    { entityType: "run_artifacts", enabled: true, cronSchedule: "*/15 * * * *",
      batchSize: 100, maxRecordsPerRun: 1000 },

    // Job Runs Cleanup
    // Enabled by default for storage management
    // Note: Actual retention is per-plan from database; retentionDays is fallback only
    {
      entityType: "job_runs",
      enabled: parseBooleanEnv(process.env.JOB_RUNS_CLEANUP_ENABLED, true),
      cronSchedule: parseCronSchedule(
        process.env.JOB_RUNS_CLEANUP_CRON,
        "0 3 * * *"
      ),
      retentionDays: 90, // Fallback if plan settings unavailable
      customConfig: {
        playgroundMaxAgeHours: parseInt(process.env.PLAYGROUND_CLEANUP_MAX_AGE_HOURS || "24", 10),
      },
      batchSize: parseInt(process.env.JOB_RUNS_CLEANUP_BATCH_SIZE || "100", 10),
      maxRecordsPerRun: parseInt(
        process.env.JOB_RUNS_CLEANUP_SAFETY_LIMIT || "10000",
        10
      ),
    },

    // Playground Artifacts Cleanup
    // Enabled by default - cleans up temporary playground artifacts (24h max age)
    {
      entityType: "playground_artifacts",
      enabled: parseBooleanEnv(process.env.PLAYGROUND_CLEANUP_ENABLED, true),
      cronSchedule: parseCronSchedule(
        process.env.PLAYGROUND_CLEANUP_CRON,
        "0 5 * * *" // 5 AM daily (24h cleanup cycle, after other cleanups)
      ),
      customConfig: {
        maxAgeHours: parseInt(
          process.env.PLAYGROUND_CLEANUP_MAX_AGE_HOURS || "24",
          10
        ),
        bucketName:
          process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts",
      },
    },

    // Webhook Idempotency Cleanup
    // Enabled by default - these records have built-in TTL (expiresAt column)
    // Cleans up expired webhook idempotency records that are past their TTL
    {
      entityType: "webhook_idempotency",
      enabled: parseBooleanEnv(process.env.WEBHOOK_CLEANUP_ENABLED, true),
      cronSchedule: parseCronSchedule(
        process.env.WEBHOOK_CLEANUP_CRON,
        "0 4 * * *" // 4 AM daily (after other cleanups)
      ),
      batchSize: parseInt(process.env.WEBHOOK_CLEANUP_BATCH_SIZE || "1000", 10),
      maxRecordsPerRun: parseInt(
        process.env.WEBHOOK_CLEANUP_SAFETY_LIMIT || "100000",
        10
      ),
    },

    // Credential revocation retry
    // Security remediation, so it has its own switch and does not depend on webhook cleanup.
    // Failed markers expire after 7 days; hourly retries leave many chances before that.
    {
      entityType: "credential_revocation_retry",
      enabled: parseBooleanEnv(process.env.CREDENTIAL_REVOCATION_RETRY_ENABLED, true),
      cronSchedule: parseCronSchedule(
        process.env.CREDENTIAL_REVOCATION_RETRY_CRON,
        "20 * * * *" // hourly
      ),
    },

    // Background purge sweep: re-triggers stuck, due and orphaned deletions (cheap indexed reads)
    {
      entityType: "deletion_sweep",
      enabled: parseBooleanEnv(process.env.DELETION_SWEEP_ENABLED, true),
      cronSchedule: parseCronSchedule(process.env.DELETION_SWEEP_CRON, "*/2 * * * *"),
    },

    // Alert History Cleanup
    // Enabled by default - prevents unbounded growth of alert notification history
    // Default retention: 90 days (configurable via ALERT_HISTORY_RETENTION_DAYS)
    {
      entityType: "alert_history",
      enabled: parseBooleanEnv(process.env.ALERT_HISTORY_CLEANUP_ENABLED, true),
      cronSchedule: parseCronSchedule(
        process.env.ALERT_HISTORY_CLEANUP_CRON,
        "30 4 * * *" // 4:30 AM daily (after webhook cleanup)
      ),
      retentionDays: parseInt(
        process.env.ALERT_HISTORY_RETENTION_DAYS || "90",
        10
      ),
      batchSize: parseInt(
        process.env.ALERT_HISTORY_CLEANUP_BATCH_SIZE || "1000",
        10
      ),
      maxRecordsPerRun: parseInt(
        process.env.ALERT_HISTORY_CLEANUP_SAFETY_LIMIT || "100000",
        10
      ),
    },

    // Audit Logs Cleanup
    // Category-aware retention rules enforced in strategy (30d/90d/365d)
    {
      entityType: "audit_logs",
      enabled: parseBooleanEnv(process.env.AUDIT_LOGS_CLEANUP_ENABLED, true),
      cronSchedule: parseCronSchedule(
        process.env.AUDIT_LOGS_CLEANUP_CRON,
        "0 1 * * *"
      ),
      retentionDays: AUDIT_RETENTION_DAYS,
      batchSize: parseInt(process.env.AUDIT_LOGS_CLEANUP_BATCH_SIZE || "1000", 10),
      maxRecordsPerRun: parseInt(
        process.env.AUDIT_LOGS_CLEANUP_SAFETY_LIMIT || "100000",
        10
      ),
    },

    // Telemetry retention: heartbeats, finished private agent jobs, SRE snapshots/observations/alert events, notification outbox events.
    // Per-table days: PRIVATE_AGENT_HEARTBEAT_RETENTION_DAYS (7), PRIVATE_AGENT_JOB_RETENTION_DAYS (30), SRE_HEALTH_SNAPSHOT_RETENTION_DAYS (90),
    // SRE_DEPENDENCY_OBSERVATION_RETENTION_DAYS (90), SRE_ALERT_EVENT_RETENTION_DAYS (90),
    // STATUS_PAGE_DELIVERY_RETENTION_DAYS (30, shared with delivery rows).
    {
      entityType: "telemetry_retention",
      enabled: parseBooleanEnv(process.env.TELEMETRY_RETENTION_ENABLED, true),
      cronSchedule: parseCronSchedule(
        process.env.TELEMETRY_RETENTION_CRON,
        "45 * * * *" // hourly: heartbeats arrive at ~2,880 rows per agent per day, so a daily pass would need a huge cap
      ),
      batchSize: resolveBatchSize(process.env.TELEMETRY_RETENTION_BATCH_SIZE),
      maxRecordsPerRun: resolveSafetyLimit(process.env.TELEMETRY_RETENTION_SAFETY_LIMIT),
    },

    // Trial lifecycle: end expired trials (pause monitors, archive status pages)
    {
      entityType: "trial_lifecycle",
      enabled: parseBooleanEnv(process.env.TRIAL_LIFECYCLE_ENABLED, true),
      cronSchedule: parseCronSchedule(process.env.TRIAL_LIFECYCLE_CRON, "*/15 * * * *"),
      batchSize: 50,
      maxRecordsPerRun: 50,
    },
  ];

  // Validate all configured strategies
  for (const config of strategies) {

    if (config.enabled) {
      // Validate cron schedule
      const cronParts = config.cronSchedule.split(/\s+/);
      if (cronParts.length !== 5 && cronParts.length !== 6) {
        throw new Error(
          `Invalid cron schedule for ${config.entityType}: "${config.cronSchedule}" (expected 5-6 parts, got ${cronParts.length})`
        );
      }
    }
  }

  return new DataLifecycleService(strategies);
}

let dataLifecycleInstance: DataLifecycleService | null = null;

export function getDataLifecycleService(): DataLifecycleService | null {
  return dataLifecycleInstance;
}

export function setDataLifecycleInstance(instance: DataLifecycleService): void {
  dataLifecycleInstance = instance;
}
