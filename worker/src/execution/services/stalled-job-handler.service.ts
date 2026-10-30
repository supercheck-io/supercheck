import { lockRecoverableRunCallbacks } from './run-callback';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DbService } from './db.service';
import { and, or, eq, ne, isNull, lt, inArray, sql, desc } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TIMEOUTS } from '../../common/constants/timeouts.constants';
import { buildRedisOptions } from '../../common/redis/redis-options';
import { Queue } from 'bullmq';
import { PLAYWRIGHT_QUEUE } from '../constants';
import { K6_QUEUE, k6QueueName } from '../../k6/k6.constants';
import { ContainerExecutorService } from '../../common/security/container-executor.service';
import { RUN_CANCELLATION_MARKER } from '../../common/services/cancellation.service';

/**
 * Service to handle stalled jobs
 *
 * When a BullMQ job is marked as stalled (execution takes longer than lockDuration),
 * this service ensures the database is updated with proper error status, preventing
 * jobs from being stuck in "running" state indefinitely.
 *
 * This addresses the issue where:
 * 1. Job starts execution
 * 2. After 20 minutes (lockDuration), BullMQ marks it as stalled
 * 3. Job is moved back to waiting for retry
 * 4. But the run status in the database was never updated to "error"
 * 5. So the job appears "stuck" in "running" state
 */
@Injectable()
export class StalledJobHandlerService implements OnModuleInit, OnModuleDestroy {
  private static readonly REDIS_COMMAND_TIMEOUT_MS = 5_000;
  // A queued run with no BullMQ job past this age will never start.
  private static readonly ORPHANED_QUEUED_MS = 30 * 60 * 1000;
  private readonly logger = new Logger(StalledJobHandlerService.name);
  private redisClient: Redis | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private monitoringInProgress = false;
  private readonly queues = new Map<string, Queue>();

  constructor(
    private readonly dbService: DbService,
    private readonly configService: ConfigService,
    private readonly containerExecutorService: ContainerExecutorService,
  ) {}

  onModuleInit() {
    try {
      this.logger.log('Initializing StalledJobHandlerService');
      this.setupRedisConnection();
      this.startMonitoring();
    } catch (error) {
      this.logger.error(
        `Failed to initialize StalledJobHandlerService: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private setupRedisConnection(): void {
    this.redisClient = new Redis(
      buildRedisOptions(this.configService, {
        commandTimeout: StalledJobHandlerService.REDIS_COMMAND_TIMEOUT_MS,
      }),
    );

    this.redisClient.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`, err.stack);
    });

    this.logger.log('Redis connection established for stalled job monitoring');
  }

  /**
   * Monitor for stalled jobs at regular intervals
   * Check for jobs that were marked as stalled but not properly updated in the database
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      if (this.monitoringInProgress) {
        this.logger.warn(
          'Previous stalled job check is still running; skipping this interval',
        );
        return;
      }
      this.monitoringInProgress = true;
      void this.checkAndHandleStalledJobs()
        .catch((error: unknown) => {
          this.logger.error(
            `Error in stalled job monitoring: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined,
          );
        })
        .finally(() => {
          this.monitoringInProgress = false;
        });
    }, TIMEOUTS.STALLED_JOB_CHECK_INTERVAL_MS);

    this.logger.log(
      `Stalled job monitoring started (checks every ${TIMEOUTS.STALLED_JOB_CHECK_INTERVAL_MS / 1000}s)`,
    );
  }

  /**
   * Check for runs that are still in "running" status but are from stalled jobs
   */
  private async checkAndHandleStalledJobs(): Promise<void> {
    if (!this.redisClient) {
      this.logger.warn('Redis client not ready, skipping stalled job check');
      return;
    }

    try {
      const recoverQueuedCancellations =
        this.configService.get<string>('CANCELLED_QUEUED_RECOVERY_ENABLED') ===
        'true';
      const queuedCancellation = and(
        eq(schema.runs.status, 'queued'),
        eq(schema.runs.errorDetails, RUN_CANCELLATION_MARKER),
      );
      const orphanedQueued = and(
        eq(schema.runs.status, 'queued'),
        lt(
          schema.runs.createdAt,
          new Date(Date.now() - StalledJobHandlerService.ORPHANED_QUEUED_MS),
        ),
        or(
          isNull(schema.runs.errorDetails),
          ne(schema.runs.errorDetails, RUN_CANCELLATION_MARKER),
        ),
      );
      // Enable queued recovery only after every worker uses atomic execution admission.
      const activeRuns = await this.dbService.db
        .select({
          id: schema.runs.id,
          jobId: schema.runs.jobId,
          startedAt: schema.runs.startedAt,
          createdAt: schema.runs.createdAt,
          status: schema.runs.status,
          errorDetails: schema.runs.errorDetails,
          location: schema.runs.location,
          callbackHeartbeatAt: schema.runCallbacks.heartbeatAt,
          callbackFinishedAt: schema.runCallbacks.finishedAt,
          callbackRevokedAt: schema.runCallbacks.revokedAt,
        })
        .from(schema.runs)
        .leftJoin(
          schema.runCallbacks,
          eq(schema.runCallbacks.runId, schema.runs.id),
        )
        .where(
          or(
            eq(schema.runs.status, 'running'),
            recoverQueuedCancellations ? queuedCancellation : undefined,
            orphanedQueued,
          ),
        )
        .limit(1000); // Limit to prevent large queries

      if (activeRuns.length === 0) {
        return;
      }

      const now = new Date();

      // Collect all runs that need to be marked as stalled
      const stalledRuns: Array<{
        id: string;
        jobId: string | null;
        ageMs: number;
        status: string;
      }> = [];

      for (const run of activeRuns) {
        if (
          run.status === 'queued' &&
          run.errorDetails !== RUN_CANCELLATION_MARKER
        ) {
          // Orphaned queued run: sweep only when no queue job or execution remains.
          if (
            (await this.isBullMqJobActive(run.id, run.location)) ||
            (await this.containerExecutorService.hasActiveExecution(run.id))
          ) {
            continue;
          }
          stalledRuns.push({
            id: run.id,
            jobId: run.jobId,
            ageMs: now.getTime() - (run.createdAt ?? now).getTime(),
            status: run.status,
          });
          continue;
        }
        // Use startedAt as the primary runtime clock for stalled detection.
        // Fall back to createdAt only if startedAt is null (should not happen for running runs).
        const referenceTime = run.startedAt ?? run.createdAt;

        if (!referenceTime) {
          this.logger.warn(
            `[${run.id}] Run has null startedAt and createdAt timestamps, skipping stalled check`,
          );
          continue;
        }

        const ageMs = now.getTime() - referenceTime.getTime();
        const unfinishedCallback =
          !!run.callbackHeartbeatAt && !run.callbackFinishedAt;
        const staleCallback =
          unfinishedCallback &&
          (run.callbackRevokedAt ||
            run.callbackHeartbeatAt!.getTime() <= now.getTime() - 120_000);
        if (unfinishedCallback && !staleCallback) continue;

        // If a run has been "running" for longer than threshold + buffer, it's likely stuck
        // Threshold matches lockDuration in queue config (70 minutes)
        // Buffer provides additional time for graceful completion (10 minutes)
        if (
          staleCallback ||
          ageMs >
            TIMEOUTS.STALLED_JOB_THRESHOLD_MS + TIMEOUTS.STALLED_JOB_BUFFER_MS
        ) {
          const bullMqActive =
            !staleCallback &&
            (await this.isBullMqJobActive(run.id, run.location));
          const kubernetesActive = bullMqActive
            ? false
            : await this.containerExecutorService.hasActiveExecution(run.id);
          if (bullMqActive || kubernetesActive) {
            this.logger.warn(
              `[${run.id}] Run exceeded the stale threshold but still has ` +
                `${bullMqActive ? 'BullMQ' : 'Kubernetes'} activity; leaving it running.`,
            );
            continue;
          }
          stalledRuns.push({
            id: run.id,
            jobId: run.jobId,
            ageMs,
            status: run.status,
          });
          this.logger.warn(
            `[${run.id}] Run has been in "running" status for ${Math.floor(ageMs / 1000)}s. ` +
              `Will mark as error to prevent stuck jobs.`,
          );
        }
      }

      // If no stalled runs found, exit early
      if (stalledRuns.length === 0) {
        return;
      }

      this.logger.log(`Found ${stalledRuns.length} stalled runs to update`);

      try {
        // Batch update all stalled runs at once
        const runIds = stalledRuns.map((r) => r.id);
        await this.dbService.db.transaction(async (tx) => {
          const recoverableIds = await lockRecoverableRunCallbacks(tx, runIds);
          if (!recoverableIds.length) return;
          await tx
            .update(schema.runs)
            .set({
              status: 'error',
              completedAt: now,
              // A cancelled run keeps its marker while callback recovery locks protect its artifacts.
              errorDetails: sql`CASE WHEN ${schema.runs.errorDetails} = ${RUN_CANCELLATION_MARKER} THEN ${schema.runs.errorDetails} ELSE ${'Execution timed out - marked as stalled by automatic recovery'} END`,
            })
            .where(
              and(
                inArray(schema.runs.id, recoverableIds),
                or(
                  and(
                    eq(schema.runs.status, 'running'),
                    inArray(
                      schema.runs.id,
                      stalledRuns
                        .filter((run) => run.status === 'running')
                        .map((run) => run.id),
                    ),
                  ),
                  and(
                    or(
                      recoverQueuedCancellations
                        ? queuedCancellation
                        : undefined,
                      orphanedQueued,
                    ),
                    inArray(
                      schema.runs.id,
                      stalledRuns
                        .filter((run) => run.status === 'queued')
                        .map((run) => run.id),
                    ),
                  ),
                ),
              ),
            );
          await tx
            .update(schema.reports)
            .set({ status: 'error', updatedAt: now })
            .where(
              and(
                eq(schema.reports.status, 'running'),
                or(
                  inArray(schema.reports.entityId, recoverableIds),
                  and(
                    eq(schema.reports.entityType, 'test'),
                    inArray(
                      schema.reports.reportPath,
                      recoverableIds.map((id) => `${id}/report`),
                    ),
                  ),
                ),
              ),
            );
        });

        this.logger.log(`Successfully marked ${runIds.length} runs as error`);

        // Get unique job IDs that need status updates
        const uniqueJobIds = [
          ...new Set(
            stalledRuns
              .map((r) => r.jobId)
              .filter((id): id is string => id !== null),
          ),
        ];

        if (uniqueJobIds.length > 0) {
          // Batch fetch all run statuses for affected jobs
          // Newest first: a job reflects its latest run, or running while any run is still active.
          const allJobRuns = await this.dbService.db.query.runs.findMany({
            where: inArray(schema.runs.jobId, uniqueJobIds),
            columns: {
              id: true,
              jobId: true,
              status: true,
            },
            orderBy: [desc(schema.runs.createdAt)],
          });

          // Group runs by job ID
          const runsByJob = new Map<
            string,
            Array<
              | 'pending'
              | 'running'
              | 'passed'
              | 'failed'
              | 'error'
              | 'queued'
              | 'blocked'
            >
          >();
          for (const jobRun of allJobRuns) {
            if (jobRun.jobId) {
              if (!runsByJob.has(jobRun.jobId)) {
                runsByJob.set(jobRun.jobId, []);
              }
              runsByJob.get(jobRun.jobId)!.push(jobRun.status);
            }
          }

          for (const [jobId, runStatuses] of runsByJob.entries()) {
            const active = runStatuses.find(
              (status) => status === 'running' || status === 'queued',
            );
            await this.dbService.updateJobStatus(jobId, [
              active ?? runStatuses[0],
            ]);
          }

          this.logger.log(`Updated status for ${uniqueJobIds.length} jobs`);
        }
      } catch (error) {
        this.logger.error(
          `Failed to batch update stalled runs: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error checking for stalled jobs: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Clean up resources
   */
  async onModuleDestroy(): Promise<void> {
    await this.destroy();
  }

  async destroy(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    const queues = Array.from(this.queues.values());
    this.queues.clear();

    const closeResults = await Promise.allSettled(
      queues.map((queue) => queue.close()),
    );
    for (const result of closeResults) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Failed to close stalled-job BullMQ queue: ${
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          }`,
        );
      }
    }

    if (this.redisClient) {
      this.redisClient.disconnect();
      this.redisClient = null;
    }

    this.logger.log('StalledJobHandlerService cleaned up');
  }

  private async isBullMqJobActive(
    runId: string,
    location: string | null,
  ): Promise<boolean> {
    if (!this.redisClient) return true;
    const queueNames = new Set([
      PLAYWRIGHT_QUEUE,
      K6_QUEUE,
      ...(location ? [k6QueueName(location)] : []),
    ]);
    const activeStates = new Set([
      'active',
      'waiting',
      'delayed',
      'prioritized',
      'waiting-children',
    ]);

    try {
      for (const queueName of queueNames) {
        let queue = this.queues.get(queueName);
        if (!queue) {
          queue = new Queue(queueName, { connection: this.redisClient });
          this.queues.set(queueName, queue);
        }
        const bullJob = await queue.getJob(runId);
        if (bullJob && activeStates.has(await bullJob.getState())) return true;
      }
      return false;
    } catch (error) {
      this.logger.warn(
        `[${runId}] Unable to verify BullMQ state: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  }
}
