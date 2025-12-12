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
 * - Plus plan: 7 days raw data retention, 30 days aggregated metrics
 * - Pro plan: 30 days raw data retention, 365 days (1 year) aggregated metrics
 * - Unlimited plan: 365 days retention (self-hosted)
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
} from "@/db/schema";
import { sql, and, lt, eq, inArray, isNotNull } from "drizzle-orm";
import { Queue, Worker, QueueEvents } from "bullmq";
import type Redis from "ioredis";
import { createS3CleanupService } from "./s3-cleanup";
import { isPolarEnabled } from "@/lib/feature-flags";
import { monitorAggregationService } from "./monitor-aggregation-service";

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
  | "webhook_idempotency";

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
 * Get retention settings for all organizations based on their subscription plans
 * This enables plan-based data retention (Plus: 30d, Pro: 90d, Unlimited: 365d)
 *
 * @param fallbackRetentionDays - Default retention if plan lookup fails
 * @returns Array of organization retention settings
 */
async function getOrganizationRetentionSettings(
  fallbackRetentionDays: number
): Promise<OrganizationRetention[]> {
  try {
    // In self-hosted mode, use the global retention setting for all orgs
    if (!isPolarEnabled()) {
      const orgs = await db.select({ id: organization.id }).from(organization);

      return orgs.map((org) => ({
        organizationId: org.id,
        retentionDays: fallbackRetentionDays,
        plan: "unlimited",
      }));
    }

    // In cloud mode, fetch each org's plan and corresponding retention
    const orgsWithPlans = await db
      .select({
        organizationId: organization.id,
        subscriptionPlan: organization.subscriptionPlan,
      })
      .from(organization)
      .where(isNotNull(organization.subscriptionPlan));

    // Get all plan limits for lookup
    const plans = await db.select().from(planLimits);
    const planRetentionMap = new Map(
      plans.map((p) => [p.plan, p.dataRetentionDays])
    );

    return orgsWithPlans.map((org) => ({
      organizationId: org.organizationId,
      retentionDays:
        planRetentionMap.get(org.subscriptionPlan!) || fallbackRetentionDays,
      plan: org.subscriptionPlan || "unknown",
    }));
  } catch (error) {
    console.warn(
      "[DATA_LIFECYCLE] Failed to fetch organization retention settings, using fallback:",
      error
    );
    // Return empty array - will fall back to global cleanup
    return [];
  }
}

/**
 * Get aggregated data retention settings for all organizations
 *
 * Returns a list of organization IDs with their aggregated data retention periods
 * based on subscription plans. Used by MonitorAggregatesCleanupStrategy.
 */
async function getOrganizationAggregatedRetentionSettings(
  fallbackAggregatedRetentionDays: number
): Promise<
  Array<{
    organizationId: string;
    aggregatedRetentionDays: number;
    plan: string;
  }>
> {
  try {
    // In self-hosted mode, use the global retention setting for all orgs
    if (!isPolarEnabled()) {
      const orgs = await db.select({ id: organization.id }).from(organization);

      return orgs.map((org) => ({
        organizationId: org.id,
        aggregatedRetentionDays: fallbackAggregatedRetentionDays,
        plan: "unlimited",
      }));
    }

    // In cloud mode, fetch each org's plan and corresponding aggregated retention
    const orgsWithPlans = await db
      .select({
        organizationId: organization.id,
        subscriptionPlan: organization.subscriptionPlan,
      })
      .from(organization)
      .where(isNotNull(organization.subscriptionPlan));

    // Get all plan limits for lookup
    const plans = await db.select().from(planLimits);
    const planAggregatedRetentionMap = new Map(
      plans.map((p) => [p.plan, p.aggregatedDataRetentionDays])
    );

    return orgsWithPlans.map((org) => ({
      organizationId: org.organizationId,
      aggregatedRetentionDays:
        planAggregatedRetentionMap.get(org.subscriptionPlan!) ||
        fallbackAggregatedRetentionDays,
      plan: org.subscriptionPlan || "unknown",
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
 * - Unlimited: 365 days
 */
async function getOrganizationJobRetentionSettings(
  fallbackJobRetentionDays: number
): Promise<
  Array<{
    organizationId: string;
    jobRetentionDays: number;
    plan: string;
  }>
> {
  try {
    // In self-hosted mode, use the global retention setting for all orgs
    if (!isPolarEnabled()) {
      const orgs = await db.select({ id: organization.id }).from(organization);

      return orgs.map((org) => ({
        organizationId: org.id,
        jobRetentionDays: fallbackJobRetentionDays,
        plan: "unlimited",
      }));
    }

    // In cloud mode, fetch each org's plan and corresponding job retention
    const orgsWithPlans = await db
      .select({
        organizationId: organization.id,
        subscriptionPlan: organization.subscriptionPlan,
      })
      .from(organization)
      .where(isNotNull(organization.subscriptionPlan));

    // Get all plan limits for lookup
    const plans = await db.select().from(planLimits);
    const planJobRetentionMap = new Map(
      plans.map((p) => [p.plan, p.jobDataRetentionDays])
    );

    return orgsWithPlans.map((org) => ({
      organizationId: org.organizationId,
      jobRetentionDays:
        planJobRetentionMap.get(org.subscriptionPlan!) ||
        fallbackJobRetentionDays,
      plan: org.subscriptionPlan || "unknown",
    }));
  } catch (error) {
    console.warn(
      "[DATA_LIFECYCLE] Failed to fetch organization job retention settings, using fallback:",
      error
    );
    // Return empty array - will fall back to global cleanup
    return [];
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
 * - Falls back to global retention if plan lookup fails
 *
 * Resource Optimization:
 * - Uses batched deletions (default 1000 records) to minimize DB load
 * - 100ms delay between batches to prevent overwhelming the database
 * - Processes organizations sequentially to avoid resource spikes
 */
export class MonitorResultsCleanupStrategy implements ICleanupStrategy {
  entityType: CleanupEntityType = "monitor_results";
  config: CleanupStrategyConfig;

  constructor(config: CleanupStrategyConfig) {
    this.config = config;
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
      const orgStats: Record<
        string,
        { deleted: number; retentionDays: number }
      > = {};

      // Process each organization with their specific retention period
      for (const orgRetention of orgRetentions) {
        if (totalDeleted >= maxRecords) {
          console.log(
            `[DATA_LIFECYCLE] [monitor_results] Reached max records limit (${maxRecords}), stopping`
          );
          break;
        }

        const cutoffDate = new Date(
          Date.now() - orgRetention.retentionDays * 24 * 60 * 60 * 1000
        );

        let orgDeleted = 0;
        let iterations = 0;
        const maxIterations = Math.ceil(
          (maxRecords - totalDeleted) / batchSize
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
            const countResult = await db
              .select({ count: sql<number>`count(*)` })
              .from(monitorResults)
              .where(
                and(
                  inArray(monitorResults.monitorId, monitorIds),
                  lt(monitorResults.checkedAt, cutoffDate),
                  eq(monitorResults.isStatusChange, false)
                )
              );

            const count = Number(countResult[0]?.count || 0);
            if (count === 0) break;
            orgDeleted += count;
            break; // In dry-run, just count once
          } else {
            // Get IDs to delete for this organization
            const idsToDelete = await db
              .select({ id: monitorResults.id })
              .from(monitorResults)
              .where(
                and(
                  inArray(monitorResults.monitorId, monitorIds),
                  lt(monitorResults.checkedAt, cutoffDate),
                  eq(monitorResults.isStatusChange, false)
                )
              )
              .limit(batchSize);

            if (idsToDelete.length === 0) break;

            // Delete the records
            const ids = idsToDelete.map((r) => r.id);
            await db
              .delete(monitorResults)
              .where(inArray(monitorResults.id, ids));

            orgDeleted += idsToDelete.length;

            // Small delay between batches
            if (idsToDelete.length === batchSize) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }

          iterations++;
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

  /**
   * Fallback global cleanup (original behavior)
   * Used when organization-specific cleanup fails or isn't available
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
      let iterations = 0;
      const maxIterations = Math.ceil(maxRecords / batchSize);

      while (iterations < maxIterations) {
        if (dryRun) {
          const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(monitorResults)
            .where(
              and(
                lt(monitorResults.checkedAt, cutoffDate),
                eq(monitorResults.isStatusChange, false)
              )
            )
            .limit(batchSize);

          const count = Number(countResult[0]?.count || 0);
          if (count === 0) break;
          totalDeleted += count;
        } else {
          const idsToDelete = await db
            .select({ id: monitorResults.id })
            .from(monitorResults)
            .where(
              and(
                lt(monitorResults.checkedAt, cutoffDate),
                eq(monitorResults.isStatusChange, false)
              )
            )
            .limit(batchSize);

          if (idsToDelete.length === 0) break;

          const ids = idsToDelete.map((r) => r.id);
          await db
            .delete(monitorResults)
            .where(inArray(monitorResults.id, ids));

          totalDeleted += idsToDelete.length;

          if (idsToDelete.length === batchSize) {
            await new Promise((resolve) => setTimeout(resolve, 100));
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
 * - Daily aggregates: Kept according to plan (Plus: 30 days, Pro: 365 days, Unlimited: 730 days)
 * - Uses the MonitorAggregationService for actual cleanup
 *
 * Industry Standard (Checkly-inspired):
 * - Plus plan: 30 days aggregated data retention
 * - Pro plan: 365 days (1 year) aggregated data retention
 * - Unlimited plan: 730 days (2 years) aggregated data retention
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
 * - Unlimited: 365 days (self-hosted)
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

  /**
   * Execute cleanup with multi-tenant awareness
   *
   * Strategy:
   * 1. Fetch all organizations with their plan-based job retention settings
   * 2. For each organization, calculate the appropriate cutoff date
   * 3. Delete runs (job + playground) older than the org's retention period
   * 4. Clean up associated S3 artifacts and reports
   */
  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const batchSize = this.config.batchSize || 100;
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
      // Get organization job retention settings (plan-based)
      const orgRetentions = await getOrganizationJobRetentionSettings(
        this.config.retentionDays!
      );

      // If no org-specific settings, fall back to global cleanup
      if (orgRetentions.length === 0) {
        console.log(
          "[DATA_LIFECYCLE] [job_runs] No organization retention settings found, using global fallback"
        );
        return this.executeGlobalCleanup(dryRun);
      }

      let totalDeleted = 0;
      let totalS3Deleted = 0;
      const orgStats: Record<
        string,
        { deleted: number; s3Deleted: number; retentionDays: number }
      > = {};

      // Process each organization with their specific retention period
      for (const orgRetention of orgRetentions) {
        if (totalDeleted >= maxRecords) {
          console.log(
            `[DATA_LIFECYCLE] [job_runs] Reached max records limit (${maxRecords}), stopping`
          );
          break;
        }

        const cutoffDate = new Date(
          Date.now() - orgRetention.jobRetentionDays * 24 * 60 * 60 * 1000
        );

        // Get jobs belonging to this organization
        const jobsInOrg = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.organizationId, orgRetention.organizationId));

        if (jobsInOrg.length === 0) continue;

        const jobIds = jobsInOrg.map((j) => j.id);

        // Get old runs for this organization's jobs
        const oldRuns = await db
          .select({
            id: runs.id,
            jobId: runs.jobId,
            artifactPaths: runs.artifactPaths,
          })
          .from(runs)
          .where(
            and(inArray(runs.jobId, jobIds), lt(runs.createdAt, cutoffDate))
          )
          .limit(Math.min(batchSize, maxRecords - totalDeleted));

        if (oldRuns.length === 0) continue;

        let orgDeleted = 0;
        let orgS3Deleted = 0;

        if (dryRun) {
          // Count records that would be deleted
          const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(runs)
            .where(
              and(inArray(runs.jobId, jobIds), lt(runs.createdAt, cutoffDate))
            );
          orgDeleted = Number(countResult[0]?.count || 0);
        } else {
          const runIds = oldRuns.map((r) => r.id);

          // Get associated reports
          const associatedReports = await db
            .select()
            .from(reports)
            .where(
              and(
                eq(reports.entityType, "job"),
                inArray(reports.entityId, runIds)
              )
            );

          // Delete S3 artifacts
          if (associatedReports.length > 0) {
            const s3DeletionInputs = associatedReports.map((report) => ({
              reportPath: report.reportPath,
              s3Url: report.s3Url || undefined,
              entityId: report.entityId,
              entityType: "job" as const,
            }));

            const s3Result =
              await this.s3Service.deleteReports(s3DeletionInputs);
            orgS3Deleted = s3Result.deletedObjects.length;

            if (!s3Result.success) {
              result.errors.push(
                `S3 cleanup for org ${orgRetention.organizationId} had ${s3Result.failedObjects.length} failures`
              );
            }

            // Delete reports from database
            const reportIds = associatedReports.map((r) => r.id);
            await db.delete(reports).where(inArray(reports.id, reportIds));
          }

          // Delete runs
          await db.delete(runs).where(inArray(runs.id, runIds));
          orgDeleted = oldRuns.length;
        }

        if (orgDeleted > 0) {
          orgStats[orgRetention.organizationId] = {
            deleted: orgDeleted,
            s3Deleted: orgS3Deleted,
            retentionDays: orgRetention.jobRetentionDays,
          };
          totalDeleted += orgDeleted;
          totalS3Deleted += orgS3Deleted;

          console.log(
            `[DATA_LIFECYCLE] [job_runs] Org ${orgRetention.organizationId} (${orgRetention.plan}): ` +
              `${dryRun ? "Would delete" : "Deleted"} ${orgDeleted} runs (retention: ${orgRetention.jobRetentionDays}d)`
          );
        }

        // Small delay between orgs to prevent resource spikes
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      result.recordsDeleted = totalDeleted;
      result.s3ObjectsDeleted = totalS3Deleted;
      result.details.organizationsProcessed = Object.keys(orgStats).length;
      result.details.orgStats = orgStats;

      // Also clean up playground runs (not tied to organizations)
      // Use the minimum retention period for playground cleanup
      const playgroundResult = await this.cleanupPlaygroundRuns(
        dryRun,
        batchSize
      );
      result.recordsDeleted += playgroundResult.deleted;
      result.s3ObjectsDeleted += playgroundResult.s3Deleted;
      result.details.playgroundRunsDeleted = playgroundResult.deleted;

      result.duration = Date.now() - startTime;
      console.log(
        `[DATA_LIFECYCLE] [job_runs] Cleanup complete: ${result.recordsDeleted} runs, ${result.s3ObjectsDeleted} S3 objects`
      );
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      result.duration = Date.now() - startTime;
      console.error(`[DATA_LIFECYCLE] [job_runs] Cleanup failed:`, error);
    }

    return result;
  }

  /**
   * Global cleanup fallback (for self-hosted or when org settings unavailable)
   */
  private async executeGlobalCleanup(
    dryRun: boolean
  ): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const cutoffDate = new Date(
      Date.now() - this.config.retentionDays! * 24 * 60 * 60 * 1000
    );
    const batchSize = this.config.batchSize || 100;

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
      const oldRuns = await db
        .select({
          id: runs.id,
          jobId: runs.jobId,
          artifactPaths: runs.artifactPaths,
        })
        .from(runs)
        .where(lt(runs.createdAt, cutoffDate))
        .limit(batchSize);

      if (oldRuns.length === 0) {
        result.duration = Date.now() - startTime;
        return result;
      }

      const jobRunsList = oldRuns.filter((r) => r.jobId !== null);
      const playgroundRunsList = oldRuns.filter((r) => r.jobId === null);

      if (!dryRun) {
        const runIds = oldRuns.map((r) => r.id);

        // Get and delete associated reports
        const associatedReports = await db
          .select()
          .from(reports)
          .where(
            and(
              eq(reports.entityType, "job"),
              inArray(reports.entityId, runIds)
            )
          );

        if (associatedReports.length > 0) {
          const s3DeletionInputs = associatedReports.map((report) => ({
            reportPath: report.reportPath,
            s3Url: report.s3Url || undefined,
            entityId: report.entityId,
            entityType: "job" as const,
          }));

          const s3Result = await this.s3Service.deleteReports(s3DeletionInputs);
          result.s3ObjectsDeleted = s3Result.deletedObjects.length;

          const reportIds = associatedReports.map((r) => r.id);
          await db.delete(reports).where(inArray(reports.id, reportIds));
        }

        await db.delete(runs).where(inArray(runs.id, runIds));
        result.recordsDeleted = oldRuns.length;
      } else {
        result.recordsDeleted = oldRuns.length;
      }

      result.details.jobRunsDeleted = jobRunsList.length;
      result.details.playgroundRunsDeleted = playgroundRunsList.length;
      result.duration = Date.now() - startTime;

      if (result.recordsDeleted > 0) {
        console.log(
          `[DATA_LIFECYCLE] [job_runs] Global cleanup: ${dryRun ? "Would delete" : "Deleted"} ${result.recordsDeleted} runs`
        );
      }
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  /**
   * Clean up playground runs (not tied to organizations)
   * Uses 1-day retention (ephemeral by design)
   */
  private async cleanupPlaygroundRuns(
    dryRun: boolean,
    batchSize: number
  ): Promise<{ deleted: number; s3Deleted: number }> {
    const playgroundRetentionDays = 1; // Playground runs are ephemeral, 1-day retention
    const cutoffDate = new Date(
      Date.now() - playgroundRetentionDays * 24 * 60 * 60 * 1000
    );

    try {
      // Get old playground runs (jobId is null)
      const oldPlaygroundRuns = await db
        .select({
          id: runs.id,
          artifactPaths: runs.artifactPaths,
        })
        .from(runs)
        .where(and(sql`${runs.jobId} IS NULL`, lt(runs.createdAt, cutoffDate)))
        .limit(batchSize);

      if (oldPlaygroundRuns.length === 0) {
        return { deleted: 0, s3Deleted: 0 };
      }

      if (dryRun) {
        return { deleted: oldPlaygroundRuns.length, s3Deleted: 0 };
      }

      const runIds = oldPlaygroundRuns.map((r) => r.id);
      let s3Deleted = 0;

      // Get and delete associated reports
      const associatedReports = await db
        .select()
        .from(reports)
        .where(
          and(eq(reports.entityType, "job"), inArray(reports.entityId, runIds))
        );

      if (associatedReports.length > 0) {
        const s3DeletionInputs = associatedReports.map((report) => ({
          reportPath: report.reportPath,
          s3Url: report.s3Url || undefined,
          entityId: report.entityId,
          entityType: "job" as const,
        }));

        const s3Result = await this.s3Service.deleteReports(s3DeletionInputs);
        s3Deleted = s3Result.deletedObjects.length;

        const reportIds = associatedReports.map((r) => r.id);
        await db.delete(reports).where(inArray(reports.id, reportIds));
      }

      await db.delete(runs).where(inArray(runs.id, runIds));

      console.log(
        `[DATA_LIFECYCLE] [job_runs] Playground cleanup: Deleted ${oldPlaygroundRuns.length} playground runs`
      );

      return { deleted: oldPlaygroundRuns.length, s3Deleted };
    } catch (error) {
      console.error(
        "[DATA_LIFECYCLE] [job_runs] Playground cleanup failed:",
        error
      );
      return { deleted: 0, s3Deleted: 0 };
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

  /**
   * Check if S3 is available and bucket exists
   * Returns false if bucket doesn't exist (not an error, just not configured yet)
   */
  private async checkS3Available(): Promise<boolean> {
    const bucketName = String(
      this.config.customConfig?.bucketName || "playwright-test-artifacts"
    );

    try {
      const { S3Client, HeadBucketCommand } = await import(
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

      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
      return true;
    } catch (error: unknown) {
      const err = error as {
        $metadata?: { httpStatusCode?: number };
        Code?: string;
        message?: string;
      };
      if (
        err?.$metadata?.httpStatusCode === 404 ||
        err?.Code === "NoSuchBucket"
      ) {
        // Bucket doesn't exist - this is expected if S3 isn't set up yet
        return false;
      }
      // Other errors (network, auth, etc.) - log but don't fail
      console.warn(
        `[DATA_LIFECYCLE] [playground_artifacts] S3 health check failed:`,
        err?.message || String(error)
      );
      return false;
    }
  }

  async getStats(): Promise<{ totalRecords: number; oldRecords: number }> {
    // Check if S3 is available before attempting stats collection
    const isAvailable = await this.checkS3Available();
    if (!isAvailable) {
      return { totalRecords: 0, oldRecords: 0 };
    }

    const maxAgeHours = Number(this.config.customConfig?.maxAgeHours || 24);
    const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;
    const bucketName = String(
      this.config.customConfig?.bucketName || "playwright-test-artifacts"
    );

    try {
      const { S3Client, ListObjectsV2Command } = await import(
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

      let totalObjects = 0;
      let oldObjects = 0;
      let continuationToken: string | undefined;

      do {
        const response = await s3Client.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          })
        );

        if (response.Contents) {
          totalObjects += response.Contents.length;

          for (const obj of response.Contents) {
            if (obj.LastModified && obj.LastModified.getTime() < cutoffTime) {
              oldObjects++;
            }
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      return { totalRecords: totalObjects, oldRecords: oldObjects };
    } catch (error: unknown) {
      const err = error as {
        $metadata?: { httpStatusCode?: number };
        Code?: string;
      };
      // Handle NoSuchBucket error gracefully - this is expected if S3 isn't set up yet
      if (
        err?.$metadata?.httpStatusCode === 404 ||
        err?.Code === "NoSuchBucket"
      ) {
        console.warn(
          `[DATA_LIFECYCLE] [playground_artifacts] S3 bucket '${bucketName}' does not exist. Skipping stats collection.`
        );
        return { totalRecords: 0, oldRecords: 0 };
      }

      console.error(
        "[DATA_LIFECYCLE] [playground_artifacts] Failed to get stats:",
        error
      );
      return { totalRecords: 0, oldRecords: 0 };
    }
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const maxAgeHours = Number(this.config.customConfig?.maxAgeHours || 24);
    const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;
    const bucketName = String(
      this.config.customConfig?.bucketName || "playwright-test-artifacts"
    );

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      s3ObjectsDeleted: 0,
      duration: 0,
      errors: [],
      details: {
        cutoffTime: new Date(cutoffTime).toISOString(),
        bucketName,
        dryRun,
      },
    };

    // Check if S3 is available before attempting cleanup
    const isAvailable = await this.checkS3Available();
    if (!isAvailable) {
      result.duration = Date.now() - startTime;
      result.details = {
        ...result.details,
        skipped: true,
        reason: "S3 bucket not available",
      };
      return result;
    }

    try {
      // List old objects
      const objectsToDelete: Array<{ key: string; lastModified: Date }> = [];

      const { S3Client, ListObjectsV2Command } = await import(
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

      let continuationToken: string | undefined;

      do {
        const response = await s3Client.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          })
        );

        if (response.Contents) {
          for (const obj of response.Contents) {
            if (obj.Key && obj.LastModified) {
              const lastModifiedTime = obj.LastModified.getTime();

              if (lastModifiedTime < cutoffTime) {
                objectsToDelete.push({
                  key: obj.Key,
                  lastModified: obj.LastModified,
                });
              }
            }
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      if (objectsToDelete.length === 0) {
        result.duration = Date.now() - startTime;
        return result;
      }

      if (!dryRun) {
        const deletionInputs = objectsToDelete.map((obj) => ({
          reportPath: obj.key,
          entityId: obj.key.split("/")[0] || "unknown",
          entityType: "test" as const,
        }));

        const s3Result = await this.s3Service.deleteReports(deletionInputs);
        result.s3ObjectsDeleted = s3Result.deletedObjects.length;

        if (!s3Result.success) {
          result.success = false;
          result.errors.push(
            `S3 cleanup had ${s3Result.failedObjects.length} failures`
          );
        }
      } else {
        result.s3ObjectsDeleted = objectsToDelete.length;
      }

      result.duration = Date.now() - startTime;
      if (result.s3ObjectsDeleted && result.s3ObjectsDeleted > 0) {
        console.log(
          `[DATA_LIFECYCLE] ${this.entityType}: ${
            dryRun ? "Would delete" : "Deleted"
          } ${result.s3ObjectsDeleted} S3 objects`
        );
      }
    } catch (error: unknown) {
      const err = error as {
        $metadata?: { httpStatusCode?: number };
        Code?: string;
      };
      result.success = false;
      result.duration = Date.now() - startTime;

      // Handle NoSuchBucket error gracefully - this is expected if S3 isn't set up yet
      if (
        err?.$metadata?.httpStatusCode === 404 ||
        err?.Code === "NoSuchBucket"
      ) {
        console.warn(
          `[DATA_LIFECYCLE] [${this.entityType}] S3 bucket '${bucketName}' does not exist. Skipping cleanup.`
        );
        result.errors.push(`S3 bucket '${bucketName}' does not exist`);
        // Mark as success since missing bucket is not a failure condition
        result.success = true;
      } else {
        result.errors.push(
          error instanceof Error ? error.message : String(error)
        );
        console.error(
          `[DATA_LIFECYCLE] [${this.entityType}] Cleanup failed:`,
          error
        );
      }
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
          // Just count expired records
          const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(webhookIdempotency)
            .where(lt(webhookIdempotency.expiresAt, now))
            .limit(batchSize);

          const count = Number(countResult[0]?.count || 0);
          if (count === 0) break;
          totalDeleted += count;
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

      // Create worker
      this.cleanupWorker = new Worker<CleanupJobData, CleanupOperationResult>(
        "data-lifecycle-cleanup",
        async (job) => {
          const strategy = this.strategies.get(job.data.entityType);
          if (!strategy) {
            throw new Error(
              `No strategy found for entity type: ${job.data.entityType}`
            );
          }

          return await strategy.execute(job.data.dryRun || false);
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
