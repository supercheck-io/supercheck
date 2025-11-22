import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  JOB_SCHEDULER_QUEUE,
  JOB_EXECUTION_QUEUE,
  K6_JOB_EXECUTION_QUEUE,
  K6_JOB_SCHEDULER_QUEUE,
  JobExecutionTask,
} from '../constants';
import { DbService } from '../../db/db.service';
import * as crypto from 'crypto';
import { getNextRunDate } from '../utils/cron-utils';
import { jobs, runs } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { Queue } from 'bullmq';

const DEFAULT_K6_LOCATION = 'us-east';

abstract class BaseJobSchedulerProcessor extends WorkerHost {
  protected readonly logger: Logger;

  protected constructor(
    processorName: string,
    protected readonly dbService: DbService,
    @InjectQueue(JOB_EXECUTION_QUEUE)
    protected readonly jobExecutionQueue: Queue,
    @InjectQueue(K6_JOB_EXECUTION_QUEUE)
    protected readonly k6JobExecutionQueue: Queue,
  ) {
    super();
    this.logger = new Logger(processorName);
  }

  async handleProcess(
    job: Job<{
      jobId: string;
      testCases: Array<{
        id: string;
        script: string;
        title: string;
        type?: string;
      }>;
      retryLimit?: number;
      variables: Record<string, string>;
      secrets: Record<string, string>;
      projectId: string;
      organizationId: string;
    }>,
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `Processing scheduled job trigger: ${job.name} (${job.id})`,
    );
    await this.handleScheduledJobTrigger(job);
    return { success: true };
  }

  protected async handleScheduledJobTrigger(
    job: Job<{
      jobId: string;
      testCases: Array<{
        id: string;
        script: string;
        title: string;
        type?: string;
      }>;
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
        jobType: jobRecord.jobType,
      });

      const jobType = jobRecord.jobType ?? 'playwright';
      const isK6Job = jobType === 'k6';
      const resolvedLocation = isK6Job ? DEFAULT_K6_LOCATION : null;

      const runId = crypto.randomUUID();

      // Use projectId from pre-resolved data
      const projectId = data.projectId;

      await this.dbService.db.insert(runs).values({
        id: runId,
        jobId: jobId,
        status: 'running',
        startedAt: new Date(),
        trigger: 'schedule',
        projectId: projectId,
        location: resolvedLocation,
        metadata: {
          jobType,
          executionEngine: isK6Job ? 'k6' : 'playwright',
          ...(isK6Job ? { location: resolvedLocation } : {}),
        },
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

      this.logger.log(
        `[${jobId}/${runId}] Using pre-resolved variables: ${Object.keys(data.variables).length} variables, ${Object.keys(data.secrets).length} secrets`,
      );

      const processedTestScripts = data.testCases.map(
        (test: {
          id: string;
          script: string;
          title: string;
          type?: string;
        }) => ({
          id: test.id,
          script: test.script,
          name: test.title,
          type: test.type,
        }),
      );

      const variableResolution = {
        variables: data.variables,
        secrets: data.secrets,
      };

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
        jobType: jobType,
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

      if (isK6Job) {
        const primaryScript = processedTestScripts[0]?.script ?? '';
        const primaryTestId = processedTestScripts[0]?.id;
        const primaryType = processedTestScripts[0]?.type;

        if (!primaryTestId || !primaryScript) {
          this.logger.error(
            `[${jobId}/${runId}] Unable to prepare k6 script for scheduled job execution`,
          );
          await this.dbService.db
            .update(runs)
            .set({
              status: 'failed',
              completedAt: new Date(),
              errorDetails: 'Unable to prepare k6 script for execution',
            })
            .where(eq(runs.id, runId));
          return;
        }

        if (primaryType && primaryType !== 'performance') {
          this.logger.error(
            `[${jobId}/${runId}] Scheduled k6 job references non-performance test ${primaryTestId}`,
          );
          await this.dbService.db
            .update(runs)
            .set({
              status: 'failed',
              completedAt: new Date(),
              errorDetails: 'k6 jobs require performance tests',
            })
            .where(eq(runs.id, runId));
          return;
        }

        await this.k6JobExecutionQueue.add(
          'k6-job-execution',
          {
            runId,
            jobId,
            testId: primaryTestId,
            script: primaryScript,
            tests: processedTestScripts.map((script) => ({
              id: script.id,
              script: script.script,
            })),
            organizationId,
            projectId,
            location: resolvedLocation ?? DEFAULT_K6_LOCATION,
          },
          {
            ...jobOptions,
            priority: 1, // Lowest priority for long-running k6 jobs
          },
        );

        this.logger.log(
          `Enqueued k6 execution task for scheduled job ${jobId}, run ${runId}`,
        );
      } else {
        await this.jobExecutionQueue.add(runId, task, {
          ...jobOptions,
          priority: 5, // Medium priority for regular Playwright tests
        });
        this.logger.log(
          `Created execution task for scheduled job ${jobId}, run ${runId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to process scheduled job trigger for job ${jobId}:`,
        error,
      );
      await this.handleError(jobId, error);
    }
  }

  protected async handleError(jobId: string | undefined, error: unknown) {
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
}

@Processor(JOB_SCHEDULER_QUEUE)
export class PlaywrightJobSchedulerProcessor extends BaseJobSchedulerProcessor {
  constructor(
    dbService: DbService,
    @InjectQueue(JOB_EXECUTION_QUEUE) jobExecutionQueue: Queue,
    @InjectQueue(K6_JOB_EXECUTION_QUEUE) k6JobExecutionQueue: Queue,
  ) {
    super(
      PlaywrightJobSchedulerProcessor.name,
      dbService,
      jobExecutionQueue,
      k6JobExecutionQueue,
    );
  }

  async process(job: Job<any>): Promise<{ success: boolean }> {
    return this.handleProcess(job);
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

@Processor(K6_JOB_SCHEDULER_QUEUE)
export class K6JobSchedulerProcessor extends BaseJobSchedulerProcessor {
  constructor(
    dbService: DbService,
    @InjectQueue(JOB_EXECUTION_QUEUE) jobExecutionQueue: Queue,
    @InjectQueue(K6_JOB_EXECUTION_QUEUE) k6JobExecutionQueue: Queue,
  ) {
    super(
      K6JobSchedulerProcessor.name,
      dbService,
      jobExecutionQueue,
      k6JobExecutionQueue,
    );
  }

  async process(job: Job<any>): Promise<{ success: boolean }> {
    return this.handleProcess(job);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Scheduled k6 job completed: ${job.name}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: unknown) {
    this.logger.error(`Scheduled k6 job failed: ${job?.name}`, error);
  }
}
