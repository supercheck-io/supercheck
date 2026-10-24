/**
 * Unified Data Lifecycle Management Service
 *
 * Enterprise-grade service for managing data retention, cleanup, and archival
 * across all entities (monitors, jobs, runs, playground, webhooks, etc.)
 *
 * Key Features:
 * - Pluggable cleanup strategies for different entities
 * - Unified BullMQ queue for all cleanup operations
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
 * - Pro plan: 7 days raw data, 90 days aggregated/job data
 * - Unlimited plan: 7 days raw data, 90 days aggregated/job data (self-hosted)
 * - Cleanup is performed per-organization to respect plan limits
 *
 * PostgreSQL TTL Note:
 * - PostgreSQL does NOT have automatic TTL/row expiration like Redis or MongoDB
 * - The expiresAt column requires explicit cleanup via this service
 * - This is the recommended approach for PostgreSQL data lifecycle management
 *
 * @module data-lifecycle-service
 */

import { db } from "@/utils/db";
import { TRIAL_RETENTION } from "@/lib/execution/trial-limits";
import {
  monitorResults,
  monitors,
  runs,
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
import { createS3CleanupService, type ReportDeletionInput } from "./s3-cleanup";
import { isPolarEnabled } from "@/lib/feature-flags";
import { monitorAggregationService } from "./monitor-aggregation-service";
import { endExpiredTrials, reconcilePaidTrialSuspensions, sendTrialReminders } from "@/lib/execution/trial-lifecycle";
import { deliverTrialReminder } from "@/lib/execution/trial-reminder-delivery";

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
 * - "alert_history": Alert notification history records
 * - "audit_logs": User/system/security audit records
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
  | "job_runs"
  | "playground_artifacts"
  | "webhook_idempotency"
  | "alert_history"
  | "audit_logs"
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
 * Get retention settings for all organizations based on their subscription plans
 * Seeded raw retention is 7 days on all plans; deployments can change plan_limits.
 *
 * @param fallbackRetentionDays - Default retention for missing plan settings
 * @returns Array of organization retention settings
 */
export async function getOrganizationRetentionSettings(
  fallbackRetentionDays: number
): Promise<OrganizationRetention[]> {
  try {
    // In self-hosted mode, use the unlimited plan's retention from database
    if (!isPolarEnabled()) {
      const orgs = await db.select({ id: organization.id }).from(organization);

      // Fetch the unlimited plan's retention from database
      const unlimitedPlan = await db
        .select({ dataRetentionDays: planLimits.dataRetentionDays })
        .from(planLimits)
        .where(eq(planLimits.plan, "unlimited"))
        .limit(1);

      // Use database value if available, otherwise fallback
      const retentionDays =
        unlimitedPlan[0]?.dataRetentionDays ?? fallbackRetentionDays;

      return orgs.map((org) => ({
        organizationId: org.id,
        retentionDays,
        plan: "unlimited",
      }));
    }

    // In cloud mode, fetch each org's plan and corresponding retention
    const orgsWithPlans = await db
      .select({
        organizationId: organization.id,
        subscriptionPlan: organization.subscriptionPlan,
      })
      .from(organization);

    // Get all plan limits for lookup
    const plans = await db.select().from(planLimits);
    const planRetentionMap = new Map(
      plans.map((p) => [p.plan, p.dataRetentionDays])
    );

    const trialOrganizations = await getActiveTrialOrganizationIds();

    return orgsWithPlans.map((org) => ({
      organizationId: org.organizationId,
      retentionDays: org.subscriptionPlan
        ? planRetentionMap.get(org.subscriptionPlan) || fallbackRetentionDays
        : trialOrganizations.has(org.organizationId)
          ? TRIAL_RETENTION.dataRetentionDays
          : fallbackRetentionDays,
      plan: org.subscriptionPlan || "fallback",
    }));
  } catch (error) {
    console.warn(
      "[DATA_LIFECYCLE] Failed to fetch organization retention settings, skipping cleanup:",
      error
    );
    // A lookup outage must not shorten another organization's retention.
    throw error;
  }
}

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
      const orgs = await db.select({ id: organization.id }).from(organization);

      // Fetch the unlimited plan's aggregated retention from database
      const unlimitedPlan = await db
        .select({ aggregatedDataRetentionDays: planLimits.aggregatedDataRetentionDays })
        .from(planLimits)
        .where(eq(planLimits.plan, "unlimited"))
        .limit(1);

      // Use database value if available, otherwise fallback
      const aggregatedRetentionDays =
        unlimitedPlan[0]?.aggregatedDataRetentionDays ?? fallbackAggregatedRetentionDays;

      return orgs.map((org) => ({
        organizationId: org.id,
        aggregatedRetentionDays,
        plan: "unlimited",
      }));
    }

    // In cloud mode, fetch each org's plan and corresponding aggregated retention
    const orgsWithPlans = await db
      .select({
        organizationId: organization.id,
        subscriptionPlan: organization.subscriptionPlan,
      })
      .from(organization);

    // Get all plan limits for lookup
    const plans = await db.select().from(planLimits);
    const planAggregatedRetentionMap = new Map(
      plans.map((p) => [p.plan, p.aggregatedDataRetentionDays])
    );

    const trialOrganizations = await getActiveTrialOrganizationIds();

    return orgsWithPlans.map((org) => ({
      organizationId: org.organizationId,
      aggregatedRetentionDays: org.subscriptionPlan
        ? planAggregatedRetentionMap.get(org.subscriptionPlan) ||
          fallbackAggregatedRetentionDays
        : trialOrganizations.has(org.organizationId)
          ? TRIAL_RETENTION.aggregatedDataRetentionDays
          : fallbackAggregatedRetentionDays,
      plan: org.subscriptionPlan || "fallback",
    }));
  } catch (error) {
    console.warn(
      "[DATA_LIFECYCLE] Failed to fetch organization aggregated retention settings, using fallback:",
      error
    );
    // Return empty array - will fall back to global cleanup
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
 * - Unlimited: 90 days (self-hosted seed)
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

      return orgs.map((org) => ({
        organizationId: org.id,
        jobRetentionDays,
        plan: "unlimited",
      }));
    }

    // In cloud mode, fetch each org's plan and corresponding job retention
    const orgsWithPlans = await db
      .select({
        organizationId: organization.id,
        subscriptionPlan: organization.subscriptionPlan,
      })
      .from(organization);

    // Get all plan limits for lookup
    const plans = await db.select().from(planLimits);
    const planJobRetentionMap = new Map(
      plans.map((p) => [p.plan, p.jobDataRetentionDays])
    );

    const trialOrganizations = await getActiveTrialOrganizationIds();

    return orgsWithPlans.map((org) => ({
      organizationId: org.organizationId,
      jobRetentionDays: org.subscriptionPlan
        ? planJobRetentionMap.get(org.subscriptionPlan) ||
          fallbackJobRetentionDays
        : trialOrganizations.has(org.organizationId)
          ? TRIAL_RETENTION.jobDataRetentionDays
          : fallbackJobRetentionDays,
      plan: org.subscriptionPlan || "fallback",
    }));
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
   * Execute the cleanup operation
   */
  execute(dryRun?: boolean): Promise<CleanupOperationResult>;

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

/**
 * Monitor Results Cleanup Strategy
 *
 * Manages retention of monitor_results table with:
 * - **Multi-tenant aware**: Cleans up per organization based on plan retention
 * - Time-based retention (plan-specific or global fallback)
 * - Status change preservation
 * - Batch processing
 *
 * Multi-Tenancy Implementation:
 * - Fetches all organizations and their plan-based retention settings
 * - Processes cleanup per organization to respect different retention periods
 * - Skips cleanup on plan lookup errors; global fallback only when no organizations exist
 *
 * Resource Optimization:
 * - Uses batched deletions (default 1000 records) to minimize DB load
 * - 100ms delay between batches to prevent overwhelming the database
 * - Processes organizations sequentially to avoid resource spikes
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

  validate(): void {
    if (!this.config.retentionDays || this.config.retentionDays <= 0) {
      throw new Error("Monitor results cleanup requires retentionDays > 0");
    }
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    // Use the minimum retention period for stats (shows worst case)
    const cutoffDate = new Date(
      Date.now() - this.config.retentionDays! * 24 * 60 * 60 * 1000
    );

    const [total, old] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(monitorResults),
      db
        .select({ count: sql<number>`count(*)` })
        .from(monitorResults)
        .where(
          and(
            lt(monitorResults.checkedAt, cutoffDate),
            eq(monitorResults.isStatusChange, false) // Exclude status changes
          )
        ),
    ]);

    return {
      totalRecords: Number(total[0]?.count || 0),
      oldRecords: Number(old[0]?.count || 0),
    };
  }

  /**
   * Execute cleanup with multi-tenant awareness
   *
   * Strategy:
   * 1. Fetch all organizations with their plan-based retention settings
   * 2. For each organization, calculate the appropriate cutoff date
   * 3. Delete monitor results older than the org's retention period
   * 4. Process in batches to minimize resource consumption
   */
  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const batchSize = this.config.batchSize || 1000;
    const maxRecords = this.config.maxRecordsPerRun || 1000000;

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
      // Get organization retention settings (plan-based)
      const orgRetentions = await getOrganizationRetentionSettings(
        this.config.retentionDays!
      );

      // If no org-specific settings, fall back to global cleanup
      if (orgRetentions.length === 0) {
        console.log(
          "[DATA_LIFECYCLE] [monitor_results] No organization retention settings found, using global fallback"
        );
        return this.executeGlobalCleanup(dryRun);
      }

      let totalDeleted = 0;
      let totalProcessed = 0;
      const orgStats: Record<
        string,
        { deleted: number; retentionDays: number }
      > = {};

      // Process each organization with their specific retention period
      for (const orgRetention of orgRetentions) {
        if (totalProcessed >= maxRecords) {
          console.log(
            `[DATA_LIFECYCLE] [monitor_results] Reached max records limit (${maxRecords}), stopping`
          );
          break;
        }

        const cutoffDate = new Date(
          Date.now() - orgRetention.retentionDays * 24 * 60 * 60 * 1000
        );

        let orgDeleted = 0;
        // Keep PostgreSQL microseconds; Date truncation can reselect retained failures.
        let cursor: { checkedAt: string; id: string } | undefined;
        let iterations = 0;
        const maxIterations = Math.ceil(
          (maxRecords - totalProcessed) / batchSize
        );

        while (iterations < maxIterations) {
          // Find monitor IDs belonging to this organization
          const monitorsInOrg = await db
            .select({ id: monitors.id })
            .from(monitors)
            .where(eq(monitors.organizationId, orgRetention.organizationId));

          if (monitorsInOrg.length === 0) break;

          const monitorIds = monitorsInOrg.map((m) => m.id);

          if (dryRun) {
            // Count records that would be deleted for this org
            const count = await this.countResultsToClean(and(
              inArray(monitorResults.monitorId, monitorIds),
              lt(monitorResults.checkedAt, cutoffDate),
              or(
                eq(monitorResults.isStatusChange, false),
                isNotNull(monitorResults.testExecutionId),
                isNotNull(monitorResults.testReportS3Url)
              )
            )!, maxRecords - totalProcessed);
            orgDeleted += count.deleted;
            totalProcessed += count.processed;
            result.details.recordsProcessed = totalProcessed;
            break; // In dry-run, just count once
          } else {
            // Get IDs to delete for this organization
            const idsToDelete = await db
              .select({
                id: monitorResults.id,
                checkedAt: sql<string>`${monitorResults.checkedAt}::text`,
                isStatusChange: monitorResults.isStatusChange,
                status: monitorResults.status,
                testExecutionId: monitorResults.testExecutionId,
                testReportS3Url: monitorResults.testReportS3Url,
              })
              .from(monitorResults)
              .where(
                and(
                  inArray(monitorResults.monitorId, monitorIds),
                  lt(monitorResults.checkedAt, cutoffDate),
                  cursor ? or(
                    gt(monitorResults.checkedAt, sql`${cursor.checkedAt}::timestamp`),
                    and(eq(monitorResults.checkedAt, sql`${cursor.checkedAt}::timestamp`), gt(monitorResults.id, cursor.id))
                  ) : undefined,
                  or(
                    eq(monitorResults.isStatusChange, false),
                    isNotNull(monitorResults.testExecutionId),
                    isNotNull(monitorResults.testReportS3Url)
                  )
                )
              )
              .orderBy(asc(monitorResults.checkedAt), asc(monitorResults.id))
              .limit(Math.min(batchSize, maxRecords - totalProcessed));

            if (idsToDelete.length === 0) break;

            totalProcessed += idsToDelete.length;
            result.details.recordsProcessed = totalProcessed;
            try {
              orgDeleted += await this.cleanupBatch(idsToDelete, result);
              const last = idsToDelete[idsToDelete.length - 1];
              cursor = { checkedAt: last.checkedAt, id: last.id };
              result.recordsDeleted = totalDeleted + orgDeleted;
            } catch (error) {
              // Preserve this failed batch for retry without starving other tenants.
              result.success = false;
              result.errors.push(error instanceof Error ? error.message : String(error));
              break;
            }

            // Small delay between batches
            if (idsToDelete.length === batchSize) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }

          iterations++;
          if (totalProcessed >= maxRecords) break;
        }

        if (orgDeleted > 0) {
          orgStats[orgRetention.organizationId.substring(0, 8)] = {
            deleted: orgDeleted,
            retentionDays: orgRetention.retentionDays,
          };
        }
        totalDeleted += orgDeleted;
      }

      result.recordsDeleted = totalDeleted;
      result.duration = Date.now() - startTime;
      result.details.organizationsProcessed = orgRetentions.length;
      result.details.perOrgStats = orgStats;

      if (totalDeleted > 0) {
        console.log(
          `[DATA_LIFECYCLE] ${this.entityType}: ${
            dryRun ? "Would delete" : "Deleted"
          } ${totalDeleted} records across ${Object.keys(orgStats).length} organizations`
        );
      }
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      result.duration = Date.now() - startTime;
      console.error(
        `[DATA_LIFECYCLE] [${this.entityType}] Cleanup failed:`,
        error
      );
    }

    return result;
  }

  private async countResultsToClean(condition: SQL, limit: number) {
    const candidates = db.select({ isStatusChange: monitorResults.isStatusChange })
      .from(monitorResults).where(condition)
      .orderBy(asc(monitorResults.checkedAt), asc(monitorResults.id))
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
    }>,
    result: CleanupOperationResult
  ): Promise<number> {
    const inputs: ReportDeletionInput[] = rows
      .filter(row => row.testReportS3Url || (row.status !== "up" && row.testExecutionId))
      .map(row => ({
        entityType: "monitor",
        entityId: row.id,
        reportPath: row.testExecutionId || undefined,
        s3Url: row.testReportS3Url || undefined,
      }));
    let failedIds = new Set<string>();
    if (inputs.length > 0) {
      const s3Result = await this.s3Service.deleteReports(inputs);
      result.s3ObjectsDeleted! += s3Result.deletedObjects.length;
      if (!s3Result.success) {
        failedIds = this.s3Service.getFailedReportEntityIds(inputs, s3Result);
        result.success = false;
        result.errors.push(`Monitor artifact cleanup had ${s3Result.failedObjects.length} S3 failures; preserving failed pointers for retry`);
      }
    }

    rows = rows.filter(row => !failedIds.has(row.id));
    if (rows.length === 0) return 0;
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
    return deleteIds.length;
  }

  /**
   * Fallback global cleanup (original behavior)
   * Used when no organization retention settings exist
   */
  private async executeGlobalCleanup(
    dryRun: boolean
  ): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const cutoffDate = new Date(
      Date.now() - this.config.retentionDays! * 24 * 60 * 60 * 1000
    );
    const batchSize = this.config.batchSize || 1000;
    const maxRecords = this.config.maxRecordsPerRun || 1000000;

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      s3ObjectsDeleted: 0,
      duration: 0,
      errors: [],
      details: {
        cutoffDate: cutoffDate.toISOString(),
        dryRun,
        multiTenant: false,
      },
    };

    try {
      let totalDeleted = 0;
      let totalProcessed = 0;
      let cursor: { checkedAt: string; id: string } | undefined;
      let iterations = 0;
      const maxIterations = Math.ceil(maxRecords / batchSize);

      if (dryRun) {
        // Dry-run: count matching records once (no loop needed since data isn't modified)
        const count = await this.countResultsToClean(and(
          lt(monitorResults.checkedAt, cutoffDate),
          or(
            eq(monitorResults.isStatusChange, false),
            isNotNull(monitorResults.testExecutionId),
            isNotNull(monitorResults.testReportS3Url)
          )
        )!, maxRecords);
        totalDeleted = count.deleted;
        result.details.recordsProcessed = count.processed;
      } else {
        while (iterations < maxIterations) {
          const idsToDelete = await db
            .select({
              id: monitorResults.id,
              checkedAt: sql<string>`${monitorResults.checkedAt}::text`,
              isStatusChange: monitorResults.isStatusChange,
              status: monitorResults.status,
              testExecutionId: monitorResults.testExecutionId,
              testReportS3Url: monitorResults.testReportS3Url,
            })
            .from(monitorResults)
            .where(
              and(
                lt(monitorResults.checkedAt, cutoffDate),
                cursor ? or(
                  gt(monitorResults.checkedAt, sql`${cursor.checkedAt}::timestamp`),
                  and(eq(monitorResults.checkedAt, sql`${cursor.checkedAt}::timestamp`), gt(monitorResults.id, cursor.id))
                ) : undefined,
                or(
                eq(monitorResults.isStatusChange, false),
                isNotNull(monitorResults.testExecutionId),
                isNotNull(monitorResults.testReportS3Url)
              )
              )
            )
            .orderBy(asc(monitorResults.checkedAt), asc(monitorResults.id))
            .limit(Math.min(batchSize, maxRecords - totalProcessed));

          if (idsToDelete.length === 0) break;

          totalDeleted += await this.cleanupBatch(idsToDelete, result);
          const last = idsToDelete[idsToDelete.length - 1];
          cursor = { checkedAt: last.checkedAt, id: last.id };
          totalProcessed += idsToDelete.length;
          result.details.recordsProcessed = totalProcessed;
          result.recordsDeleted = totalDeleted;

          if (idsToDelete.length === batchSize) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          iterations++;
          if (totalProcessed >= maxRecords) break;
        }
      }

      result.recordsDeleted = totalDeleted;
      result.duration = Date.now() - startTime;
      result.details.iterations = iterations;

      if (totalDeleted > 0) {
        console.log(
          `[DATA_LIFECYCLE] ${this.entityType}: ${
            dryRun ? "Would delete" : "Deleted"
          } ${totalDeleted} records (global fallback)`
        );
      }
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      result.duration = Date.now() - startTime;
      console.error(
        `[DATA_LIFECYCLE] [${this.entityType}] Global cleanup failed:`,
        error
      );
    }

    return result;
  }
}

/**
 * Monitor Aggregates Cleanup Strategy
 *
 * Manages retention of monitor_aggregates table with:
 * - **Multi-tenant aware**: Cleans up per organization based on plan's aggregatedDataRetentionDays
 * - Hourly aggregates: Kept for 7 days, then rolled into daily aggregates
 * - Daily aggregates: Kept according to plan (Plus: 30 days, Pro: 365 days, Unlimited: 180 days)
 * - Uses the MonitorAggregationService for actual cleanup
 *
 * Industry Standard (Checkly-inspired):
 * - Plus plan: 30 days aggregated data retention
 * - Pro plan: 365 days (1 year) aggregated data retention
 * - Unlimited plan: 180 days (6 months) aggregated data retention
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
    // Use minimum retention for stats (hourly aggregates at 7 days)
    const hourlyCutoffDate = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000 // 7 days for hourly
    );

    const [total, oldHourly, oldDaily] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(monitorAggregates),
      db
        .select({ count: sql<number>`count(*)` })
        .from(monitorAggregates)
        .where(
          and(
            eq(monitorAggregates.periodType, "hourly"),
            lt(monitorAggregates.periodStart, hourlyCutoffDate)
          )
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(monitorAggregates)
        .where(
          and(
            eq(monitorAggregates.periodType, "daily"),
            lt(
              monitorAggregates.periodStart,
              new Date(
                Date.now() - this.config.retentionDays! * 24 * 60 * 60 * 1000
              )
            )
          )
        ),
    ]);

    return {
      totalRecords: Number(total[0]?.count || 0),
      oldRecords:
        Number(oldHourly[0]?.count || 0) + Number(oldDaily[0]?.count || 0),
    };
  }

  /**
   * Execute cleanup with multi-tenant awareness
   *
   * Strategy:
   * 1. Delegate to MonitorAggregationService which handles:
   *    - Per-organization retention based on aggregatedDataRetentionDays
   *    - Hourly aggregates cleaned up after 7 days (always)
   *    - Daily aggregates cleaned up per org's plan settings
   * 2. Process in batches to minimize resource consumption
   */
  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      duration: 0,
      errors: [],
      details: { dryRun, multiTenant: true },
    };

    try {
      // Get organization retention settings for aggregated data
      const orgRetentions = await getOrganizationAggregatedRetentionSettings(
        this.config.retentionDays!
      );

      let totalDeleted = 0;
      const orgStats: Record<
        string,
        { deleted: number; aggregatedRetentionDays: number }
      > = {};

      // Process each organization with their specific aggregated retention period
      for (const orgRetention of orgRetentions) {
        try {
          if (dryRun) {
            // In dry-run, just count what would be deleted
            const stats = await this.countOldAggregatesForOrg(
              orgRetention.organizationId,
              orgRetention.aggregatedRetentionDays
            );
            if (stats > 0) {
              orgStats[orgRetention.organizationId.substring(0, 8)] = {
                deleted: stats,
                aggregatedRetentionDays: orgRetention.aggregatedRetentionDays,
              };
            }
            totalDeleted += stats;
          } else {
            // Actual cleanup using the aggregation service
            const deleted =
              await monitorAggregationService.cleanupOldAggregatesForOrg(
                orgRetention.organizationId,
                7, // Always 7 days for hourly
                orgRetention.aggregatedRetentionDays
              );

            if (deleted > 0) {
              orgStats[orgRetention.organizationId.substring(0, 8)] = {
                deleted,
                aggregatedRetentionDays: orgRetention.aggregatedRetentionDays,
              };
            }
            totalDeleted += deleted;
          }
        } catch (orgError) {
          console.error(
            `[DATA_LIFECYCLE] [monitor_aggregates] Error cleaning up org ${orgRetention.organizationId.substring(0, 8)}:`,
            orgError
          );
          result.errors.push(
            `Org ${orgRetention.organizationId.substring(0, 8)}: ${orgError instanceof Error ? orgError.message : String(orgError)}`
          );
        }
      }

      result.recordsDeleted = totalDeleted;
      result.duration = Date.now() - startTime;
      result.details.organizationsProcessed = orgRetentions.length;
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
      result.duration = Date.now() - startTime;
      console.error(
        `[DATA_LIFECYCLE] [${this.entityType}] Cleanup failed:`,
        error
      );
    }

    return result;
  }

  /**
   * Count old aggregates for a specific organization (for dry-run)
   */
  private async countOldAggregatesForOrg(
    organizationId: string,
    dailyRetentionDays: number
  ): Promise<number> {
    const hourlyRetentionDays = 7; // Always 7 days for hourly

    const hourlyCutoff = new Date(
      Date.now() - hourlyRetentionDays * 24 * 60 * 60 * 1000
    );
    const dailyCutoff = new Date(
      Date.now() - dailyRetentionDays * 24 * 60 * 60 * 1000
    );

    // Get monitors for this organization
    const orgMonitors = await db
      .select({ id: monitors.id })
      .from(monitors)
      .where(eq(monitors.organizationId, organizationId));

    if (orgMonitors.length === 0) return 0;

    const monitorIds = orgMonitors.map((m) => m.id);

    const [hourlyCount, dailyCount] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(monitorAggregates)
        .where(
          and(
            inArray(monitorAggregates.monitorId, monitorIds),
            eq(monitorAggregates.periodType, "hourly"),
            lt(monitorAggregates.periodStart, hourlyCutoff)
          )
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(monitorAggregates)
        .where(
          and(
            inArray(monitorAggregates.monitorId, monitorIds),
            eq(monitorAggregates.periodType, "daily"),
            lt(monitorAggregates.periodStart, dailyCutoff)
          )
        ),
    ]);

    return (
      Number(hourlyCount[0]?.count || 0) + Number(dailyCount[0]?.count || 0)
    );
  }
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
    // Return aggregate counts instead of "old records"
    const [total] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(monitorAggregates),
    ]);

    return {
      totalRecords: Number(total[0]?.count || 0),
      oldRecords: 0, // Not applicable for aggregation
    };
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
    const [total] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(monitorAggregates)
        .where(eq(monitorAggregates.periodType, "daily")),
    ]);

    return {
      totalRecords: Number(total[0]?.count || 0),
      oldRecords: 0,
    };
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
 * - Unlimited: 90 days (self-hosted seed)
 *
 * Note: This strategy handles ALL runs in the database:
 * - Job runs (where jobId is not null)
 * - Playground runs (where jobId is null and metadata.source = 'playground')
 */
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
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    const cutoffDate = new Date(
      Date.now() - this.config.retentionDays! * 24 * 60 * 60 * 1000
    );

    // Get stats for all runs (job + playground)
    const [total, old, jobRuns, playgroundRuns, oldJobRuns, oldPlaygroundRuns] =
      await Promise.all([
        // Total runs count
        db.select({ count: sql<number>`count(*)` }).from(runs),
        // Old runs count (all types)
        db
          .select({ count: sql<number>`count(*)` })
          .from(runs)
          .where(lt(runs.createdAt, cutoffDate)),
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
            and(lt(runs.createdAt, cutoffDate), sql`${runs.jobId} IS NULL`)
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
      if (orgRetentions.length === 0) {
        result.details.multiTenant = false;
        await this.cleanupRuns(lt(runs.createdAt, new Date(
          Date.now() - this.config.retentionDays! * 86400000
        )), dryRun, maxRecords, result);
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

        // Standalone (playground) run rows have no plan; keep them for 30 days.
        const before = result.recordsDeleted;
        const remaining = maxRecords - Number(result.details.recordsProcessed || 0);
        if (remaining > 0) {
          await this.cleanupRuns(and(
            sql`${runs.jobId} IS NULL`,
            lt(runs.createdAt, new Date(Date.now() - 30 * 86400000))
          )!, dryRun, remaining, result);
        }
        result.details.playgroundRunsDeleted = result.recordsDeleted - before;
      }
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
          gt(runs.createdAt, sql`${cursor.createdAt}::timestamp`),
          and(eq(runs.createdAt, sql`${cursor.createdAt}::timestamp`), gt(runs.id, cursor.id))
        ) : undefined))
        .orderBy(asc(runs.createdAt), asc(runs.id)).limit(limit);
      if (oldRuns.length === 0) break;
      processed += oldRuns.length;
      result.details.recordsProcessed = Number(result.details.recordsProcessed || 0) + oldRuns.length;
      const runIds = oldRuns.map(run => run.id);
      const associatedReports = await db.select().from(reports).where(and(
        inArray(reports.entityType, ["job", "test", "k6_test", "k6_job"]),
        inArray(reports.entityId, runIds)
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
          for (const id of this.s3Service.getFailedReportEntityIds(inputs, s3Result)) invalidRunIds.add(id);
          result.success = false;
          result.errors.push(`Run artifact cleanup had ${s3Result.failedObjects.length} S3 failures; preserving failed pointers for retry`);
        }
      }
      const validRunIds = runIds.filter(id => !invalidRunIds.has(id));
      const validReportIds = associatedReports.filter(report => !invalidRunIds.has(report.entityId)).map(report => report.id);
      // Keep report pointers and runs together if either database deletion fails.
      if (validRunIds.length > 0) await db.transaction(async tx => {
        if (validReportIds.length > 0) {
          await tx.delete(reports).where(inArray(reports.id, validReportIds));
        }
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
          .where(lt(alertHistory.sentAt, cutoffDate)),
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
          .where(lt(alertHistory.sentAt, cutoffDate));

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
            .where(lt(alertHistory.sentAt, cutoffDate))
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

type AuditActionCategory =
  | "authentication"
  | "authorization"
  | "resource"
  | "execution"
  | "configuration"
  | "security"
  | "default";

const SECURITY_AUDIT_ACTIONS = new Set([
  "failed_login",
  "unauthorized_access_attempt",
  "suspicious_activity",
  "security_violation",
  "rate_limit_exceeded",
]);

function getAuditActionCategory(action: string): AuditActionCategory {
  const normalized = action.toLowerCase();

  if (
    SECURITY_AUDIT_ACTIONS.has(normalized) ||
    normalized.startsWith("security_") ||
    normalized.includes("unauthorized_access") ||
    normalized.includes("rate_limit")
  ) {
    return "security";
  }

  if (
    normalized === "login" ||
    normalized === "logout" ||
    normalized === "password_reset" ||
    normalized === "login_failed" ||
    normalized.startsWith("impersonation_")
  ) {
    return "authentication";
  }

  if (
    normalized === "role_change" ||
    normalized.startsWith("permission_")
  ) {
    return "authorization";
  }

  if (normalized.includes("settings") || normalized.includes("integration")) {
    return "configuration";
  }

  if (normalized.includes("executed") || normalized.includes("triggered")) {
    return "execution";
  }

  if (
    normalized.endsWith("_created") ||
    normalized.endsWith("_updated") ||
    normalized.endsWith("_deleted") ||
    normalized.endsWith("_create") ||
    normalized.endsWith("_update") ||
    normalized.endsWith("_delete")
  ) {
    return "resource";
  }

  return "default";
}

function getAuditActionRetentionDays(
  action: string,
  fallbackRetentionDays: number
): number {
  const category = getAuditActionCategory(action);
  switch (category) {
    case "resource":
    case "execution":
      return 30;
    case "authentication":
    case "authorization":
    case "configuration":
      return 90;
    case "security":
      return 365;
    default:
      return fallbackRetentionDays;
  }
}

/**
 * Audit Logs Cleanup Strategy
 *
 * Category-aware retention aligned with 06-data audit spec:
 * - Resource management / Execution: 30 days
 * - Authentication / Authorization / Configuration: 90 days
 * - Security: 365 days
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
    const fallbackRetentionDays = this.config.retentionDays || 90;
    const batchSize = this.config.batchSize || 1000;
    const maxRecords = this.config.maxRecordsPerRun || 100000;

    const minRetentionDays = 30;
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
        fallbackRetentionDays,
      },
    };

    try {
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

        const eligibleIds = candidates
          .filter((record) => {
            if (!record.createdAt) return false;
            const retentionDays = getAuditActionRetentionDays(
              record.action,
              fallbackRetentionDays
            );
            const actionCutoffDate = new Date(
              Date.now() - retentionDays * 24 * 60 * 60 * 1000
            );
            return record.createdAt < actionCutoffDate;
          })
          .map((record) => record.id);

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
  private cleanupQueue: Queue<CleanupJobData> | null = null;
  private cleanupWorker: Worker<CleanupJobData, CleanupOperationResult> | null =
    null;
  private cleanupQueueEvents: QueueEvents | null = null;
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
        case "job_runs":
          strategy = new JobRunsCleanupStrategy(config);
          break;
        case "playground_artifacts":
          strategy = new PlaygroundArtifactsCleanupStrategy(config);
          break;
        case "webhook_idempotency":
          strategy = new WebhookIdempotencyCleanupStrategy(config);
          break;
        case "alert_history":
          strategy = new AlertHistoryCleanupStrategy(config);
          break;
        case "audit_logs":
          strategy = new AuditLogsCleanupStrategy(config);
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
      // Create unified cleanup queue
      this.cleanupQueue = new Queue<CleanupJobData>("data-lifecycle-cleanup", {
        connection: redisConnection,
        defaultJobOptions: {
          removeOnComplete: 20,
          removeOnFail: 50,
          attempts: 2,
          backoff: {
            type: "exponential",
            delay: 60000,
          },
        },
      });

      this.cleanupQueueEvents = new QueueEvents("data-lifecycle-cleanup", {
        connection: redisConnection,
      });

      // Create worker with distributed locking
      this.cleanupWorker = new Worker<CleanupJobData, CleanupOperationResult>(
        "data-lifecycle-cleanup",
        async (job) => {
          const entityType = job.data.entityType;
          
          // Acquire distributed lock to prevent concurrent cleanup across instances
          const lockAcquired = await this.acquireCleanupLock(entityType);
          if (!lockAcquired) {
            console.log(
              `[DATA_LIFECYCLE] Skipping ${entityType} - another instance is running cleanup`
            );
            return {
              success: true,
              entityType,
              recordsDeleted: 0,
              duration: 0,
              errors: [],
              details: { skipped: true, reason: "Lock held by another instance" },
            };
          }

          try {
            const strategy = this.strategies.get(entityType);
            if (!strategy) {
              throw new Error(
                `No strategy found for entity type: ${entityType}`
              );
            }

            const result = await strategy.execute(job.data.dryRun || false);
            if (!result.success) {
              throw new Error(result.errors.join("; ") || `${entityType} cleanup failed`);
            }
            return result;
          } finally {
            // Always release lock, even on failure
            await this.releaseCleanupLock(entityType);
          }
        },
        {
          connection: redisConnection,
          concurrency: 1, // Process one cleanup at a time
        }
      );

      // Event handlers
      this.cleanupWorker.on("completed", (job, result) => {
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

      this.cleanupWorker.on("failed", (job, err) => {
        console.error(`[DATA_LIFECYCLE] Job ${job?.id} failed:`, err.message);
      });

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

  private async scheduleCleanup(config: CleanupStrategyConfig): Promise<void> {
    if (!this.cleanupQueue) {
      throw new Error("Cleanup queue not initialized");
    }

    try {
      // Remove existing job if any
      const existingJobs = await this.cleanupQueue.getRepeatableJobs();
      const existingJob = existingJobs.find(
        (job) => job.name === `${config.entityType}-cleanup`
      );

      if (existingJob) {
        await this.cleanupQueue.removeRepeatableByKey(existingJob.key);
      }

      // Schedule new job
      await this.cleanupQueue.add(
        `${config.entityType}-cleanup`,
        {
          entityType: config.entityType,
          scheduledAt: new Date().toISOString(),
          manual: false,
          dryRun: false,
          config,
        },
        {
          jobId: `${config.entityType}-cleanup-recurring`,
          repeat: {
            pattern: config.cronSchedule,
          },
        }
      );
    } catch (error) {
      console.error(
        `[DATA_LIFECYCLE] Failed to schedule ${config.entityType}:`,
        error
      );
      // Don't throw error - continue with other strategies
    }
  }

  /**
   * Acquire a distributed lock for cleanup operation
   * Uses Redis SET NX (only set if not exists) with TTL for safety
   * 
   * @param entityType - The cleanup entity type to lock
   * @param ttlSeconds - Lock TTL (default 1 hour to handle long cleanups)
   * @returns true if lock acquired, false if already held by another instance
   */
  private async acquireCleanupLock(
    entityType: CleanupEntityType,
    ttlSeconds: number = 3600
  ): Promise<boolean> {
    if (!this.redisConnection) {
      console.warn("[DATA_LIFECYCLE] No Redis connection - skipping distributed lock");
      return true; // Allow execution if Redis not available
    }

    const lockKey = `cleanup:${entityType}:lock`;
    try {
      // SET key value EX ttl NX - only sets if key doesn't exist
      const result = await this.redisConnection.set(
        lockKey,
        JSON.stringify({ 
          acquiredAt: new Date().toISOString(),
          pid: process.pid 
        }),
        "EX",
        ttlSeconds,
        "NX"
      );
      
      const acquired = result === "OK";
      if (acquired) {
        console.log(`[DATA_LIFECYCLE] Acquired lock for ${entityType} (TTL: ${ttlSeconds}s)`);
      }
      return acquired;
    } catch (error) {
      console.error(`[DATA_LIFECYCLE] Failed to acquire lock for ${entityType}:`, error);
      return false; // Don't proceed if lock acquisition fails
    }
  }

  /**
   * Release the distributed lock for cleanup operation
   * 
   * @param entityType - The cleanup entity type to unlock
   */
  private async releaseCleanupLock(entityType: CleanupEntityType): Promise<void> {
    if (!this.redisConnection) {
      return;
    }

    const lockKey = `cleanup:${entityType}:lock`;
    try {
      await this.redisConnection.del(lockKey);
      console.log(`[DATA_LIFECYCLE] Released lock for ${entityType}`);
    } catch (error) {
      console.error(`[DATA_LIFECYCLE] Failed to release lock for ${entityType}:`, error);
      // Don't throw - lock will expire via TTL
    }
  }

  async triggerManualCleanup(
    entityType: CleanupEntityType,
    dryRun = false
  ): Promise<CleanupOperationResult> {
    if (!this.cleanupQueue || !this.cleanupQueueEvents) {
      throw new Error("Cleanup queue not initialized");
    }

    const strategy = this.strategies.get(entityType);
    if (!strategy) {
      throw new Error(`No strategy found for entity type: ${entityType}`);
    }

    const job = await this.cleanupQueue.add(
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

    const result = await job.waitUntilFinished(this.cleanupQueueEvents);
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

    if (this.cleanupQueue) {
      const [waiting, active, completed, failed] = await Promise.all([
        this.cleanupQueue.getWaiting(),
        this.cleanupQueue.getActive(),
        this.cleanupQueue.getCompleted(),
        this.cleanupQueue.getFailed(),
      ]);

      queueStatus = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
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
    const promises: Promise<void>[] = [];

    if (this.cleanupWorker) {
      promises.push(this.cleanupWorker.close());
    }

    if (this.cleanupQueue) {
      promises.push(this.cleanupQueue.close());
    }

    if (this.cleanupQueueEvents) {
      promises.push(this.cleanupQueueEvents.close());
    }

    await Promise.all(promises);
  }
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
      cronSchedule: parseCronSchedule(
        process.env.MONITOR_CLEANUP_CRON,
        "0 2 * * *"
      ),
      retentionDays: 30, // Fallback if plan settings unavailable
      batchSize: parseInt(process.env.MONITOR_CLEANUP_BATCH_SIZE || "1000", 10),
      maxRecordsPerRun: parseInt(
        process.env.MONITOR_CLEANUP_SAFETY_LIMIT || "1000000",
        10
      ),
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
      retentionDays: 365,
      batchSize: parseInt(
        process.env.MONITOR_AGGREGATES_CLEANUP_BATCH_SIZE || "1000",
        10
      ),
      maxRecordsPerRun: parseInt(
        process.env.MONITOR_AGGREGATES_CLEANUP_SAFETY_LIMIT || "500000",
        10
      ),
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
      retentionDays: parseInt(process.env.AUDIT_LOGS_RETENTION_DAYS || "90", 10),
      batchSize: parseInt(process.env.AUDIT_LOGS_CLEANUP_BATCH_SIZE || "1000", 10),
      maxRecordsPerRun: parseInt(
        process.env.AUDIT_LOGS_CLEANUP_SAFETY_LIMIT || "100000",
        10
      ),
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
