import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { TEST_EXECUTION_QUEUE } from '../constants';
import { ExecutionService } from '../services/execution.service';
import { TestExecutionTask, TestResult } from '../interfaces';
import { createSpanWithContext } from '../../observability/trace-helpers';

@Processor(TEST_EXECUTION_QUEUE)
export class TestExecutionProcessor extends WorkerHost {
  private readonly logger = new Logger(TestExecutionProcessor.name);

  constructor(private readonly executionService: ExecutionService) {
    super();
    this.logger.log(`[Constructor] TestExecutionProcessor instantiated.`);
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    // Removed log - only log errors and completion
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, result: unknown) {
    // Only log completion summary, not full result
    const testResult = result as any;
    const status = testResult?.success ? 'passed' : 'failed';
    this.logger.log(`Test ${job.id} completed: ${status}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const jobId = job?.id || 'unknown';
    this.logger.error(
      `[Event:failed] Job ${jobId} failed with error: ${error.message}`,
      error.stack,
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error) {
    this.logger.error(
      `[Event:error] Worker encountered an error: ${error.message}`,
      error.stack,
    );
  }

  @OnWorkerEvent('ready')
  onReady() {
    // Removed log - only log errors and completion
  }

  async process(job: Job<TestExecutionTask>): Promise<TestResult> {
    const testId = job.data.testId;
    const runId = job.data.runId ?? job.id?.toString();
    const spanContext = {
      runType: 'playwright_test' as const,
      runId,
      testId,
      testName: job.data.testName,
      projectId: job.data.projectId,
      organizationId: job.data.organizationId,
    };

    return createSpanWithContext(
      `Trace ${testId?.substring(0, 8) ?? runId?.substring(0, 8)}`,
      spanContext,
      async (span) => {
        span.setAttribute('sc.execution_type', 'playwright_test');
        span.setAttribute('sc.test_id', testId ?? '');
        const startTime = new Date();

        try {
          await job.updateProgress(10);

          // Delegate the actual execution to the service
          const result = await this.executionService.runSingleTest(job.data);

          // Calculate execution duration
          const endTime = new Date();
          const durationMs = endTime.getTime() - startTime.getTime();
          const durationSeconds = Math.floor(durationMs / 1000);

          await job.updateProgress(100);
          // Logging moved to onCompleted event handler

          // The result object (TestResult) from the service is returned
          return result;
        } catch (error) {
          this.logger.error(
            `[${testId}] Test execution job ID: ${job.id} failed. Error: ${(error as Error).message}`,
            (error as Error).stack,
          );
          await job.updateProgress(100);
          throw error instanceof Error ? error : new Error(String(error));
        }
      },
    );
  }
}
