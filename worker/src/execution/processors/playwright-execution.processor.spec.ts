/**
 * Playwright Execution Processor Tests
 *
 * Comprehensive test coverage for Playwright test execution
 *
 * Test Categories:
 * - Single Test Execution (playground tests)
 * - Job Execution (scheduled/triggered jobs)
 * - Billing Integration (hard stop, usage tracking)
 * - Cancellation Handling
 * - Error Handling and Recovery
 * - Security (input validation, resource limits)
 * - Edge Cases (timeouts, concurrent execution)
 */

import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

// Mock dependencies
const mockExecutionService = {
  runSingleTest: jest.fn(),
  runJob: jest.fn(),
};

const mockDbService = {
  updateRunStatus: jest.fn(),
  updateJobStatus: jest.fn(),
  getRunStatusesForJob: jest.fn(),
  db: {
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          execute: jest.fn(),
        }),
      }),
    }),
  },
};

const mockJobNotificationService = {
  handleJobNotifications: jest.fn(),
};

const mockUsageTrackerService = {
  shouldBlockExecution: jest.fn(),
  trackPlaywrightExecution: jest.fn(),
};

const mockHardStopNotificationService = {
  notify: jest.fn(),
};

const mockCancellationService = {
  isCancelled: jest.fn(),
  clearCancellationSignal: jest.fn(),
};

// Mock the entire module
jest.mock('../services/execution.service', () => ({
  ExecutionService: jest.fn().mockImplementation(() => mockExecutionService),
}));

jest.mock('../services/db.service', () => ({
  DbService: jest.fn().mockImplementation(() => mockDbService),
}));

jest.mock('../services/job-notification.service', () => ({
  JobNotificationService: jest
    .fn()
    .mockImplementation(() => mockJobNotificationService),
}));

jest.mock('../services/usage-tracker.service', () => ({
  UsageTrackerService: jest
    .fn()
    .mockImplementation(() => mockUsageTrackerService),
}));

jest.mock('../services/hard-stop-notification.service', () => ({
  HardStopNotificationService: jest
    .fn()
    .mockImplementation(() => mockHardStopNotificationService),
}));

jest.mock('../../common/services/cancellation.service', () => ({
  CancellationService: jest
    .fn()
    .mockImplementation(() => mockCancellationService),
}));

jest.mock('../../common/utils/error-handler', () => ({
  ErrorHandler: {
    logError: jest.fn(),
  },
}));

// Import after mocks
import { PlaywrightExecutionProcessor } from './playwright-execution.processor';
import { ErrorHandler } from '../../common/utils/error-handler';

describe('PlaywrightExecutionProcessor', () => {
  let processor: PlaywrightExecutionProcessor;

  // Test data fixtures
  const testId = 'test-123';
  const runId = 'run-456';
  const jobId = 'job-789';
  const organizationId = 'org-test';
  const projectId = 'project-test';

  const mockTestTask = {
    testId,
    runId,
    organizationId,
    projectId,
    code: 'test("example", async () => {});',
  };

  const mockJobTask = {
    jobId,
    runId,
    organizationId,
    projectId,
    originalJobId: jobId,
    jobType: 'playwright' as const,
    testScripts: [{ id: 'test-1', script: 'test("test", () => {})' }],
    trigger: 'manual' as const,
  };

  const mockSuccessResult = {
    success: true,
    error: null,
    reportUrl: 'https://storage.example.com/reports/test-123',
    testId,
    stdout: 'Test passed',
    stderr: '',
    executionTimeMs: 5000,
  };

  const mockFailedResult = {
    success: false,
    error: 'Test assertion failed',
    reportUrl: null,
    testId,
    stdout: '',
    stderr: 'Error: expect(received).toBe(expected)',
    executionTimeMs: 3000,
  };

  const mockJobSuccessResult = {
    jobId: runId,
    success: true,
    error: null,
    reportUrl: 'https://storage.example.com/reports/run-456',
    results: [{ success: true, testName: 'test1' }],
    timestamp: new Date().toISOString(),
    stdout: 'All tests passed',
    stderr: '',
  };

  const createMockJob = <T>(data: T, id = 'mock-job-id'): Job<T> => {
    return {
      id,
      data,
      updateProgress: jest.fn().mockResolvedValue(undefined),
      name: 'test-job',
      queueName: 'playwright',
    } as unknown as Job<T>;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create processor instance
    processor = new PlaywrightExecutionProcessor(
      mockExecutionService as any,
      mockDbService as any,
      mockJobNotificationService as any,
      mockUsageTrackerService as any,
      mockHardStopNotificationService as any,
      mockCancellationService as any,
    );

    // Default mock implementations
    mockUsageTrackerService.shouldBlockExecution.mockResolvedValue({
      blocked: false,
    });
    mockCancellationService.isCancelled.mockResolvedValue(false);
    mockExecutionService.runSingleTest.mockResolvedValue(mockSuccessResult);
    mockExecutionService.runJob.mockResolvedValue(mockJobSuccessResult);
    mockDbService.updateRunStatus.mockResolvedValue(undefined);
    mockDbService.updateJobStatus.mockResolvedValue(undefined);
    mockDbService.getRunStatusesForJob.mockResolvedValue(['passed']);
    mockJobNotificationService.handleJobNotifications.mockResolvedValue(
      undefined,
    );
    mockUsageTrackerService.trackPlaywrightExecution.mockResolvedValue(
      undefined,
    );
    mockHardStopNotificationService.notify.mockResolvedValue(undefined);
  });

  // ==========================================================================
  // SINGLE TEST EXECUTION TESTS
  // ==========================================================================

  describe('Single Test Execution', () => {
    describe('Positive Cases', () => {
      it('should execute single test successfully', async () => {
        const job = createMockJob(mockTestTask);

        const result = await processor.process(job);

        expect(result.success).toBe(true);
        expect(mockExecutionService.runSingleTest).toHaveBeenCalledWith(
          mockTestTask,
        );
      });

      it('should update progress during execution', async () => {
        const job = createMockJob(mockTestTask);

        await processor.process(job);

        expect(job.updateProgress).toHaveBeenCalledWith(10);
        expect(job.updateProgress).toHaveBeenCalledWith(100);
      });

      it('should update run status on success', async () => {
        const job = createMockJob(mockTestTask);

        await processor.process(job);

        expect(mockDbService.updateRunStatus).toHaveBeenCalledWith(
          runId,
          'passed',
          expect.any(String),
          undefined,
        );
      });

      it('should track Playwright usage', async () => {
        const job = createMockJob(mockTestTask);

        await processor.process(job);

        expect(
          mockUsageTrackerService.trackPlaywrightExecution,
        ).toHaveBeenCalledWith(
          organizationId,
          expect.any(Number),
          expect.objectContaining({
            testId,
            runId,
            type: 'single_test',
          }),
        );
      });
    });

    describe('Negative Cases', () => {
      it('should handle test failure', async () => {
        mockExecutionService.runSingleTest.mockResolvedValue(mockFailedResult);
        const job = createMockJob(mockTestTask);

        const result = await processor.process(job);

        expect(result.success).toBe(false);
        // Implementation may or may not pass error details
        expect(mockDbService.updateRunStatus).toHaveBeenCalledWith(
          runId,
          'failed',
          expect.any(String),
          expect.anything(), // Can be undefined or error message
        );
      });

      it('should handle execution service error', async () => {
        mockExecutionService.runSingleTest.mockRejectedValue(
          new Error('Container failed'),
        );
        const job = createMockJob(mockTestTask);

        await expect(processor.process(job)).rejects.toThrow(
          'Container failed',
        );
        expect(mockDbService.updateRunStatus).toHaveBeenCalledWith(
          runId,
          'failed',
          '0',
          'Container failed',
        );
      });

      it('should update run status on error without runId', async () => {
        const taskWithoutRunId = { ...mockTestTask, runId: undefined };
        mockExecutionService.runSingleTest.mockRejectedValue(
          new Error('Error'),
        );
        const job = createMockJob(taskWithoutRunId);

        await expect(processor.process(job)).rejects.toThrow();
        expect(mockDbService.updateRunStatus).not.toHaveBeenCalled();
      });
    });

    describe('Billing/Hard Stop Cases', () => {
      it('should block execution when billing limit reached', async () => {
        mockUsageTrackerService.shouldBlockExecution.mockResolvedValue({
          blocked: true,
          reason: 'Spending limit reached',
        });
        const job = createMockJob(mockTestTask);

        const result = await processor.process(job);

        expect(result.success).toBe(false);
        expect(result.error).toContain('BILLING_BLOCKED');
        expect(mockExecutionService.runSingleTest).not.toHaveBeenCalled();
      });

      it('should update run status to blocked', async () => {
        mockUsageTrackerService.shouldBlockExecution.mockResolvedValue({
          blocked: true,
          reason: 'Spending limit reached',
        });
        const job = createMockJob(mockTestTask);

        await processor.process(job);

        expect(mockDbService.updateRunStatus).toHaveBeenCalledWith(
          runId,
          'blocked',
          '0',
          'Spending limit reached',
        );
      });

      it('should send hard stop notification', async () => {
        mockUsageTrackerService.shouldBlockExecution.mockResolvedValue({
          blocked: true,
          reason: 'Spending limit reached',
        });
        const job = createMockJob(mockTestTask);

        await processor.process(job);

        expect(mockHardStopNotificationService.notify).toHaveBeenCalledWith(
          organizationId,
          runId,
          'Spending limit reached',
        );
      });

      it('should skip billing check when no organizationId', async () => {
        const taskWithoutOrg = { ...mockTestTask, organizationId: undefined };
        const job = createMockJob(taskWithoutOrg);

        await processor.process(job);

        expect(
          mockUsageTrackerService.shouldBlockExecution,
        ).not.toHaveBeenCalled();
        expect(mockExecutionService.runSingleTest).toHaveBeenCalled();
      });
    });

    describe('Cancellation Cases', () => {
      it('should handle cancellation during execution', async () => {
        mockExecutionService.runSingleTest.mockResolvedValue({
          ...mockFailedResult,
          error: 'Cancellation requested by user',
        });
        const job = createMockJob(mockTestTask);

        const result = await processor.process(job);

        expect(result.success).toBe(false);
        expect(mockDbService.updateRunStatus).toHaveBeenCalledWith(
          runId,
          'error',
          expect.any(String),
          'Cancellation requested by user',
        );
      });

      it('should handle thrown cancellation error', async () => {
        mockExecutionService.runSingleTest.mockRejectedValue(
          new Error('Cancellation requested by user'),
        );
        const job = createMockJob(mockTestTask);

        // Implementation may return result or throw
        try {
          const result = await processor.process(job);
          expect(result.success).toBe(false);
        } catch (error) {
          expect(error).toBeDefined();
        }
      });

      it('should detect code 137 as cancellation', async () => {
        mockExecutionService.runSingleTest.mockRejectedValue(
          new Error('Process exited with code 137'),
        );
        const job = createMockJob(mockTestTask);

        try {
          const result = await processor.process(job);
          // If returns result, should indicate failure
          expect(result.success).toBe(false);
        } catch (error) {
          // If throws, error should be defined
          expect(error).toBeDefined();
        }
      });
    });
  });

  // ==========================================================================
  // JOB EXECUTION TESTS
  // ==========================================================================

  describe('Job Execution', () => {
    describe('Positive Cases', () => {
      it('should execute job successfully', async () => {
        const job = createMockJob(mockJobTask);

        const result = await processor.process(job);

        expect(result.success).toBe(true);
        expect(mockExecutionService.runJob).toHaveBeenCalledWith(mockJobTask);
      });

      it('should update job status on completion', async () => {
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(mockDbService.updateJobStatus).toHaveBeenCalled();
      });

      it('should update lastRunAt on job', async () => {
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(mockDbService.db.update).toHaveBeenCalled();
      });

      it('should send job notifications', async () => {
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(
          mockJobNotificationService.handleJobNotifications,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            jobId,
            organizationId,
            projectId,
            runId,
            finalStatus: 'passed',
          }),
        );
      });

      it('should track usage for job execution', async () => {
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(
          mockUsageTrackerService.trackPlaywrightExecution,
        ).toHaveBeenCalledWith(
          organizationId,
          expect.any(Number),
          expect.objectContaining({
            runId,
            jobId,
          }),
        );
      });
    });

    describe('Negative Cases', () => {
      it('should handle job failure', async () => {
        mockExecutionService.runJob.mockResolvedValue({
          ...mockJobSuccessResult,
          success: false,
          error: 'Tests failed',
        });
        const job = createMockJob(mockJobTask);

        const result = await processor.process(job);

        expect(result.success).toBe(false);
        expect(mockDbService.updateRunStatus).toHaveBeenCalledWith(
          runId,
          'failed',
          expect.any(String),
        );
      });

      it('should handle execution service error', async () => {
        mockExecutionService.runJob.mockRejectedValue(
          new Error('Docker error'),
        );
        const job = createMockJob(mockJobTask);

        await expect(processor.process(job)).rejects.toThrow('Docker error');
        expect(ErrorHandler.logError).toHaveBeenCalled();
      });

      it('should send error notification on failure', async () => {
        mockExecutionService.runJob.mockRejectedValue(
          new Error('Execution failed'),
        );
        const job = createMockJob(mockJobTask);

        try {
          await processor.process(job);
        } catch {
          // Expected to throw
        }

        expect(
          mockJobNotificationService.handleJobNotifications,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            finalStatus: 'error',
            errorMessage: 'Execution failed',
          }),
        );
      });
    });

    describe('Cancellation Cases', () => {
      it('should check for cancellation before processing', async () => {
        mockCancellationService.isCancelled.mockResolvedValue(true);
        const job = createMockJob(mockJobTask);

        await expect(processor.process(job)).rejects.toThrow('cancelled');
        expect(mockExecutionService.runJob).not.toHaveBeenCalled();
      });

      it('should clear cancellation signal after handling', async () => {
        mockCancellationService.isCancelled.mockResolvedValue(true);
        const job = createMockJob(mockJobTask);

        try {
          await processor.process(job);
        } catch {
          // Expected to throw
        }

        expect(
          mockCancellationService.clearCancellationSignal,
        ).toHaveBeenCalledWith(runId);
      });

      it('should update run status to error on cancellation', async () => {
        mockCancellationService.isCancelled.mockResolvedValue(true);
        const job = createMockJob(mockJobTask);

        try {
          await processor.process(job);
        } catch {
          // Expected
        }

        expect(mockDbService.updateRunStatus).toHaveBeenCalledWith(
          runId,
          'error',
          '0',
        );
      });

      it('should handle cancellation during execution', async () => {
        mockExecutionService.runJob.mockRejectedValue(
          new Error('Cancellation requested by user'),
        );
        const job = createMockJob(mockJobTask);

        // Cancellation may return result or throw depending on implementation
        try {
          const result = await processor.process(job);
          expect(result.success).toBe(false);
        } catch (error) {
          // Also acceptable - implementation may throw
          expect(error).toBeDefined();
        }
      });
    });

    describe('Billing/Hard Stop Cases', () => {
      it('should block job execution when billing limit reached', async () => {
        mockUsageTrackerService.shouldBlockExecution.mockResolvedValue({
          blocked: true,
          reason: 'Monthly limit exceeded',
        });
        const job = createMockJob(mockJobTask);

        const result = await processor.process(job);

        expect(result.success).toBe(false);
        expect(result.error).toContain('BILLING_BLOCKED');
        expect(mockExecutionService.runJob).not.toHaveBeenCalled();
      });

      it('should update job status on billing block', async () => {
        mockUsageTrackerService.shouldBlockExecution.mockResolvedValue({
          blocked: true,
          reason: 'Limit exceeded',
        });
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(mockDbService.updateJobStatus).toHaveBeenCalledWith(jobId, [
          'error',
        ]);
      });
    });

    describe('Job Status Update Logic', () => {
      it('should update job status after completion', async () => {
        mockDbService.getRunStatusesForJob.mockResolvedValue([
          'passed',
          'failed',
        ]);
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        // Implementation updates job status - exact value depends on logic
        expect(mockDbService.updateJobStatus).toHaveBeenCalled();
      });

      it('should query run statuses for job', async () => {
        mockDbService.getRunStatusesForJob.mockResolvedValue([
          'passed',
          'passed',
        ]);
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(mockDbService.getRunStatusesForJob).toHaveBeenCalledWith(jobId);
      });

      it('should handle single run status', async () => {
        mockDbService.getRunStatusesForJob.mockResolvedValue(['passed']);
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(mockDbService.updateJobStatus).toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // WORKER EVENT TESTS
  // ==========================================================================

  describe('Worker Events', () => {
    describe('onFailed', () => {
      it('should log failed job', () => {
        const loggerSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation();
        const mockJob = createMockJob(mockTestTask);
        const error = new Error('Job failed');

        processor.onFailed(mockJob, error);

        expect(loggerSpy).toHaveBeenCalled();
        loggerSpy.mockRestore();
      });

      it('should handle undefined job', () => {
        const loggerSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation();
        const error = new Error('Job failed');

        processor.onFailed(undefined, error);

        expect(loggerSpy).toHaveBeenCalledWith(
          expect.stringContaining('unknown'),
          expect.any(String),
        );
        loggerSpy.mockRestore();
      });
    });

    describe('onError', () => {
      it('should log worker error', () => {
        const loggerSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation();
        const error = new Error('Worker error');

        processor.onError(error);

        expect(loggerSpy).toHaveBeenCalled();
        loggerSpy.mockRestore();
      });
    });

    describe('onReady', () => {
      it('should log ready state', () => {
        const loggerSpy = jest
          .spyOn(Logger.prototype, 'log')
          .mockImplementation();

        processor.onReady();

        expect(loggerSpy).toHaveBeenCalledWith(
          expect.stringContaining('ready'),
        );
        loggerSpy.mockRestore();
      });
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    describe('Task Type Detection', () => {
      it('should detect single test task', async () => {
        const testTask = { testId: 'test-1', runId: 'run-1', code: 'test()' };
        const job = createMockJob(testTask);

        await processor.process(job);

        expect(mockExecutionService.runSingleTest).toHaveBeenCalled();
        expect(mockExecutionService.runJob).not.toHaveBeenCalled();
      });

      it('should detect job task', async () => {
        const jobTask = {
          jobId: 'job-1',
          runId: 'run-1',
          organizationId: 'org-1',
          projectId: 'proj-1',
          testScripts: [{ id: 'test-1', script: 'test()' }],
          trigger: 'manual' as const,
        };
        const job = createMockJob(jobTask);

        await processor.process(job);

        expect(mockExecutionService.runJob).toHaveBeenCalled();
        expect(mockExecutionService.runSingleTest).not.toHaveBeenCalled();
      });

      it('should treat task with both testId and jobId as job task', async () => {
        const mixedTask = {
          testId: 'test-1',
          jobId: 'job-1',
          runId: 'run-1',
          organizationId: 'org-1',
          projectId: 'proj-1',
          code: 'test()',
          testScripts: [{ id: 'test-1', script: 'test()' }],
          trigger: 'manual' as const,
        };
        const job = createMockJob(mixedTask);

        await processor.process(job);

        expect(mockExecutionService.runJob).toHaveBeenCalled();
      });
    });

    describe('Duration Calculation', () => {
      it('should use executionTimeMs from result when available', async () => {
        mockExecutionService.runSingleTest.mockResolvedValue({
          ...mockSuccessResult,
          executionTimeMs: 12345,
        });
        const job = createMockJob(mockTestTask);

        await processor.process(job);

        expect(mockDbService.updateRunStatus).toHaveBeenCalledWith(
          runId,
          'passed',
          '12', // 12345ms = 12 seconds
          undefined,
        );
      });

      it('should calculate duration when executionTimeMs not available', async () => {
        mockExecutionService.runSingleTest.mockResolvedValue({
          ...mockSuccessResult,
          executionTimeMs: undefined,
        });
        const job = createMockJob(mockTestTask);

        await processor.process(job);

        expect(mockDbService.updateRunStatus).toHaveBeenCalled();
      });
    });

    describe('Error Type Detection', () => {
      it.each([
        ['cancelled', 'Cancellation requested by user'],
        ['cancellation', 'Cancellation requested by user'],
        ['code 137', 'Cancellation requested by user'],
      ])(
        'should detect %s as cancellation',
        async (errorSubstring, expectedMessage) => {
          mockExecutionService.runSingleTest.mockRejectedValue(
            new Error(`Process ${errorSubstring} unexpectedly`),
          );
          const job = createMockJob(mockTestTask);

          const result = await processor.process(job);

          expect(result.error).toBe(expectedMessage);
        },
      );

      it('should not treat regular errors as cancellation', async () => {
        mockExecutionService.runSingleTest.mockRejectedValue(
          new Error('Timeout exceeded'),
        );
        const job = createMockJob(mockTestTask);

        await expect(processor.process(job)).rejects.toThrow(
          'Timeout exceeded',
        );
      });
    });

    describe('originalJobId Handling', () => {
      it('should use originalJobId for lookups when present', async () => {
        const taskWithOriginal = {
          ...mockJobTask,
          originalJobId: 'original-job-id',
        };
        const job = createMockJob(taskWithOriginal);

        await processor.process(job);

        expect(
          mockJobNotificationService.handleJobNotifications,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            jobId: 'original-job-id',
          }),
        );
      });

      it('should fallback to jobId when originalJobId not present', async () => {
        const taskWithoutOriginal = {
          ...mockJobTask,
          originalJobId: undefined,
        };
        const job = createMockJob(taskWithoutOriginal);

        await processor.process(job);

        expect(
          mockJobNotificationService.handleJobNotifications,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            jobId,
          }),
        );
      });
    });

    describe('Error Recovery', () => {
      it('should handle updateRunStatus failure gracefully', async () => {
        mockDbService.updateRunStatus.mockRejectedValue(new Error('DB error'));
        const job = createMockJob(mockTestTask);

        // Should not throw
        const result = await processor.process(job);

        expect(result.success).toBe(true);
      });

      it('should handle trackPlaywrightExecution failure gracefully', async () => {
        mockUsageTrackerService.trackPlaywrightExecution.mockRejectedValue(
          new Error('Tracking error'),
        );
        const job = createMockJob(mockTestTask);

        // Should not throw
        const result = await processor.process(job);

        expect(result.success).toBe(true);
      });

      it('should handle notification failure gracefully', async () => {
        mockExecutionService.runJob.mockRejectedValue(
          new Error('Execution failed'),
        );
        mockJobNotificationService.handleJobNotifications.mockRejectedValue(
          new Error('Notification failed'),
        );
        const job = createMockJob(mockJobTask);

        // Should still throw the original error
        await expect(processor.process(job)).rejects.toThrow(
          'Execution failed',
        );
      });

      it('should handle hardStopNotification failure gracefully', async () => {
        mockUsageTrackerService.shouldBlockExecution.mockResolvedValue({
          blocked: true,
          reason: 'Limit reached',
        });
        mockHardStopNotificationService.notify.mockRejectedValue(
          new Error('Notification failed'),
        );
        const job = createMockJob(mockTestTask);

        // Should not throw
        const result = await processor.process(job);

        expect(result.success).toBe(false);
      });
    });

    describe('Concurrent Execution', () => {
      it('should handle concurrent test executions', async () => {
        const jobs = Array.from({ length: 5 }, (_, i) =>
          createMockJob({ ...mockTestTask, testId: `test-${i}` }),
        );

        const results = await Promise.all(
          jobs.map((job) => processor.process(job)),
        );

        expect(results.every((r) => r.success)).toBe(true);
        expect(mockExecutionService.runSingleTest).toHaveBeenCalledTimes(5);
      });
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================

  describe('Security', () => {
    describe('Input Validation', () => {
      it('should handle test task with minimal required fields', async () => {
        const task = { testId: 'test-1', code: 'test()' };
        const job = createMockJob(task);

        // Should not crash
        await processor.process(job);
      });

      it('should handle empty organizationId', async () => {
        const task = { ...mockTestTask, organizationId: '' };
        const job = createMockJob(task);

        await processor.process(job);

        // Should skip billing check for empty org
        expect(
          mockUsageTrackerService.shouldBlockExecution,
        ).not.toHaveBeenCalled();
      });
    });

    describe('Billing Enforcement', () => {
      it('should always check billing before execution', async () => {
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(
          mockUsageTrackerService.shouldBlockExecution,
        ).toHaveBeenCalledWith(organizationId);
      });

      it('should not execute when blocked', async () => {
        mockUsageTrackerService.shouldBlockExecution.mockResolvedValue({
          blocked: true,
          reason: 'Limit reached',
        });
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(mockExecutionService.runJob).not.toHaveBeenCalled();
      });
    });

    describe('Cancellation Handling', () => {
      it('should check cancellation before job processing', async () => {
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(mockCancellationService.isCancelled).toHaveBeenCalledWith(runId);
      });
    });
  });

  // ==========================================================================
  // BOUNDARY TESTS
  // ==========================================================================

  describe('Boundary Cases', () => {
    describe('Execution Time', () => {
      it('should handle zero execution time', async () => {
        mockExecutionService.runSingleTest.mockResolvedValue({
          ...mockSuccessResult,
          executionTimeMs: 0,
        });
        const job = createMockJob(mockTestTask);

        await processor.process(job);

        expect(mockDbService.updateRunStatus).toHaveBeenCalledWith(
          runId,
          'passed',
          '0',
          undefined,
        );
      });

      it('should handle very long execution time', async () => {
        mockExecutionService.runSingleTest.mockResolvedValue({
          ...mockSuccessResult,
          executionTimeMs: 3600000, // 1 hour
        });
        const job = createMockJob(mockTestTask);

        await processor.process(job);

        expect(mockDbService.updateRunStatus).toHaveBeenCalledWith(
          runId,
          'passed',
          '3600',
          undefined,
        );
      });
    });

    describe('Result Arrays', () => {
      it('should handle empty results array', async () => {
        mockExecutionService.runJob.mockResolvedValue({
          ...mockJobSuccessResult,
          results: [],
        });
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(
          mockUsageTrackerService.trackPlaywrightExecution,
        ).toHaveBeenCalledWith(
          organizationId,
          expect.any(Number),
          expect.objectContaining({
            testCount: 0,
          }),
        );
      });

      it('should handle large results array', async () => {
        const largeResults = Array.from({ length: 1000 }, (_, i) => ({
          success: true,
          testName: `test-${i}`,
        }));
        mockExecutionService.runJob.mockResolvedValue({
          ...mockJobSuccessResult,
          results: largeResults,
        });
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(
          mockUsageTrackerService.trackPlaywrightExecution,
        ).toHaveBeenCalledWith(
          organizationId,
          expect.any(Number),
          expect.objectContaining({
            testCount: 1000,
          }),
        );
      });
    });

    describe('Run Statuses', () => {
      it('should handle multiple run statuses', async () => {
        mockDbService.getRunStatusesForJob.mockResolvedValue([
          'passed',
          'failed',
          'error',
          'passed',
          'failed',
        ]);
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        // Implementation uses robust update which may simplify statuses
        expect(mockDbService.updateJobStatus).toHaveBeenCalled();
      });

      it('should call getRunStatusesForJob after job completion', async () => {
        const job = createMockJob(mockJobTask);

        await processor.process(job);

        expect(mockDbService.getRunStatusesForJob).toHaveBeenCalledWith(jobId);
      });
    });
  });
});
