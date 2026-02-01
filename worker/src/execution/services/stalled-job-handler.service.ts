import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { DbService } from './db.service';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TIMEOUTS } from '../../common/constants/timeouts.constants';

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
/**
 * OPTIMIZED (v1.2.4+): Removed unnecessary Redis connection.
 * This service only queries the database - no Redis needed.
 * Saves 1 Redis connection per worker pod.
 */
@Injectable()
export class StalledJobHandlerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StalledJobHandlerService.name);
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor(private readonly dbService: DbService) {}

  onModuleInit() {
    try {
      this.logger.log('Initializing StalledJobHandlerService');
      this.startMonitoring();
    } catch (error) {
      this.logger.error(
        `Failed to initialize StalledJobHandlerService: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Monitor for stalled jobs at regular intervals
   * Check for jobs that were marked as stalled but not properly updated in the database
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.checkAndHandleStalledJobs().catch((error) => {
        this.logger.error(
          `Error in stalled job monitoring: ${(error as Error).message}`,
          (error as Error).stack,
        );
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
    try {
      // Find all runs that are still in "running" status
      const activeRuns = await this.dbService.db
        .select({
          id: schema.runs.id,
          jobId: schema.runs.jobId,
          createdAt: schema.runs.createdAt,
          status: schema.runs.status,
        })
        .from(schema.runs)
        .where(eq(schema.runs.status, 'running'))
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
      }> = [];

      for (const run of activeRuns) {
        // Skip runs with null createdAt (should not happen, but handle gracefully)
        if (!run.createdAt) {
          this.logger.warn(
            `[${run.id}] Run has null createdAt timestamp, skipping stalled check`,
          );
          continue;
        }

        const ageMs = now.getTime() - run.createdAt.getTime();

        // If a run has been "running" for longer than threshold + buffer, it's likely stuck
        // Threshold matches lockDuration in queue config (70 minutes)
        // Buffer provides additional time for graceful completion (10 minutes)
        if (
          ageMs >
          TIMEOUTS.STALLED_JOB_THRESHOLD_MS + TIMEOUTS.STALLED_JOB_BUFFER_MS
        ) {
          stalledRuns.push({ id: run.id, jobId: run.jobId, ageMs });
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
        await this.dbService.db
          .update(schema.runs)
          .set({
            status: 'error',
            completedAt: now,
            errorDetails:
              'Execution timed out - marked as stalled by automatic recovery',
          })
          .where(inArray(schema.runs.id, runIds));

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
          const allJobRuns = await this.dbService.db.query.runs.findMany({
            where: inArray(schema.runs.jobId, uniqueJobIds),
            columns: {
              id: true,
              jobId: true,
              status: true,
            },
          });

          // Group runs by job ID
          const runsByJob = new Map<
            string,
            Array<'pending' | 'running' | 'passed' | 'failed' | 'error'>
          >();
          for (const jobRun of allJobRuns) {
            if (jobRun.jobId) {
              if (!runsByJob.has(jobRun.jobId)) {
                runsByJob.set(jobRun.jobId, []);
              }
              runsByJob
                .get(jobRun.jobId)!
                .push(
                  jobRun.status as
                    | 'pending'
                    | 'running'
                    | 'passed'
                    | 'failed'
                    | 'error',
                );
            }
          }

          // Update each job status based on its runs
          for (const [jobId, runStatuses] of runsByJob.entries()) {
            await this.dbService.updateJobStatus(jobId, runStatuses);
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
   * Clean up resources on module destroy
   * NestJS lifecycle hook - called automatically when module is destroyed
   */
  onModuleDestroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.logger.log('StalledJobHandlerService cleaned up');
  }
}
