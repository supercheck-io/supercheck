import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { JOB_EXECUTION_QUEUE } from '../constants';
import { ExecutionService } from '../services/execution.service';
import { DbService } from '../services/db.service';
import { JobExecutionTask, TestExecutionResult } from '../interfaces';
import { eq } from 'drizzle-orm';
import { jobs } from '../../db/schema';
import { ErrorHandler } from '../../common/utils/error-handler';
import { JobNotificationService } from '../services/job-notification.service';

// Types are now imported from interfaces.ts which uses schema types

@Processor(JOB_EXECUTION_QUEUE)
export class JobExecutionProcessor extends WorkerHost {
  private readonly logger = new Logger(JobExecutionProcessor.name);

  constructor(
    private readonly executionService: ExecutionService,
    private readonly dbService: DbService,
    private readonly jobNotificationService: JobNotificationService,
  ) {
    super();
    this.logger.log(`[Constructor] JobExecutionProcessor instantiated.`);
  }

  // Specify concurrency if needed, e.g., @Process({ concurrency: 2 })
  // @Process()
  async process(job: Job<JobExecutionTask>): Promise<TestExecutionResult> {
    const runId = job.data.runId;
    const jobData = job.data;
    const { jobId: originalJobId } = jobData;
    const jobIdForLookup = jobData.originalJobId || jobData.jobId;
    const startTime = new Date();
    this.logger.log(
      `[${runId}] Job execution job ID: ${job.id} received for processing${originalJobId ? ` (job ${originalJobId})` : ''}`,
    );

    await job.updateProgress(10);

    try {
      // Delegate the actual execution to the service
      // The service handles validation, writing files, execution, upload, DB updates
      const result = await this.executionService.runJob(job.data);

      await job.updateProgress(100);
      this.logger.log(
        `[${runId}] Job execution job ID: ${job.id} completed. Overall Success: ${result.success}`,
      );

      // Calculate execution duration
      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationSeconds = Math.floor(durationMs / 1000);

      // Update the job status based on test results
      const finalStatus = result.success ? 'passed' : 'failed';

      // Update the run status with duration first
      await this.dbService
        .updateRunStatus(runId, finalStatus, durationSeconds.toString())
        .catch((err: Error) =>
          this.logger.error(
            `[${runId}] Failed to update run status to ${finalStatus}: ${err.message}`,
          ),
        );

      // Update job status based on all current run statuses (including the one we just updated)
      if (originalJobId) {
        const finalRunStatuses =
          await this.dbService.getRunStatusesForJob(originalJobId);
        // Robust: If only one run, or all runs are terminal, set job status to match this run
        const allTerminal = finalRunStatuses.every((s) =>
          ['passed', 'failed', 'error'].includes(s),
        );
        if (finalRunStatuses.length === 1 || allTerminal) {
          await this.dbService
            .updateJobStatus(originalJobId, [finalStatus])
            .catch((err: Error) =>
              this.logger.error(
                `[${runId}] Failed to update job status (robust): ${err.message}`,
              ),
            );
        } else {
          await this.dbService
            .updateJobStatus(originalJobId, finalRunStatuses)
            .catch((err: Error) =>
              this.logger.error(
                `[${runId}] Failed to update job status: ${err.message}`,
              ),
            );
        }
        // Always update lastRunAt after a run completes
        await this.dbService.db
          .update(jobs)
          .set({ lastRunAt: new Date() })
          .where(eq(jobs.id, originalJobId))
          .execute();
      }

      // Send notifications for job completion
      await this.jobNotificationService.handleJobNotifications({
        jobId: jobIdForLookup,
        organizationId: jobData.organizationId,
        projectId: jobData.projectId,
        runId,
        finalStatus,
        durationSeconds,
        results: result.results ?? [],
        jobType: jobData.jobType ?? 'playwright',
      });

      // The result object (TestExecutionResult) from the service is returned.
      // BullMQ will store this in Redis and trigger the 'completed' event.
      return result;
    } catch (error: unknown) {
      ErrorHandler.logError(
        this.logger,
        error,
        `Job execution ${runId} (job ID: ${job.id})`,
        { runId, jobId: job.id },
      );

      // Update database with error status
      const errorStatus = 'failed';

      // Update run status first
      await this.dbService
        .updateRunStatus(runId, errorStatus, '0')
        .catch((err: Error) =>
          this.logger.error(
            `[${runId}] Failed to update run error status: ${err.message}`,
          ),
        );

      // Update job status based on all current run statuses
      if (originalJobId) {
        const finalRunStatuses =
          await this.dbService.getRunStatusesForJob(originalJobId);
        const allTerminal = finalRunStatuses.every((s) =>
          ['passed', 'failed', 'error'].includes(s),
        );
        if (finalRunStatuses.length === 1 || allTerminal) {
          await this.dbService
            .updateJobStatus(originalJobId, [errorStatus])
            .catch((err) =>
              this.logger.error(
                `[${runId}] Failed to update job error status (robust): ${(err as Error).message}`,
              ),
            );
        } else {
          await this.dbService
            .updateJobStatus(originalJobId, finalRunStatuses)
            .catch((err) =>
              this.logger.error(
                `[${runId}] Failed to update job error status: ${(err as Error).message}`,
              ),
            );
        }
      }

      try {
        const elapsedSeconds = Math.max(
          0,
          Math.floor((new Date().getTime() - startTime.getTime()) / 1000),
        );
        await this.jobNotificationService.handleJobNotifications({
          jobId: jobIdForLookup,
          organizationId: jobData.organizationId,
          projectId: jobData.projectId,
          runId,
          finalStatus: 'error',
          durationSeconds: elapsedSeconds,
          results: [{ success: false }],
          jobType: jobData.jobType ?? 'playwright',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } catch (notificationError) {
        this.logger.error(
          `[${runId}] Failed to send error notification: ${
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError)
          }`,
        );
      }

      // Update job progress to indicate failure stage if applicable
      await job.updateProgress(100);

      // It's crucial to re-throw the error for BullMQ to mark the job as failed.
      // This will trigger the 'failed' event for the queue.
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  @OnWorkerEvent('ready')
  onReady() {
    // This indicates the underlying BullMQ worker is connected and ready
    this.logger.log(
      '[Event:ready] Worker is connected to Redis and ready to process jobs.',
    );
  }
}
