import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  MONITOR_SCHEDULER_QUEUE,
  MONITOR_EXECUTION_QUEUE,
  EXECUTE_MONITOR_JOB_NAME,
} from '../constants';
import { MonitorJobData } from '../interfaces';
import { IS_DISTRIBUTED_MULTI_LOCATION } from '../../monitor/monitor.constants';
import { LocationService } from '../../common/location/location.service';
import type {
  LocationConfig,
  MonitorConfig,
  MonitoringLocation,
} from '../../db/schema';

@Processor(MONITOR_SCHEDULER_QUEUE)
export class MonitorSchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(MonitorSchedulerProcessor.name);

  constructor(
    @InjectQueue(MONITOR_EXECUTION_QUEUE)
    private readonly monitorExecutionQueue: Queue,
    private readonly locationService: LocationService,
  ) {
    super();
  }

  async process(
    job: Job<MonitorJobData, void, string>,
  ): Promise<{ success: boolean }> {
    // Removed log - only log errors
    await this.handleScheduledMonitorTrigger(job);
    return { success: true };
  }

  private async handleScheduledMonitorTrigger(job: Job<MonitorJobData>) {
    const monitorId = job.data.monitorId;
    try {
      const data = job.data;
      const executionJobData =
        (data.jobData as MonitorJobData | undefined) ?? data;
      const retryLimit = (data.retryLimit as number) || 3;

      await this.enqueueMonitorExecutionJobs(executionJobData, retryLimit);
    } catch (error) {
      this.logger.error(
        `Failed to process scheduled monitor trigger for monitor ${monitorId}:`,
        error,
      );
    }
  }

  private async enqueueMonitorExecutionJobs(
    jobData: MonitorJobData,
    retryLimit: number,
  ): Promise<void> {
    if (IS_DISTRIBUTED_MULTI_LOCATION) {
      const monitorConfig =
        (jobData.config as MonitorConfig | undefined) ?? undefined;
      const locationConfig =
        (monitorConfig?.locationConfig as LocationConfig | null) ?? null;

      const effectiveLocations =
        this.locationService.getEffectiveLocations(locationConfig);
      const expectedLocations = Array.from(
        new Set(effectiveLocations),
      ) as MonitoringLocation[];

      const executionGroupId = `${jobData.monitorId}-${Date.now()}-${crypto
        .randomBytes(6)
        .toString('hex')}`;

      await Promise.all(
        expectedLocations.map((location) =>
          this.monitorExecutionQueue.add(
            EXECUTE_MONITOR_JOB_NAME,
            {
              ...jobData,
              executionLocation: location,
              executionGroupId,
              expectedLocations,
            },
            {
              jobId: `${jobData.monitorId}:${executionGroupId}:${location}`,
              attempts: retryLimit,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: true,
              removeOnFail: { count: 1000 },
              priority: 1,
            },
          ),
        ),
      );
      return;
    }

    const uniqueJobId = `${jobData.monitorId}-${Date.now()}-${crypto
      .randomBytes(4)
      .toString('hex')}`;

    await this.monitorExecutionQueue.add(EXECUTE_MONITOR_JOB_NAME, jobData, {
      jobId: uniqueJobId,
      attempts: retryLimit,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: { count: 1000 },
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    // Removed log - only log errors
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: unknown) {
    this.logger.error(`Scheduled monitor failed: ${job?.name}`, error);
  }
}
