import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  JOB_SCHEDULER_QUEUE,
  JOB_EXECUTION_QUEUE,
  JobExecutionTask,
} from '../constants';
import { DbService } from '../../db/db.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { getNextRunDate } from '../utils/cron-utils';
import { jobs, runs } from '../../db/schema';
import { eq, and } from 'drizzle-orm';

@Processor(JOB_SCHEDULER_QUEUE)
export class JobSchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(JobSchedulerProcessor.name);

  constructor(
    private readonly dbService: DbService,
    @InjectQueue(JOB_EXECUTION_QUEUE) private jobExecutionQueue: Queue,
  ) {
    super();
  }

  async process(
    job: Job<
      {
        jobId: string;
        testCases: Array<{ id: string; script: string; title: string }>;
        retryLimit?: number;
        variables: Record<string, string>;
        secrets: Record<string, string>;
        projectId: string;
        organizationId: string;
      },
      any,
      string
    >,
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `Processing scheduled job trigger: ${job.name} (${job.id})`,
    );
    await this.handleScheduledJobTrigger(job);
    return { success: true };
  }

  private async handleScheduledJobTrigger(
    job: Job<{
      jobId: string;
      testCases: Array<{ id: string; script: string; title: string }>;
      retryLimit?: number;
      variables: Record<string, string>;
      secrets: Record<string, string>;
      projectId: string;
      organizationId: string;
    }>,
  ) {
    const jobId = job.data?.jobId;

    if (!jobId) {
      this.logger.error(`Job ID is undefined or null in job data:`, job.data);
      return;
    }

    try {
      const data = job.data;
      this.logger.log(`Handling scheduled job trigger for job ${jobId}`);

      const runningRuns = await this.dbService.db
        .select()
        .from(runs)
        .where(and(eq(runs.jobId, jobId), eq(runs.status, 'running')));

      if (runningRuns.length > 0) {
        this.logger.warn(
          `Job ${jobId} already has a running execution, skipping.`,
        );
        return;
      }

      const now = new Date();
      const jobData = await this.dbService.db
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (jobData.length === 0) {
        this.logger.error(`Job ${jobId} not found`);
        return;
      }

      const jobRecord = jobData[0];
      this.logger.log(`Job record for ${jobId}:`, {
        id: jobRecord.id,
        name: jobRecord.name,
        projectId: jobRecord.projectId,
        organizationId: jobRecord.organizationId,
      });

      const runId = crypto.randomUUID();

      // Use projectId from pre-resolved data
      const projectId = data.projectId;

      await this.dbService.db.insert(runs).values({
        id: runId,
        jobId: jobId,
        status: 'running',
        startedAt: new Date(),
        trigger: 'schedule', // Set trigger to 'schedule'
        projectId: projectId, // Add projectId for proper filtering
      });

      this.logger.log(`Created run record ${runId} for scheduled job ${jobId}`);
      const cronSchedule = jobRecord.cronSchedule;
      let nextRunAt: Date | null = null;

      try {
        if (cronSchedule) {
          nextRunAt = getNextRunDate(cronSchedule);
        }
      } catch (error) {
        this.logger.error(`Failed to calculate next run date: ${error}`);
      }

      const updatePayload: {
        lastRunAt: Date;
        nextRunAt?: Date;
        status: 'running';
      } = {
        lastRunAt: now,
        status: 'running',
      };

      if (nextRunAt) {
        updatePayload.nextRunAt = nextRunAt;
      }

      await this.dbService.db
        .update(jobs)
        .set(updatePayload)
        .where(eq(jobs.id, jobId));

      // Use pre-resolved variables and test scripts from app side
      // All scheduled jobs should have variables resolved on app side for consistency
      this.logger.log(
        `[${jobId}/${runId}] Using pre-resolved variables: ${Object.keys(data.variables).length} variables, ${Object.keys(data.secrets).length} secrets`,
      );

      const processedTestScripts = data.testCases.map(
        (test: { id: string; script: string; title: string }) => ({
          id: test.id,
          script: test.script, // Script is already decoded and has variables resolved
          name: test.title,
        }),
      );

      const variableResolution = {
        variables: data.variables,
        secrets: data.secrets,
      };

      // Use pre-resolved organization info
      const organizationId = data.organizationId;

      const task: JobExecutionTask = {
        runId,
        jobId,
        testScripts: processedTestScripts,
        trigger: 'schedule',
        organizationId: organizationId,
        projectId: projectId,
        variables: variableResolution.variables,
        secrets: variableResolution.secrets,
      };

      const jobOptions = {
        jobId: runId,
        attempts: (data.retryLimit as number) || 3,
        backoff: {
          type: 'exponential' as const,
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      };

      await this.jobExecutionQueue.add(runId, task, jobOptions);
      this.logger.log(
        `Created execution task for scheduled job ${jobId}, run ${runId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process scheduled job trigger for job ${jobId}:`,
        error,
      );
      await this.handleError(jobId, error);
    }
  }

  private async handleError(jobId: string | undefined, error: unknown) {
    if (!jobId) {
      this.logger.error('Cannot handle error for undefined jobId:', error);
      return;
    }

    try {
      await this.dbService.db
        .update(jobs)
        .set({ status: 'error' })
        .where(eq(jobs.id, jobId));

      await this.dbService.db
        .update(runs)
        .set({
          status: 'error',
          errorDetails: `Failed to process scheduled job: ${
            error instanceof Error ? error.message : String(error)
          }`,
          completedAt: new Date(),
        })
        .where(and(eq(runs.jobId, jobId), eq(runs.status, 'running')));
    } catch (dbError) {
      this.logger.error(
        `Failed to update job/run status to error for job ${jobId}:`,
        dbError,
      );
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Scheduled job completed: ${job.name}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: unknown) {
    this.logger.error(`Scheduled job failed: ${job?.name}`, error);
  }
}
