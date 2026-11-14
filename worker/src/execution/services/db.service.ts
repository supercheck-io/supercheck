import { canPersistRunCallback } from './run-callback';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { liveJob, liveRunOfLiveJob } from '../../db/deletion-visibility';
import * as schema from '../../db/schema'; // Import the schema we copied
import {
  reports,
  jobs,
  runs,
  JobStatus,
  TestRunStatus,
  alertHistory,
  AlertDeliveryMetadata,
  AlertType,
  AlertStatus,
} from '../../db/schema'; // Specifically import reports table
import {
  eq,
  and,
  or,
  ne,
  isNull,
  not,
  sql,
  desc,
  inArray,
  type SQL,
} from 'drizzle-orm';
import { ReportMetadata } from '../interfaces'; // Import our interface
import { NotificationProvider } from '../../notification/notification.service';
import { decryptNotificationProviderConfig } from '../../common/notification-provider-crypto';
import { DB_PROVIDER_TOKEN } from '../../db/db.constants';
import type { ExecutionUsageTransaction } from './execution-usage-receipts';
import { RUN_CANCELLATION_MARKER } from '../../common/services/cancellation.service';

// Re-export from canonical location for backward compatibility.
// All new code should import directly from '../../db/db.constants'.
export { DB_PROVIDER_TOKEN };

@Injectable()
export class DbService implements OnModuleInit {
  private readonly logger = new Logger(DbService.name);

  constructor(
    @Inject(DB_PROVIDER_TOKEN)
    private dbInstance: PostgresJsDatabase<typeof schema>,
    private configService: ConfigService,
  ) {
    this.logger.log('Drizzle ORM initialized.');
  }

  onModuleInit() {
    // Optional: Test connection on startup
    try {
      this.dbInstance.select({ now: sql`now()` });
      this.logger.log('Database connection successful.');
    } catch (error) {
      const errorToLog =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error('Database connection failed!', errorToLog);
    }
  }

  get db(): PostgresJsDatabase<typeof schema> {
    return this.dbInstance;
  }

  /**
   * Stores or updates report metadata in the database.
   * Adapt based on ReportMetadata interface.
   */
  async storeReportMetadata(metadata: ReportMetadata): Promise<void> {
    const { entityId, entityType, reportPath, status, s3Url } = metadata;
    this.logger.debug(
      `Storing report metadata for ${entityType}/${entityId} with status ${status}`,
    );

    try {
      await this.db.transaction(async (tx) => {
        if (!(await canPersistRunCallback(tx))) return;

        for (const id of new Set(
          [entityId, metadata.aliasEntityId].filter((id): id is string => !!id),
        )) {
          await tx
            .insert(reports)
            .values({
              entityId: id,
              entityType,
              reportPath,
              status,
              s3Url,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [reports.entityType, reports.entityId],
              set: { reportPath, status, s3Url, updatedAt: new Date() },
            });
        }
      });
    } catch (error) {
      this.logger.error(
        `Error storing report metadata for ${entityType}/${entityId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Decide whether to re-throw or just log
      // throw error;
    }
  }

  /**
   * Updates the status of a job in the jobs table
   * @param jobId The ID of the job to update
   * @param runStatuses Array of run statuses for the job
   */
  async updateJobStatus(
    jobId: string,
    runStatuses: (
      | 'pending'
      | 'running'
      | 'passed'
      | 'failed'
      | 'error'
      | 'queued'
      | 'blocked'
    )[],
  ): Promise<void> {
    try {
      // Determine the aggregate job status
      let jobStatus: JobStatus;
      if (runStatuses.some((s) => s === 'error')) {
        jobStatus = 'error';
      } else if (runStatuses.some((s) => s === 'failed')) {
        jobStatus = 'failed';
      } else if (
        runStatuses.some(
          (s) =>
            s === 'running' ||
            s === 'pending' ||
            s === 'queued' ||
            s === 'blocked',
        )
      ) {
        jobStatus = 'running';
      } else if (
        runStatuses.length > 0 &&
        runStatuses.every((s) => s === 'passed')
      ) {
        jobStatus = 'passed';
      } else {
        // No runs or unrecognized statuses — treat as running to avoid premature resolution
        jobStatus = 'running';
      }

      this.logger.log(
        `Updating job ${jobId} status based on ${runStatuses.length} runs. Final status: ${jobStatus}`,
      );
      await this.db
        .update(jobs)
        .set({
          status: jobStatus,
        })
        .where(eq(jobs.id, jobId));
    } catch (error) {
      this.logger.error(`Failed to update job status for ${jobId}:`, error);
    }
  }

  /**
   * Updates the status and duration of a run in the runs table
   * @param runId The ID of the run to update
   * @param status The new status to set
   * @param duration The duration of the run (string like "3s" or "1m 30s")
   * @param errorDetails Optional error details to store
   */
  async updateRunStatus(
    runId: string,
    status: TestRunStatus,
    duration?: string,
    errorDetails?: string,
    transaction?: ExecutionUsageTransaction,
  ): Promise<void> {
    this.logger.debug(
      `Updating run ${runId} with status ${status} and duration ${duration}`,
    );

    try {
      const now = new Date();
      const database = transaction ?? this.dbInstance;
      const updateData: {
        status: TestRunStatus;
        durationMs?: number;
        completedAt?: Date;
        startedAt?: Date;
        errorDetails?: string | null | SQL;
        artifactPaths?: any;
      } = {
        status,
      };

      // Add duration if provided - convert string duration to milliseconds
      if (duration) {
        let durationSeconds = 0;

        if (duration.includes('m')) {
          // Format like "1m 30s"
          const minutes = parseInt(duration.split('m')[0].trim(), 10) || 0;
          const secondsMatch = duration.match(/(\d+)s/);
          const seconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;
          durationSeconds = minutes * 60 + seconds;
        } else {
          // Format like "45s" or just number
          const secondsMatch =
            duration.match(/(\d+)s/) || duration.match(/^(\d+)$/);
          durationSeconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;
        }

        // Store duration in milliseconds only
        updateData.durationMs = durationSeconds * 1000;
      }

      // Add completedAt timestamp for terminal statuses
      if (['failed', 'passed', 'error'].includes(status)) {
        updateData.completedAt = now;

        // If no duration provided, calculate from startedAt
        if (!duration) {
          try {
            const existingRun = await database
              .select({ startedAt: runs.startedAt })
              .from(runs)
              .where(eq(runs.id, runId))
              .limit(1);

            if (existingRun.length > 0 && existingRun[0].startedAt) {
              const durationMs =
                now.getTime() - existingRun[0].startedAt.getTime();
              updateData.durationMs = durationMs;
            }
          } catch (e) {
            this.logger.warn(
              `Could not calculate duration for run ${runId}: ${e}`,
            );
          }
        }
      }

      // Add error details if provided
      if (errorDetails) {
        updateData.errorDetails = errorDetails;
      } else if (status === 'passed' || status === 'failed') {
        // Completion wins a late-cancel race: drop a stale cancellation marker from a finished run, and
        // only that marker (any other recorded detail stays).
        updateData.errorDetails = sql`CASE WHEN ${runs.errorDetails} = ${RUN_CANCELLATION_MARKER} THEN NULL ELSE ${runs.errorDetails} END`;
      }

      // Update the database
      await database
        .update(runs)
        .set(updateData)
        .where(
          and(eq(runs.id, runId), inArray(runs.status, ['queued', 'running'])),
        );

      this.logger.log(
        `Successfully updated run ${runId} with status ${status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update run status: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /** Merges keys into runs.metadata without clobbering what else is stored there. */
  async mergeRunMetadata(
    runId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.dbInstance
      .update(runs)
      .set({
        metadata: sql`coalesce(${runs.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::text::jsonb`,
      })
      .where(eq(runs.id, runId));
  }

  /**
   * Gets a job by ID including alert configuration with RBAC filtering
   * @param jobId The ID of the job to retrieve
   * @param organizationId The organization ID for RBAC filtering
   * @param projectId The project ID for RBAC filtering
   */
  async getJobById(
    jobId: string,
    organizationId?: string,
    projectId?: string,
  ): Promise<any> {
    try {
      // Build where condition with RBAC filtering if context is provided
      const whereConditions = [eq(schema.jobs.id, jobId), liveJob()];

      if (organizationId) {
        whereConditions.push(eq(schema.jobs.organizationId, organizationId));
      }
      if (projectId) {
        whereConditions.push(eq(schema.jobs.projectId, projectId));
      }

      const job = await this.db.query.jobs.findFirst({
        where:
          whereConditions.length > 1
            ? and(...whereConditions)
            : whereConditions[0],
      });

      if (!job && (organizationId || projectId)) {
        this.logger.warn(
          `Job ${jobId} not found or access denied for organization ${organizationId}, project ${projectId}`,
        );
        return null;
      }

      // A job being deleted reads as missing: callers skip alerts and bookkeeping for it.
      return job ?? null;
    } catch (error) {
      this.logger.error(
        `Failed to get job ${jobId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /** True once the job's delete request has committed (the job is flagged); false on a lookup error. */
  async isJobDeleting(jobId: string | null | undefined): Promise<boolean> {
    if (!jobId) return false;
    try {
      const [row] = await this.db
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(and(eq(schema.jobs.id, jobId), not(liveJob())))
        .limit(1);
      return !!row;
    } catch (error) {
      this.logger.warn(
        `Could not check deletion state of job ${jobId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Gets the last run for a job
   * @param jobId The ID of the job to get the last run for
   */
  async getLastRunForJob(jobId: string): Promise<any> {
    try {
      const lastRun = await this.db.query.runs.findFirst({
        where: eq(schema.runs.jobId, jobId),
        orderBy: [desc(schema.runs.completedAt)],
      });
      return lastRun;
    } catch (error) {
      this.logger.error(
        `Failed to get last run for job ${jobId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Gets project information by ID
   * @param projectId The project ID
   */
  async getProjectById(
    projectId: string,
  ): Promise<{ id: string; name: string; organizationId: string } | null> {
    try {
      const project = await this.db.query.projects.findFirst({
        where: eq(schema.projects.id, projectId),
        columns: { id: true, name: true, organizationId: true },
      });
      return project ?? null;
    } catch (error) {
      this.logger.error(
        `Failed to get project ${projectId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Gets notification providers by IDs with RBAC filtering
   * @param providerIds Array of provider IDs
   * @param organizationId The organization ID for RBAC filtering
   * @param projectId The project ID for RBAC filtering
   */
  async getNotificationProviders(
    providerIds: string[],
    organizationId?: string,
    projectId?: string,
  ): Promise<NotificationProvider[]> {
    try {
      if (!providerIds || providerIds.length === 0) {
        return [];
      }

      // Build where conditions with RBAC filtering
      const conditions: SQL[] = [
        inArray(schema.notificationProviders.id, providerIds),
        eq(schema.notificationProviders.isEnabled, true),
      ];

      if (organizationId) {
        conditions.push(
          eq(schema.notificationProviders.organizationId, organizationId),
        );
      }
      if (projectId) {
        conditions.push(eq(schema.notificationProviders.projectId, projectId));
      }

      const providers = await this.db.query.notificationProviders.findMany({
        where: and(...conditions),
      });

      this.logger.debug(
        `Found ${providers?.length || 0} notification providers for org ${organizationId}, project ${projectId}`,
      );

      // Map the database result to NotificationProvider interface
      return (providers || []).map((provider) => ({
        id: provider.id,
        type: provider.type,
        config: decryptNotificationProviderConfig(
          provider.config,
          provider.projectId ?? undefined,
        ),
      }));
    } catch (error) {
      this.logger.error(
        `Failed to get notification providers: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Saves an alert history record to the database
   */
  async saveAlertHistory(
    jobId: string,
    type: AlertType,
    provider: string,
    status: AlertStatus,
    message: string,
    errorMessage?: string,
    jobNameOverride?: string,
    deliveryMetadata?: AlertDeliveryMetadata,
    id?: string,
    runId?: string,
  ): Promise<{ id: string; status: AlertStatus }> {
    try {
      let jobName = jobNameOverride;

      if (!jobName) {
        // Get the actual job name - no need for RBAC filtering here since we're just getting the name
        const job = (await this.getJobById(jobId)) as { name?: string } | null;
        jobName = job?.name || `Job ${jobId}`;
      }

      const [created] = await this.db
        .insert(alertHistory)
        .values({
          ...(id ? { id } : {}),
          jobId,
          runId,
          type,
          provider,
          status,
          message,
          sentAt: new Date(),
          errorMessage,
          deliveryMetadata,
          target: jobName,
          targetType: 'job',
        })
        // A caller-supplied id makes a retry after a lost acknowledgement a no-op.
        .onConflictDoNothing()
        .returning({ id: alertHistory.id, status: alertHistory.status });

      this.logger.log(
        `Successfully saved alert history for job ${jobId} with status: ${status}`,
      );
      return created ?? { id: id as string, status };
    } catch (error) {
      this.logger.error(
        `Failed to save alert history for job ${jobId}:`,
        error,
      );
      throw new Error('Internal Server Error');
    }
  }

  /**
   * Get recent runs for a job to check alert thresholds
   */
  async getRecentRunsForJob(jobId: string, limit: number = 5) {
    try {
      const runs = await this.db
        .select({
          id: schema.runs.id,
          status: schema.runs.status,
          errorDetails: schema.runs.errorDetails,
          createdAt: schema.runs.createdAt,
          completedAt: schema.runs.completedAt,
        })
        .from(schema.runs)
        .where(
          and(
            eq(schema.runs.jobId, jobId),
            // A user-cancelled run is neither a failure nor a pass for streaks.
            or(
              isNull(schema.runs.errorDetails),
              ne(schema.runs.errorDetails, RUN_CANCELLATION_MARKER),
            ),
            inArray(sql<string>`${schema.runs.status}`, [
              'passed',
              'failed',
              'error',
              'blocked',
              'skipped',
            ]),
          ),
        )
        .orderBy(desc(schema.runs.createdAt), desc(schema.runs.id))
        .limit(limit);

      return runs;
    } catch (error) {
      this.logger.error(
        `Failed to get recent runs for job ${jobId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Failure alerts actually delivered since the job's current failing streak began (its last non-failing run).
   * One alert fans out to a row per provider, so the count is the busiest provider's, not the row total.
   */
  /**
   * Paging channels with an open page for this job: their newest job alert row is a delivered failure or
   * timeout (a delivered success means it was already resolved).
   */
  async getOpenJobPages(
    jobId: string,
    providerIds: string[],
  ): Promise<Set<string>> {
    if (providerIds.length === 0) return new Set();
    try {
      const rows = await this.db
        .selectDistinctOn([schema.alertHistory.provider], {
          provider: schema.alertHistory.provider,
          type: schema.alertHistory.type,
          status: schema.alertHistory.status,
        })
        .from(schema.alertHistory)
        .where(
          and(
            eq(schema.alertHistory.jobId, jobId),
            inArray(schema.alertHistory.provider, providerIds),
            inArray(schema.alertHistory.type, [
              'job_failed',
              'job_timeout',
              'job_success',
            ]),
            eq(schema.alertHistory.status, 'sent'),
          ),
        )
        .orderBy(
          schema.alertHistory.provider,
          desc(schema.alertHistory.sentAt),
        );
      return new Set(
        rows
          .filter((row) => row.type !== 'job_success')
          .map((row) => row.provider),
      );
    } catch (error) {
      // Unknown history: no resolve (a stray resolve is harmless, but a lookup failure must not throw here).
      this.logger.error(
        `Failed to read open pages for job ${jobId}: ${(error as Error).message}`,
      );
      return new Set();
    }
  }

  async getJobAlertStreakState(
    jobId: string,
  ): Promise<{ sent: number; lastSentAt: Date | null; unknown?: boolean }> {
    try {
      return await this.queryJobAlertStreak(jobId, this.db);
    } catch (error) {
      // Unknown history must not silence a failing job, nor alert on every run: flag it so the caller
      // falls back to the positional rule.
      this.logger.error(
        `Failed to read alert history for job ${jobId}: ${(error as Error).message}`,
      );
      return { sent: 0, lastSentAt: null, unknown: true };
    }
  }

  // 'pending' counts: a slot reserved by a process that died before sending is treated as an alert, so a
  // crash can cost one alert but never add one.
  private async queryJobAlertStreak(
    jobId: string,
    database: Pick<typeof this.db, 'select'>,
    excludeRunId?: string,
  ): Promise<{ sent: number; lastSentAt: Date | null }> {
    // The cutoff is a subquery so the count sees one snapshot. It is when the last non-failing run finished
    // (creation time while unfinished), so an alert for an earlier failure delivered after that run was
    // created still belongs to the old streak.
    const since = database
      .select({
        at: sql<Date | null>`max(coalesce(${runs.completedAt}, ${runs.createdAt}))`,
      })
      .from(runs)
      .where(
        and(
          eq(runs.jobId, jobId),
          inArray(sql<string>`${runs.status}`, [
            'passed',
            'blocked',
            'skipped',
          ]),
        ),
      );
    const perProvider = await database
      .select({
        sent: sql<number>`count(*)::int`,
        lastSentAt: sql<Date>`max(${alertHistory.sentAt})`,
      })
      .from(alertHistory)
      .where(
        and(
          eq(alertHistory.jobId, jobId),
          inArray(sql<string>`${alertHistory.status}`, ['sent', 'pending']),
          inArray(sql<string>`${alertHistory.type}`, [
            'job_failed',
            'job_timeout',
          ]),
          sql`${alertHistory.sentAt} > coalesce((${since}), '-infinity'::timestamptz)`,
          // A re-driven run is judged as if it had not alerted, so its failed provider can be reclaimed.
          excludeRunId
            ? sql`${alertHistory.runId} IS DISTINCT FROM ${excludeRunId}`
            : undefined,
        ),
      )
      .groupBy(alertHistory.provider);
    return {
      sent: Math.max(0, ...perProvider.map((row) => row.sent)),
      lastSentAt: perProvider.reduce<Date | null>((latest, row) => {
        const at = new Date(row.lastSentAt);
        return !latest || at > latest ? at : latest;
      }, null),
    };
  }

  /**
   * Reserves the failure-alert slot for (job, run, provider) before anything is sent. Under a per-job lock it
   * re-reads the streak, asks `shouldAlert` whether this alert is still allowed, and inserts a 'pending' row
   * per provider. A provider whose row already exists for this run (sent, or reserved by another attempt) is
   * not returned; only a 'failed' row is reclaimed. Returns provider id -> alert row id for the claimed ones.
   * Throws when the database cannot be used, so the caller decides whether to send unreserved.
   */
  async claimJobAlertSlots(input: {
    jobId: string;
    runId: string;
    type: 'job_failed' | 'job_timeout';
    providerIds: string[];
    message: string;
    jobName: string;
    shouldAlert: (state: { sent: number; lastSentAt: Date | null }) => boolean;
  }): Promise<Map<string, string>> {
    const { jobId, runId, type, providerIds, message, jobName } = input;
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`job-alert:${jobId}`}, 0))`,
      );
      if (
        !input.shouldAlert(await this.queryJobAlertStreak(jobId, tx, runId))
      ) {
        return new Map<string, string>();
      }
      const claimed = await tx
        .insert(alertHistory)
        .values(
          providerIds.map((provider) => ({
            jobId,
            runId,
            type,
            provider,
            status: 'pending' as const,
            message,
            sentAt: new Date(),
            target: jobName,
            targetType: 'job',
          })),
        )
        .onConflictDoUpdate({
          target: [
            alertHistory.jobId,
            alertHistory.runId,
            alertHistory.provider,
          ],
          targetWhere: sql`${alertHistory.type} IN ('job_failed', 'job_timeout') AND ${alertHistory.runId} IS NOT NULL`,
          set: {
            status: 'pending',
            sentAt: new Date(),
            message,
            errorMessage: null,
            deliveryMetadata: null,
          },
          // A 401/403 (terminal) failure is never reclaimed: the key is wrong until someone fixes it.
          setWhere: sql`${alertHistory.status} = 'failed' AND coalesce((${alertHistory.deliveryMetadata} -> 'delivery' ->> 'terminal')::boolean, false) = false`,
        })
        .returning({ id: alertHistory.id, provider: alertHistory.provider });
      return new Map(claimed.map((row) => [row.provider, row.id]));
    });
  }

  /** Records the delivery outcome on a row reserved by claimJobAlertSlots. */
  async finishJobAlert(
    id: string,
    status: AlertStatus,
    errorMessage?: string,
    deliveryMetadata?: AlertDeliveryMetadata,
  ): Promise<void> {
    await this.db
      .update(alertHistory)
      .set({
        status,
        errorMessage: errorMessage ?? null,
        deliveryMetadata: deliveryMetadata ?? null,
      })
      .where(eq(alertHistory.id, id));
  }

  /**
   * A run of an organization that is pending deletion (or of a deleted project) must not start. Marks it cancelled so the
   * claim below refuses it and the caller finalizes it. A DB predicate, not a cache: this admits work, and a stale
   * "pending" would otherwise cancel a run of an organization whose deletion was just cancelled.
   */
  private async cancelRunOfPendingTenant(runId: string): Promise<void> {
    await this.db
      .update(runs)
      .set({ errorDetails: RUN_CANCELLATION_MARKER })
      .where(
        and(
          eq(runs.id, runId),
          inArray(runs.status, ['queued', 'running']),
          sql`EXISTS (SELECT 1 FROM projects p JOIN organization o ON o.id = p.organization_id WHERE p.id = ${runs.projectId} AND (o.deletion_requested_at IS NOT NULL OR p.status = 'deleted'))`,
        ),
      );
  }

  async claimRunExecution(runId: string): Promise<boolean> {
    await this.cancelRunOfPendingTenant(runId);
    const [claimed] = await this.db
      .update(runs)
      .set({
        status: 'running',
        startedAt: sql`coalesce(${runs.startedAt}, now())`,
      })
      .where(
        and(
          eq(runs.id, runId),
          inArray(runs.status, ['queued', 'running']),
          or(
            isNull(runs.errorDetails),
            ne(runs.errorDetails, RUN_CANCELLATION_MARKER),
          ),
        ),
      )
      .returning({ id: runs.id });
    return !!claimed;
  }

  /**
   * Finalize a run whose cancellation was requested before any execution started. The caller has
   * already ruled out a live execution; the marker comparison keeps this from touching a run that
   * finished normally.
   */
  async finalizeCancelledRun(runId: string): Promise<boolean> {
    const [finalized] = await this.db
      .update(runs)
      .set({ status: 'error', completedAt: new Date() })
      .where(
        and(
          eq(runs.id, runId),
          inArray(runs.status, ['queued', 'running']),
          eq(runs.errorDetails, RUN_CANCELLATION_MARKER),
        ),
      )
      .returning({ id: runs.id, jobId: runs.jobId });
    if (!finalized) return false;
    if (finalized.jobId) {
      try {
        await this.syncJobStatusFromRuns(finalized.jobId);
      } catch (error) {
        // The run is already finalized; leave the job status for the next run to write rather than guess.
        this.logger.error(
          `Failed to update job status after cancelling run ${runId}:`,
          error,
        );
      }
    }
    return true;
  }

  /**
   * Fail a run that never started, unless the user cancelled it. The marker guard sits in the same
   * write, so a cancel landing between a separate check and the write cannot be overwritten.
   */
  async failRunUnlessCancelled(runId: string, reason: string): Promise<void> {
    const [failed] = await this.db
      .update(runs)
      .set({
        status: 'failed',
        durationMs: 0,
        completedAt: new Date(),
        errorDetails: reason,
      })
      .where(
        and(
          eq(runs.id, runId),
          inArray(runs.status, ['queued', 'running']),
          or(
            isNull(runs.errorDetails),
            ne(runs.errorDetails, RUN_CANCELLATION_MARKER),
          ),
        ),
      )
      .returning({ id: runs.id });
    if (!failed) await this.finalizeCancelledRun(runId);
  }

  /** A committed terminal result makes a redelivered queue task a replay. */
  async getTerminalRun(runId: string) {
    return this.db.query.runs.findFirst({
      where: and(
        eq(runs.id, runId),
        inArray(runs.status, ['passed', 'failed', 'error', 'blocked']),
      ),
      columns: { id: true, status: true, errorDetails: true },
    });
  }

  // Still used by the k6 processor.
  async getRunStatusesForJob(
    jobId: string,
  ): Promise<
    (
      | 'pending'
      | 'running'
      | 'passed'
      | 'failed'
      | 'error'
      | 'queued'
      | 'blocked'
    )[]
  > {
    try {
      const result = await this.db
        .select({ status: runs.status })
        .from(runs)
        .where(eq(runs.jobId, jobId));

      return result.map((r) => r.status).filter((s) => s !== null);
    } catch (error) {
      this.logger.error(`Failed to get run statuses for job ${jobId}:`, error);
      return [];
    }
  }

  /**
   * Recompute a job's status from its runs in one statement: running while any run is queued or
   * running, otherwise the newest finished run's status (a blocked run counts as error, since jobs
   * have no blocked status). Call after the run's own row is written. Throws on failure so callers
   * can decide; with no runs the status is left unchanged.
   */
  async syncJobStatusFromRuns(jobId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE jobs SET status = CASE
        WHEN EXISTS (SELECT 1 FROM runs WHERE job_id = ${jobId} AND status IN ('queued', 'running')) THEN 'running'
        ELSE COALESCE(
          (SELECT CASE WHEN status = 'blocked' THEN 'error' ELSE status END
             FROM runs
            WHERE job_id = ${jobId} AND status IN ('passed', 'failed', 'error', 'blocked')
            ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1),
          jobs.status)
      END
      WHERE id = ${jobId}`);
  }

  // ===============================
  // Requirement Coverage Methods
  // ===============================

  /**
   * Get all requirement IDs linked to tests in a job
   * @param jobId The job ID
   * @param organizationId For RBAC filtering
   */
  async getRequirementsByJobTests(
    jobId: string,
    organizationId: string,
  ): Promise<string[]> {
    try {
      // Get tests from job via jobTests, then find linked requirements
      const result = await this.db
        .select({ requirementId: schema.testRequirements.requirementId })
        .from(schema.testRequirements)
        .innerJoin(
          schema.jobTests,
          eq(schema.testRequirements.testId, schema.jobTests.testId),
        )
        .innerJoin(
          schema.requirements,
          eq(schema.testRequirements.requirementId, schema.requirements.id),
        )
        .where(
          and(
            eq(schema.jobTests.jobId, jobId),
            eq(schema.requirements.organizationId, organizationId),
          ),
        );

      // Return unique requirement IDs
      const uniqueIds = [...new Set(result.map((r) => r.requirementId))];
      this.logger.debug(
        `Found ${uniqueIds.length} requirements linked to job ${jobId}`,
      );
      return uniqueIds;
    } catch (error) {
      this.logger.error(
        `Failed to get requirements for job ${jobId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Get all tests linked to a requirement with their latest run status
   * Determines test status by finding the most recent completed job run containing that test
   * @param requirementId The requirement ID
   * @param organizationId For RBAC filtering
   */
  async getLinkedTestsWithStatus(
    requirementId: string,
    _organizationId: string,
  ): Promise<Array<{ testId: string; status: 'passed' | 'failed' | null }>> {
    try {
      // Get all tests linked to this requirement
      const linkedTests = await this.db
        .select({ testId: schema.testRequirements.testId })
        .from(schema.testRequirements)
        .where(eq(schema.testRequirements.requirementId, requirementId));

      if (linkedTests.length === 0) {
        return [];
      }

      // For each test, find the latest completed job run that includes this test
      const results: Array<{
        testId: string;
        status: 'passed' | 'failed' | null;
      }> = [];

      for (const { testId } of linkedTests) {
        // Find jobs that include this test
        const jobsWithTest = await this.db
          .select({ jobId: schema.jobTests.jobId })
          .from(schema.jobTests)
          .where(eq(schema.jobTests.testId, testId));

        if (jobsWithTest.length === 0) {
          results.push({ testId, status: null });
          continue;
        }

        // Latest terminal run from any of these jobs. A job run records per-test outcomes in
        // metadata.testStatuses; older runs and k6 runs fall back to the run status.
        const jobIds = jobsWithTest.map((j) => j.jobId);
        const latestRun = await this.db
          .select({
            status: schema.runs.status,
            testStatus: sql<
              string | null
            >`${schema.runs.metadata}->'testStatuses'->>${testId}::text`,
          })
          .from(schema.runs)
          .where(
            and(
              liveRunOfLiveJob(schema.runs.jobId),
              sql`${schema.runs.jobId} IN (${sql.join(
                jobIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
              sql`${schema.runs.status} IN ('passed', 'failed', 'error')`,
              // A cancelled run is stored as 'error' with no test outcomes; it must not decide coverage.
              sql`${schema.runs.errorDetails} IS DISTINCT FROM ${RUN_CANCELLATION_MARKER}`,
            ),
          )
          .orderBy(
            sql`${schema.runs.completedAt} DESC NULLS LAST`,
            desc(schema.runs.id),
          )
          .limit(1);

        const status =
          latestRun.length > 0
            ? (latestRun[0].testStatus ?? latestRun[0].status)
            : null;
        results.push({
          testId,
          status:
            status === 'passed'
              ? 'passed'
              : status === 'failed' || status === 'error'
                ? 'failed'
                : null,
        });
      }

      return results;
    } catch (error) {
      this.logger.error(
        `Failed to get linked tests for requirement ${requirementId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Update requirement coverage snapshot
   * @param requirementId The requirement to update
   * @param organizationId For RBAC (used in logging)
   * @param stats Coverage statistics
   */
  async updateRequirementCoverageSnapshot(
    requirementId: string,
    _organizationId: string,
    stats: {
      status: 'covered' | 'failing' | 'missing';
      linkedTestCount: number;
      passedTestCount: number;
      failedTestCount: number;
      lastFailedTestId?: string;
      lastFailedAt?: Date;
    },
  ): Promise<void> {
    try {
      const now = new Date();

      // Upsert the coverage snapshot
      const existing = await this.db
        .select()
        .from(schema.requirementCoverageSnapshots)
        .where(
          eq(schema.requirementCoverageSnapshots.requirementId, requirementId),
        )
        .limit(1);

      if (existing.length > 0) {
        await this.db
          .update(schema.requirementCoverageSnapshots)
          .set({
            status: stats.status,
            linkedTestCount: stats.linkedTestCount,
            passedTestCount: stats.passedTestCount,
            failedTestCount: stats.failedTestCount,
            lastFailedTestId: stats.lastFailedTestId ?? null,
            lastFailedAt: stats.lastFailedAt ?? null,
            lastEvaluatedAt: now,
            updatedAt: now,
          })
          .where(
            eq(
              schema.requirementCoverageSnapshots.requirementId,
              requirementId,
            ),
          );
      } else {
        await this.db.insert(schema.requirementCoverageSnapshots).values({
          requirementId,
          status: stats.status,
          linkedTestCount: stats.linkedTestCount,
          passedTestCount: stats.passedTestCount,
          failedTestCount: stats.failedTestCount,
          lastFailedTestId: stats.lastFailedTestId ?? null,
          lastFailedAt: stats.lastFailedAt ?? null,
          lastEvaluatedAt: now,
          updatedAt: now,
        });
      }

      this.logger.debug(
        `Updated coverage for requirement ${requirementId}: ${stats.status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update coverage for requirement ${requirementId}: ${(error as Error).message}`,
      );
      // Don't throw - coverage update failures shouldn't break job completion
    }
  }
}
