import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { MonitorJobDataDto } from './dto/monitor-job.dto';
import {
  MONITOR_EXECUTION_QUEUE,
  EXECUTE_MONITOR_JOB_NAME,
  IS_DISTRIBUTED_MULTI_LOCATION,
  WORKER_LOCATION,
} from './monitor.constants';
import { MonitorExecutionResult } from './types/monitor-result.type';

@Processor(MONITOR_EXECUTION_QUEUE)
export class MonitorProcessor extends WorkerHost {
  private readonly logger = new Logger(MonitorProcessor.name);

  constructor(
    private readonly monitorService: MonitorService,
    @InjectQueue(MONITOR_EXECUTION_QUEUE)
    private readonly monitorExecutionQueue: Queue,
  ) {
    super();
  }

  async process(
    job: Job<MonitorJobDataDto, MonitorExecutionResult[], string>,
  ): Promise<MonitorExecutionResult[]> {
    if (job.name === EXECUTE_MONITOR_JOB_NAME) {
      if (IS_DISTRIBUTED_MULTI_LOCATION) {
        return this.handleDistributedMonitorJob(job);
      }
      // Execute monitor from configured locations (single or multiple)
      return this.monitorService.executeMonitorWithLocations(job.data);
    }

    this.logger.warn(
      `Unknown job name: ${job.name} for job ID: ${job.id}. Throwing error.`,
    );
    throw new Error(`Unknown job name: ${job.name}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, results: MonitorExecutionResult[]) {
    if (IS_DISTRIBUTED_MULTI_LOCATION) {
      return;
    }
    // Save all location results with aggregation
    if (results && results.length > 0) {
      // Debug: Log synthetic test results if present
      const syntheticResults = results.filter((r) => r.testExecutionId);
      if (syntheticResults.length > 0) {
        this.logger.log(
          `[PROCESSOR] Saving ${syntheticResults.length} synthetic test result(s) from ${results.length} location(s)`,
        );
      }
      void this.monitorService.saveMonitorResults(results);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(
    job: Job<MonitorJobDataDto, MonitorExecutionResult, string> | undefined,
    err: Error,
  ) {
    const monitorId = (job?.data as any)?.monitorId || 'unknown_monitor';
    this.logger.error(
      `Job ${job?.id} (monitor ${monitorId}) has failed with error: ${err.message}`,
      err.stack,
    );
  }

  @OnWorkerEvent('progress')
  onProgress(
    job: Job<MonitorJobDataDto, MonitorExecutionResult, string>,
    progress: number | object,
  ) {
    // Removed log - progress updates are too verbose
  }

  private async handleDistributedMonitorJob(
    job: Job<MonitorJobDataDto, MonitorExecutionResult[], string>,
  ): Promise<MonitorExecutionResult[]> {
    const jobLocation = job.data.executionLocation;

    if (!jobLocation) {
      return this.monitorService.executeMonitorWithLocations(job.data);
    }

    if (WORKER_LOCATION && WORKER_LOCATION !== jobLocation) {
      await this.requeueJobForLocation(job, jobLocation);
      return [];
    }

    const result = await this.monitorService.executeMonitor(
      job.data,
      jobLocation,
    );

    if (!result) {
      return [];
    }

    await this.monitorService.saveDistributedMonitorResult(result, {
      executionGroupId: job.data.executionGroupId,
      expectedLocations: job.data.expectedLocations,
    });

    return [result];
  }

  private async requeueJobForLocation(
    job: Job<MonitorJobDataDto, MonitorExecutionResult[], string>,
    targetLocation: string,
  ): Promise<void> {
    const { attempts, backoff, removeOnComplete, removeOnFail, priority } =
      job.opts;

    try {
      await this.monitorExecutionQueue.add(job.name, job.data, {
        jobId: `${job.id}:${targetLocation}:${Date.now()}`,
        attempts: attempts ?? 3,
        backoff,
        removeOnComplete,
        removeOnFail,
        priority,
        delay: 1000,
      });
    } catch (error) {
      this.logger.error(
        `Failed to requeue monitor job ${job.id} for location ${targetLocation}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    try {
      await job.remove();
    } catch (removeError) {
      this.logger.error(
        `Failed to remove monitor job ${job.id} after requeue`,
        removeError instanceof Error ? removeError.stack : String(removeError),
      );
    }
  }
}
