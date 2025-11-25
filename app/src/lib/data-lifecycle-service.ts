/**
 * Unified Data Lifecycle Management Service
 *
 * Enterprise-grade service for managing data retention, cleanup, and archival
 * across all entities (monitors, jobs, runs, playground, etc.)
 *
 * Key Features:
 * - Pluggable cleanup strategies for different entities
 * - Unified BullMQ queue for all cleanup operations
 * - Comprehensive error handling and retry logic
 * - Detailed metrics and logging
 * - Configurable retention policies
 * - Per-entity cleanup tracking
 * - Dry-run support for testing
 *
 * @module data-lifecycle-service
 */

import { db } from "@/utils/db";
import { monitorResults, runs, reports } from "@/db/schema";
import { sql, and, lt, eq } from "drizzle-orm";
import { Queue, Worker, QueueEvents } from "bullmq";
import type Redis from "ioredis";
import { createS3CleanupService } from "./s3-cleanup";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Supported cleanup entity types
 */
export type CleanupEntityType =
  | "monitor_results"
  | "job_runs"
  | "playground_artifacts"
  | "orphaned_s3_objects";

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
 * - Time-based retention
 * - Status change preservation
 * - Batch processing
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

  async execute(dryRun = false): Promise<CleanupOperationResult> {
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
      details: { cutoffDate: cutoffDate.toISOString(), dryRun },
    };

    try {
      let totalDeleted = 0;
      let iterations = 0;
      const maxIterations = Math.ceil(maxRecords / batchSize);

      while (iterations < maxIterations) {
        if (dryRun) {
          // Just count records
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
          // Actually delete using Drizzle's delete API with subquery
          // Get IDs to delete first
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

          // Delete the records
          const ids = idsToDelete.map((r) => r.id);
          await db.delete(monitorResults).where(
            sql`${monitorResults.id} = ANY(ARRAY[${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `
            )}])`
          );

          const batchDeleted = idsToDelete.length;
          totalDeleted += batchDeleted;

          // Small delay to prevent overwhelming the database
          if (batchDeleted === batchSize) {
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
          } ${totalDeleted} records`
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
}

/**
 * Job Runs Cleanup Strategy
 *
 * Manages retention of runs table with:
 * - Time-based retention
 * - Associated S3 artifacts cleanup
 * - Report table cleanup
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

    const [total, old] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(runs),
      db
        .select({ count: sql<number>`count(*)` })
        .from(runs)
        .where(lt(runs.createdAt, cutoffDate)),
    ]);

    return {
      totalRecords: Number(total[0]?.count || 0),
      oldRecords: Number(old[0]?.count || 0),
    };
  }

  async execute(dryRun = false): Promise<CleanupOperationResult> {
    const startTime = Date.now();
    const cutoffDate = new Date(
      Date.now() - this.config.retentionDays! * 24 * 60 * 60 * 1000
    );
    const batchSize = this.config.batchSize || 100; // Smaller batches for runs (more complex)

    const result: CleanupOperationResult = {
      success: true,
      entityType: this.entityType,
      recordsDeleted: 0,
      s3ObjectsDeleted: 0,
      duration: 0,
      errors: [],
      details: { cutoffDate: cutoffDate.toISOString(), dryRun },
    };

    try {
      // Get old runs
      const oldRuns = await db
        .select({
          id: runs.id,
          artifactPaths: runs.artifactPaths,
        })
        .from(runs)
        .where(lt(runs.createdAt, cutoffDate))
        .limit(batchSize);

      if (oldRuns.length === 0) {
        result.duration = Date.now() - startTime;
        return result;
      }

      if (!dryRun) {
        // Clean up S3 artifacts for each run
        const runIds = oldRuns.map((r) => r.id);

        // Get associated reports
        const associatedReports = await db
          .select()
          .from(reports)
          .where(
            and(
              eq(reports.entityType, "job"),
              sql`${reports.entityId} = ANY(${runIds})`
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

          const s3Result = await this.s3Service.deleteReports(s3DeletionInputs);
          result.s3ObjectsDeleted = s3Result.deletedObjects.length;

          if (!s3Result.success) {
            result.errors.push(
              `S3 cleanup had ${s3Result.failedObjects.length} failures`
            );
          }
        }

        // Delete reports from database
        if (associatedReports.length > 0) {
          await db
            .delete(reports)
            .where(
              and(
                eq(reports.entityType, "job"),
                sql`${reports.entityId} = ANY(${runIds})`
              )
            );
        }

        // Delete runs
        await db.delete(runs).where(sql`${runs.id} = ANY(${runIds})`);

        result.recordsDeleted = oldRuns.length;
      } else {
        result.recordsDeleted = oldRuns.length;
      }

      result.duration = Date.now() - startTime;
      if (result.recordsDeleted > 0) {
        console.log(
          `[DATA_LIFECYCLE] ${this.entityType}: ${
            dryRun ? "Would delete" : "Deleted"
          } ${result.recordsDeleted} runs${
            result.s3ObjectsDeleted
              ? ` and ${result.s3ObjectsDeleted} S3 objects`
              : ""
          }`
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
    } catch (error) {
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
        case "job_runs":
          strategy = new JobRunsCleanupStrategy(config);
          break;
        case "playground_artifacts":
          strategy = new PlaygroundArtifactsCleanupStrategy(config);
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
          console.log(
            `[DATA_LIFECYCLE] Processing cleanup job: ${job.id} for ${job.data.entityType}`
          );

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

      console.log(
        `[DATA_LIFECYCLE] Initialized with ${this.strategies.size} cleanup ${
          this.strategies.size === 1 ? "strategy" : "strategies"
        }`
      );
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
      console.log(
        `[DATA_LIFECYCLE] Scheduling cleanup for ${config.entityType} with cron: "${config.cronSchedule}"`
      );

      // Remove existing job if any
      const existingJobs = await this.cleanupQueue.getRepeatableJobs();
      const existingJob = existingJobs.find(
        (job) => job.name === `${config.entityType}-cleanup`
      );

      if (existingJob) {
        console.log(
          `[DATA_LIFECYCLE] Removing existing job for ${config.entityType}`
        );
        await this.cleanupQueue.removeRepeatableByKey(existingJob.key);
      }

      // Schedule new job
      console.log(
        `[DATA_LIFECYCLE] Adding new repeatable job for ${config.entityType}`
      );
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
      console.log(
        `[DATA_LIFECYCLE] Successfully scheduled cleanup for ${config.entityType}`
      );
    } catch (error) {
      console.error(
        `[DATA_LIFECYCLE] Failed to schedule ${config.entityType}:`,
        error
      );
      // Don't throw error - continue with other strategies but log the failure
      console.warn(
        `[DATA_LIFECYCLE] Continuing initialization despite ${config.entityType} scheduling failure`
      );
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
function parseBooleanEnv(envVar: string | undefined, defaultValue: boolean): boolean {
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
function parseCronSchedule(cronEnv: string | undefined, defaultCron: string): string {
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
    {
      entityType: "monitor_results",
      enabled: parseBooleanEnv(process.env.MONITOR_CLEANUP_ENABLED, true),
      cronSchedule: parseCronSchedule(
        process.env.MONITOR_CLEANUP_CRON,
        "0 2 * * *"
      ),
      retentionDays: parseInt(process.env.MONITOR_RETENTION_DAYS || "30", 10),
      batchSize: parseInt(process.env.MONITOR_CLEANUP_BATCH_SIZE || "1000", 10),
      maxRecordsPerRun: parseInt(
        process.env.MONITOR_CLEANUP_SAFETY_LIMIT || "1000000",
        10
      ),
    },

    // Job Runs Cleanup
    // Disabled by default - only enable when needed for storage management
    {
      entityType: "job_runs",
      enabled: parseBooleanEnv(process.env.JOB_RUNS_CLEANUP_ENABLED, false),
      cronSchedule: parseCronSchedule(
        process.env.JOB_RUNS_CLEANUP_CRON,
        "0 3 * * *"
      ),
      retentionDays: parseInt(process.env.JOB_RUNS_RETENTION_DAYS || "90", 10),
      batchSize: parseInt(process.env.JOB_RUNS_CLEANUP_BATCH_SIZE || "100", 10),
      maxRecordsPerRun: parseInt(
        process.env.JOB_RUNS_CLEANUP_SAFETY_LIMIT || "10000",
        10
      ),
    },

    // Playground Artifacts Cleanup
    // Disabled by default - playground artifacts are temporary by nature
    {
      entityType: "playground_artifacts",
      enabled: parseBooleanEnv(
        process.env.PLAYGROUND_CLEANUP_ENABLED,
        false
      ),
      cronSchedule: parseCronSchedule(
        process.env.PLAYGROUND_CLEANUP_CRON,
        "0 */12 * * *"
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
  ];

  // Validate and log all configured strategies
  console.log(
    `[DATA_LIFECYCLE] Configuring cleanup strategies (${strategies.length} total)`
  );
  for (const config of strategies) {
    console.log(
      `[DATA_LIFECYCLE] ${config.entityType}: enabled=${config.enabled}, cron="${config.cronSchedule}"`
    );

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
