import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { MonitorJobDataDto } from './dto/monitor-job.dto';
import { EXECUTE_MONITOR_JOB_NAME } from './monitor.constants';
import { MonitorExecutionResult } from './types/monitor-result.type';

/**
 * Base class for monitor processors.
 * Regional processors extend this and add their own @Processor decorator.
 * This class has no decorator - it's not registered directly with BullMQ.
 */
export abstract class MonitorProcessor extends WorkerHost {
  protected readonly logger: Logger;

  constructor(protected readonly monitorService: MonitorService) {
    super();
    this.logger = new Logger(this.getLoggerName());
  }

  /**
   * Override this method in subclasses to customize the logger name.
   * This provides a clean pattern for regional processors to have distinct log namespaces.
   */
  protected getLoggerName(): string {
    return MonitorProcessor.name;
  }

  async process(
    job: Job<MonitorJobDataDto, MonitorExecutionResult[], string>,
  ): Promise<MonitorExecutionResult[]> {
    if (job.name === EXECUTE_MONITOR_JOB_NAME) {
      const jobLocation = job.data.executionLocation;

      if (jobLocation) {
        // Execute for specific location
        const result = await this.monitorService.executeMonitor(
          job.data,
          jobLocation,
        );

        if (!result) {
          return [];
        }

        // Save distributed result
        await this.monitorService.saveDistributedMonitorResult(result, {
          executionGroupId: job.data.executionGroupId,
          expectedLocations: job.data.expectedLocations,
        });

        return [result];
      }

      // Execute monitor from configured locations (legacy/single queue mode)
      return this.monitorService.executeMonitorWithLocations(job.data);
    }

    this.logger.warn(
      `Unknown job name: ${job.name} for job ID: ${job.id}. Throwing error.`,
    );
    throw new Error(`Unknown job name: ${job.name}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, results: MonitorExecutionResult[]) {
    // In distributed mode (regional queues), results are saved individually in process()
    // We only need to save here if it was a multi-location execution (legacy)
    if (job.data.executionLocation) {
      return;
    }

    // Save all location results with aggregation (legacy/local mode)
    if (results && results.length > 0) {
      const syntheticResults = results.filter((r) => r.testExecutionId);
      if (syntheticResults.length > 0) {
        this.logger.log(
          `[PROCESSOR] Saving ${syntheticResults.length} synthetic test result(s) from ${results.length} location(s)`,
        );
      }
      // Use .catch() instead of void to ensure errors are logged
      this.monitorService.saveMonitorResults(results).catch((error) => {
        this.logger.error(
          `Failed to save monitor results for legacy/local mode: ${error.message}`,
          error.stack,
        );
      });
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
}

@Processor('monitor-us-east')
export class MonitorProcessorUSEast extends MonitorProcessor {
  constructor(monitorService: MonitorService) {
    super(monitorService);
  }

  protected override getLoggerName(): string {
    return MonitorProcessorUSEast.name;
  }
}

@Processor('monitor-eu-central')
export class MonitorProcessorEUCentral extends MonitorProcessor {
  constructor(monitorService: MonitorService) {
    super(monitorService);
  }

  protected override getLoggerName(): string {
    return MonitorProcessorEUCentral.name;
  }
}

@Processor('monitor-asia-pacific')
export class MonitorProcessorAsiaPacific extends MonitorProcessor {
  constructor(monitorService: MonitorService) {
    super(monitorService);
  }

  protected override getLoggerName(): string {
    return MonitorProcessorAsiaPacific.name;
  }
}
