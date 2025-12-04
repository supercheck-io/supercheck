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
import { MONITOR_QUEUES } from '../../monitor/monitor.constants';
import { MonitorJobData } from '../interfaces';
import { LocationService } from '../../common/location/location.service';
import type {
  LocationConfig,
  MonitorConfig,
  MonitoringLocation,
} from '../../db/schema';

@Processor(MONITOR_SCHEDULER_QUEUE)
export class MonitorSchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(MonitorSchedulerProcessor.name);
  private static readonly COMPLETED_JOB_RETENTION = {
    count: 500,
    age: 24 * 3600,
  };
  private static readonly FAILED_JOB_RETENTION = {
    count: 1000,
    age: 7 * 24 * 3600,
  };

  constructor(
    @InjectQueue(MONITOR_EXECUTION_QUEUE)
    private readonly monitorExecutionQueue: Queue,
    @InjectQueue(MONITOR_QUEUES.US_EAST)
    private readonly monitorExecutionQueueUSEast: Queue,
    @InjectQueue(MONITOR_QUEUES.EU_CENTRAL)
    private readonly monitorExecutionQueueEUCentral: Queue,
    @InjectQueue(MONITOR_QUEUES.ASIA_PACIFIC)
    private readonly monitorExecutionQueueAsiaPacific: Queue,
    private readonly locationService: LocationService,
  ) {
    super();
    this.logger.log(
      'MonitorSchedulerProcessor instantiated - ready to process scheduled monitors',
    );
  }

  async process(
    job: Job<MonitorJobData, void, string>,
  ): Promise<{ success: boolean }> {
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
    // Multi-location monitoring is always enabled
    // Enqueue jobs to regional queues based on monitor's location config
    const monitorConfig =
      (jobData.config as MonitorConfig | undefined) ?? undefined;
    const locationConfig =
      (monitorConfig?.locationConfig as LocationConfig | null) ?? null;

    const effectiveLocations =
      this.locationService.getEffectiveLocations(locationConfig);
    const expectedLocations = Array.from(
      new Set(effectiveLocations),
    ) as MonitoringLocation[];

    // Create execution group ID for tracking related executions
    const executionGroupId = `${jobData.monitorId}-${Date.now()}-${crypto
      .randomBytes(4)
      .toString('hex')}`;

    await Promise.all(
      expectedLocations.map((location) => {
        // Select the appropriate regional queue based on location
        const queue = this.getQueueForLocation(location);

        return queue.add(
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
            removeOnComplete: MonitorSchedulerProcessor.COMPLETED_JOB_RETENTION,
            removeOnFail: MonitorSchedulerProcessor.FAILED_JOB_RETENTION,
            priority: 10,
          },
        );
      }),
    );
  }

  private getQueueForLocation(location: MonitoringLocation): Queue {
    switch (location) {
      case 'us-east':
        return this.monitorExecutionQueueUSEast;
      case 'eu-central':
        return this.monitorExecutionQueueEUCentral;
      case 'asia-pacific':
        return this.monitorExecutionQueueAsiaPacific;
      default:
        this.logger.warn(
          `Unknown location: ${location}, defaulting to us-east queue`,
        );
        return this.monitorExecutionQueueUSEast;
    }
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
