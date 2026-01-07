import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { S3Service } from './s3.service';
import { DbService } from './db.service';
import { RedisService } from './redis.service';
import { ReportUploadService } from '../../common/services/report-upload.service';
import { ContainerExecutorService } from '../../common/security/container-executor.service';
import { CancellationService } from '../../common/services/cancellation.service';
import { RequirementCoverageService } from './requirement-coverage.service';
import { findFirstFileByNames } from '../../common/utils/file-search';
import {
  TestResult,
  TestExecutionResult,
  TestExecutionTask,
  JobExecutionTask,
} from '../interfaces';

// Helper function to check if running on Windows
export const isWindows = process.platform === 'win32';

// Gets the content type based on file extension (simple version)
export function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html';
    case '.css':
      return 'text/css';
    case '.js':
      return 'application/javascript';
    case '.json':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Ensures the generated test has proper trace configuration
 * This helps prevent issues with trace file paths in parallel job executions
 */
export function ensureProperTraceConfiguration(
  testScript: string,
  testId?: string,
): string {
  // Handle undefined or null testScript
  if (!testScript || typeof testScript !== 'string') {
    console.error(
      `[ensureProperTraceConfiguration] Invalid testScript provided for test ${testId}: ${testScript}`,
    );
    throw new Error(`Test script is undefined or invalid for test ${testId}`);
  }

  // Use a unique trace directory based on testId to prevent conflicts in parallel execution
  const traceDir = testId
    ? `./trace-${testId.substr(0, 8)}`
    : `./trace-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  // Add proper trace configuration if it doesn't exist
  if (!testScript.includes('context.tracing.start')) {
    // Look for browser setup pattern
    const browserSetupRegex =
      /(const\s+browser\s*=\s*await\s+chromium\.launch[\s\S]*?;)/;
    if (browserSetupRegex.test(testScript)) {
      return testScript.replace(
        browserSetupRegex,
        `$1\n\n  // Ensure traces are saved to a unique location to prevent conflicts during parallel execution\n  const context = await browser.newContext();\n  await context.tracing.start({ screenshots: true, snapshots: true, dir: '${traceDir}' });\n`,
      );
    }
  }

  // If script already includes tracing but without a custom directory, add the directory
  if (
    testScript.includes('context.tracing.start') &&
    !testScript.includes('dir:')
  ) {
    return testScript.replace(
      /(await\s+context\.tracing\.start\s*\(\s*\{[^}]*)\}/,
      `$1, dir: '${traceDir}'}`,
    );
  }

  return testScript;
}

// Interface defining the result from the internal _executePlaywright function
interface PlaywrightExecutionResult {
  success: boolean;
  error: string | null;
  stdout: string;
  stderr: string;
  executionTimeMs?: number; // Actual execution time in milliseconds
}

@Injectable()
export class ExecutionService implements OnModuleDestroy {
  private readonly logger = new Logger(ExecutionService.name);
  private readonly testExecutionTimeoutMs: number;
  private readonly jobExecutionTimeoutMs: number;
  private readonly playwrightConfigPath: string;

  /**
   * Maximum concurrent executions per worker instance.
   *
   * ARCHITECTURE DECISION: This is hardcoded to 1 because:
   *
   * 1. HORIZONTAL SCALING: We scale by adding more worker replicas (WORKER_REPLICAS=2)
   *    rather than running multiple executions in a single worker. This provides:
   *    - Better resource isolation (each test gets dedicated CPU/memory)
   *    - Simpler failure handling (one test failure doesn't affect others)
   *    - More predictable performance (no resource contention)
   *
   * 2. CONTAINER RESOURCES: Each test container uses 1.5 CPU and 2GB RAM
   *    (default for 2 vCPU / 4GB servers). Running multiple Playwright
   *    instances in parallel would cause:
   *    - Memory pressure and OOM kills
   *    - CPU contention affecting test reliability
   *    - Video/trace recording failures
   *
   * 3. PLAYWRIGHT PARALLELIZATION: Playwright's --workers flag controls test-level
   *    parallelism WITHIN a single execution. We use 1 worker (see playwright.config.js)
   *    which is optimal for 2GB container. For faster execution on larger servers,
   *    set PLAYWRIGHT_WORKERS=2 and increase container resources.
   *
   * To increase capacity: docker compose up -d --scale worker=4 (not this value)
   */
  private readonly maxConcurrentExecutions = 1;

  private readonly containerCpuLimit: number;
  private readonly containerMemoryLimitMb: number;
  private readonly memoryThresholdMB = 2048; // 2GB memory threshold (matches container limit)
  private activeExecutions: Map<
    string,
    {
      pid?: number;
      startTime: number;
      memoryUsage: number;
      countsTowardsLimit: boolean;
    }
  > = new Map();
  private memoryCleanupInterval: NodeJS.Timeout;
  private readonly gcInterval: NodeJS.Timeout;

  constructor(
    private configService: ConfigService,
    private s3Service: S3Service,
    private dbService: DbService,
    private redisService: RedisService,
    private reportUploadService: ReportUploadService,
    private containerExecutorService: ContainerExecutorService,
    private cancellationService: CancellationService,
    private requirementCoverageService: RequirementCoverageService,
  ) {
    // Set timeouts: configurable via env vars with sensible defaults
    // Note: Environment variables are always strings, so we must parse them as numbers
    const testTimeoutEnv = this.configService.get<string>(
      'TEST_EXECUTION_TIMEOUT_MS',
    );
    this.testExecutionTimeoutMs = testTimeoutEnv
      ? parseInt(testTimeoutEnv, 10)
      : 5 * 60 * 1000; // 5 minutes default

    const jobTimeoutEnv = this.configService.get<string>(
      'JOB_EXECUTION_TIMEOUT_MS',
    );
    this.jobExecutionTimeoutMs = jobTimeoutEnv
      ? parseInt(jobTimeoutEnv, 10)
      : 60 * 60 * 1000; // 1 hour default

    // Container resource limits (configurable for different deployment environments)
    // Defaults for 2 vCPU / 4GB servers:
    // - Container gets 1.5 CPU, 2GB RAM
    // - Leaves 0.5 CPU, 2GB RAM for worker process + OS
    this.containerCpuLimit = parseFloat(
      this.configService.get<string>('CONTAINER_CPU_LIMIT', '1.5'),
    );
    this.containerMemoryLimitMb = parseInt(
      this.configService.get<string>('CONTAINER_MEMORY_LIMIT_MB', '2048'),
      10,
    );

    // Determine Playwright config path
    const configPath = path.join(process.cwd(), 'playwright.config.js');
    if (!existsSync(configPath)) {
      this.logger.warn(
        'playwright.config.js not found at project root. Playwright might use defaults or fail.',
      );
      // Consider throwing an error if config is mandatory
    }
    this.playwrightConfigPath = configPath;

    // Container-only execution: No host directories needed for test files
    // Test scripts are passed inline to containers
    // Reports are written to /tmp inside containers and extracted via docker cp
    this.logger.log(
      `Execution mode: Container-only (no host filesystem dependencies)`,
    );
    this.logger.log(
      `Test execution timeout set to: ${this.testExecutionTimeoutMs}ms (${this.testExecutionTimeoutMs / 1000}s)`,
    );
    this.logger.log(
      `Job execution timeout set to: ${this.jobExecutionTimeoutMs}ms (${this.jobExecutionTimeoutMs / 1000}s)`,
    );
    this.logger.log(
      `Using Playwright config (relative): ${path.relative(process.cwd(), this.playwrightConfigPath)}`,
    );

    // Log configuration
    this.logger.log(
      `Concurrent executions per worker: ${this.maxConcurrentExecutions} (scale via WORKER_REPLICAS, not this value)`,
    );
    this.logger.log(
      `Container limits: CPU=${this.containerCpuLimit}, Memory=${this.containerMemoryLimitMb}MB`,
    );
    this.logger.log(`Memory threshold: ${this.memoryThresholdMB}MB`);

    // Container-only execution: No base directory setup required

    // Setup basic memory monitoring
    this.setupMemoryMonitoring();
  }

  /**
   * Counts how many executions currently consume concurrency slots.
   */
  private getActiveConcurrencyCount(): number {
    let count = 0;
    for (const execution of this.activeExecutions.values()) {
      if (execution.countsTowardsLimit !== false) {
        count++;
      }
    }
    return count;
  }

  /**
   * Sets up optimized memory monitoring for reduced CPU usage
   */
  private setupMemoryMonitoring(): void {
    // Reduced frequency memory monitoring - only when needed
    this.memoryCleanupInterval = setInterval(() => {
      // Only monitor if we have active executions
      if (this.activeExecutions.size > 0) {
        this.monitorActiveExecutions();
        void this.performMemoryCleanup();
      }
    }, 300000); // Every 5 minutes instead of 2

    // Less aggressive garbage collection
    if (global.gc) {
      setInterval(() => {
        const memUsage = process.memoryUsage();
        const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);

        // Only run GC if memory is critically high and we have active executions
        if (
          memUsageMB > this.memoryThresholdMB * 0.9 &&
          this.activeExecutions.size > 0
        ) {
          global.gc?.();
          this.logger.debug(`Manual GC triggered at ${memUsageMB}MB`);
        }
      }, 600000); // Every 10 minutes instead of 5
    }
  }

  /**
   * Monitors active executions and cleans up stale ones - optimized for lower CPU usage
   */
  private monitorActiveExecutions(): void {
    const now = Date.now();
    const staleTimeout = 30 * 60 * 1000; // 30 minutes

    // Only process if we have executions to monitor
    if (this.activeExecutions.size === 0) {
      return;
    }

    for (const [executionId, execution] of this.activeExecutions.entries()) {
      const runtime = now - execution.startTime;

      if (runtime > staleTimeout) {
        this.logger.warn(
          `Cleaning up stale execution ${executionId} after ${runtime}ms`,
        );

        // Just remove from tracking, don't kill processes
        this.activeExecutions.delete(executionId);
      }
    }

    // Only check memory usage if we have active executions
    const memUsage = process.memoryUsage();
    const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);

    // Only log warnings if memory is critically high
    if (memUsageMB > this.memoryThresholdMB * 1.1) {
      this.logger.warn(
        `Critical memory usage detected: ${memUsageMB}MB (threshold: ${this.memoryThresholdMB}MB)`,
      );
    }

    // Reduce debug logging frequency
    if (this.activeExecutions.size > 0) {
      this.logger.debug(
        `Active executions: ${this.activeExecutions.size}, Memory: ${memUsageMB}MB`,
      );
    }
  }

  /**
   * Performs optimized memory monitoring - only when needed
   * Note: Local file cleanup removed - execution now runs in containers
   */
  private async performMemoryCleanup(): Promise<void> {
    try {
      const memUsage = process.memoryUsage();
      const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      // Reduced logging frequency
      if (memUsageMB > this.memoryThresholdMB * 0.9) {
        this.logger.debug(`Memory usage: ${memUsageMB}MB`);
      }
    } catch (error) {
      this.logger.error(
        `Error during memory monitoring: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Runs a single test defined by the task data.
   * Container-only execution: No host filesystem dependencies
   */
  async runSingleTest(
    task: TestExecutionTask,
    bypassConcurrencyCheck = false,
    isMonitorExecution = false,
  ): Promise<TestResult> {
    const { testId, code } = task;

    // Check concurrency limits (unless bypassed for monitors)
    if (
      !bypassConcurrencyCheck &&
      this.getActiveConcurrencyCount() >= this.maxConcurrentExecutions
    ) {
      throw new Error(
        `Maximum concurrent executions limit reached: ${this.maxConcurrentExecutions}`,
      );
    }

    this.logger.log(
      `[${testId}] Starting single test execution (container-only).`,
    );

    // Generate unique ID for this run to avoid conflicts in parallel executions
    const uniqueRunId = `${testId}-${crypto.randomUUID().substring(0, 8)}`;
    // For monitor executions, use uniqueRunId to preserve historical reports and separate bucket
    // For regular test execution, use testId to maintain existing behavior (overwrite previous report)
    const executionId = isMonitorExecution ? uniqueRunId : testId;
    const s3ReportKeyPrefix = `${executionId}/report`;
    const entityType = isMonitorExecution ? 'monitor' : 'test';
    let finalResult: TestResult;
    let s3Url: string | null = null;

    // Create temp directory for extracted reports (OS-managed temp)
    const extractedReportsDir = path.join(
      process.env.TMPDIR || process.env.TEMP || '/tmp',
      `supercheck-reports-${uniqueRunId}`,
    );

    // Track this execution
    this.activeExecutions.set(uniqueRunId, {
      startTime: Date.now(),
      memoryUsage: process.memoryUsage().heapUsed,
      countsTowardsLimit: !bypassConcurrencyCheck,
    });

    try {
      // 1. Validate input
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        throw new Error('No test code provided.');
      }

      // Check for cancellation signal before starting execution
      if (
        task.runId &&
        (await this.cancellationService.isCancelled(task.runId))
      ) {
        this.logger.warn(
          `[${testId}] Execution cancelled before start - runId: ${task.runId}`,
        );
        throw new Error('Execution cancelled by user');
      }

      // 2. Store initial metadata about the run
      await this.dbService.storeReportMetadata({
        entityId: executionId,
        entityType,
        status: 'running',
        reportPath: s3ReportKeyPrefix,
      });

      // 3. Prepare test script content (container-only, no host files)
      let testScript: { scriptContent: string; fileName: string };

      try {
        testScript = await this.prepareSingleTest(testId, code);
      } catch (error) {
        throw new Error(`Failed to prepare test: ${(error as Error).message}`);
      }

      // Check for cancellation signal before executing Playwright
      if (
        task.runId &&
        (await this.cancellationService.isCancelled(task.runId))
      ) {
        this.logger.warn(
          `[${testId}] Execution cancelled before Playwright execution - runId: ${task.runId}`,
        );
        throw new Error('Execution cancelled by user');
      }

      // 4. Execute the test script using container-only execution with timeout
      const execResult = await this._executePlaywrightNativeRunner(
        testScript,
        extractedReportsDir,
        false,
        undefined, // No additional files for single test
        task.runId || undefined, // Pass runId for cancellation tracking
      );

      // Check if this was a cancellation (exit code 137 = SIGKILL)
      const wasCancelled =
        !execResult.success && execResult.error?.includes('code 137');
      if (wasCancelled) {
        this.logger.warn(`[${testId}] Execution was cancelled (exit code 137)`);
        throw new Error('Execution cancelled by user');
      }

      // 5. Process result and upload report
      // The report evaluation is the authoritative source for test status
      // It correctly handles flaky tests (which pass on retry)
      const reportOutcome =
        await this.evaluatePlaywrightReport(extractedReportsDir);
      const finalStatus: 'passed' | 'failed' = !reportOutcome.hasFailures
        ? 'passed'
        : 'failed';

      if (finalStatus === 'passed') {
        // Removed success log - only log errors and completion summary

        // For synthetic monitors: only upload reports on failure (not on success)
        // For other entity types: always upload reports
        if (!isMonitorExecution) {
          const uploadResult = await this.reportUploadService.uploadReport({
            runDir: extractedReportsDir, // Container-extracted reports in OS temp
            testId,
            executionId,
            s3ReportKeyPrefix,
            entityType,
            processReportFiles: true,
          });

          if (uploadResult.success) {
            s3Url = uploadResult.reportUrl;
          } else {
            this.logger.warn(
              `[${testId}] Report upload failed: ${uploadResult.error || 'Unknown error'}`,
            );
            s3Url = null;
          }
        }
        // For synthetic monitors on success: s3Url remains null (no report saved)

        // Publish final status
        await this.dbService.storeReportMetadata({
          entityId: executionId,
          entityType,
          reportPath: s3ReportKeyPrefix,
          status: finalStatus,
          s3Url: s3Url ?? undefined,
        });

        finalResult = {
          success: true,
          reportUrl: s3Url,
          testId: uniqueRunId, // Use unique execution ID instead of test ID
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          error: null,
          executionTimeMs: execResult.executionTimeMs,
        };
        this.logger.log(
          `[Playwright Test] ${testId} passed (${execResult.executionTimeMs ?? 0}ms)`,
        );
      } else {
        // Playwright execution failed
        const specificError =
          execResult.error ||
          'Playwright execution failed with an unknown error.';
        this.logger.error(
          `[${testId}] Playwright execution failed: ${specificError}`,
        );

        // Log stdout and stderr specifically on failure *before* upload attempt
        if (execResult.stdout) {
          this.logger.error(
            `[${testId}] Playwright stdout:\n--- STDOUT START ---\n${execResult.stdout}\n--- STDOUT END ---\n`,
          );
        }
        if (execResult.stderr) {
          this.logger.error(
            `[${testId}] Playwright stderr:\n--- STDERR START ---\n${execResult.stderr}\n--- STDERR END ---\n`,
          );
        }

        // Even on failure, attempt to upload the container-extracted report directory
        const uploadResult = await this.reportUploadService.uploadReport({
          runDir: extractedReportsDir, // Container-extracted reports in OS temp
          testId,
          executionId,
          s3ReportKeyPrefix,
          entityType,
          processReportFiles: true,
        });

        if (uploadResult.success) {
          s3Url = uploadResult.reportUrl;
        } else {
          this.logger.warn(
            `[${testId}] Report upload failed for failure case: ${uploadResult.error || 'Unknown error'}`,
          );
          s3Url = null;
        }

        // Update status *after* logging and upload attempt
        await this.dbService.storeReportMetadata({
          entityId: executionId,
          entityType,
          reportPath: s3ReportKeyPrefix,
          status: 'failed',
          s3Url: s3Url ?? undefined, // Use final s3Url
        });

        // <<< CHANGED: Construct and return failure result object >>>
        finalResult = {
          success: false,
          error: specificError,
          reportUrl: s3Url,
          testId: uniqueRunId, // Use unique execution ID instead of test ID
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          executionTimeMs: execResult.executionTimeMs,
        };
        this.logger.error(
          `[Playwright Test] ${testId} failed: ${specificError} (${execResult.executionTimeMs ?? 0}ms)`,
        );

        // <<< REMOVED: Do not throw error here; return the result object >>>
        // throw new Error(specificError); // OLD WAY
      }
    } catch (error: any) {
      // Check if this is a cancellation error
      const errorMessage = (error as Error).message;
      const isCancellation =
        errorMessage.includes('cancelled') ||
        errorMessage.includes('cancellation') ||
        errorMessage.includes('code 137');

      // Use 'error' status for cancellation, 'failed' for other errors
      const finalStatus = isCancellation ? 'error' : 'failed';
      const errorDetails = isCancellation
        ? 'Cancellation requested by user'
        : errorMessage;

      this.logger.error(
        `[${testId}] ${isCancellation ? 'Cancelled' : 'Unhandled error'} during single test execution: ${errorMessage}`,
        (error as Error).stack,
      );

      // Ensure DB status is marked appropriately
      await this.dbService
        .storeReportMetadata({
          entityId: executionId,
          entityType,
          reportPath: s3ReportKeyPrefix,
          status: finalStatus,
          s3Url: s3Url ?? undefined, // Use final s3Url
        })
        .catch((dbErr) =>
          this.logger.error(
            `[${testId}] Failed to update DB status on error: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
          ),
        );

      finalResult = {
        success: false,
        error: errorDetails,
        reportUrl: null,
        testId: uniqueRunId, // Use unique execution ID instead of test ID
        stdout: '',
        stderr: (error as Error).stack || (error as Error).message,
      };
      this.logger.error(
        `[Playwright Test] ${testId} ${isCancellation ? 'cancelled' : 'crashed'}: ${errorMessage}`,
      );
      // Propagate the error to the BullMQ processor so the job is marked as failed
      throw error;
    } finally {
      // Remove from active executions
      this.activeExecutions.delete(uniqueRunId);

      // Cleanup extracted reports directory from OS temp
      // Container internals are automatically cleaned up on container destruction
      // We only need to clean up the host-extracted reports after S3 upload
      try {
        if (extractedReportsDir && existsSync(extractedReportsDir)) {
          await fs.rm(extractedReportsDir, { recursive: true, force: true });
          this.logger.debug(
            `[${testId}] Cleaned up extracted reports: ${extractedReportsDir}`,
          );
        }
      } catch (cleanupErr) {
        this.logger.warn(
          `[${testId}] Failed to cleanup extracted reports ${extractedReportsDir}: ${(cleanupErr as Error).message}`,
        );
      }
    }

    return finalResult;
  }

  /**
   * Runs a job (multiple tests) defined by the task data.
   * Uses the native Playwright test runner and HTML reporter.
   */
  async runJob(task: JobExecutionTask): Promise<TestExecutionResult> {
    const { runId, testScripts } = task;

    if (task.jobType === 'k6') {
      throw new Error(
        `Received performance job ${task.jobId} in Playwright execution pipeline. k6 jobs must be enqueued on the k6-job-execution queue.`,
      );
    }

    // Check concurrency limits
    if (this.getActiveConcurrencyCount() >= this.maxConcurrentExecutions) {
      throw new Error(
        `Maximum concurrent executions limit reached: ${this.maxConcurrentExecutions}`,
      );
    }

    const entityType = 'job';
    this.logger.log(
      `[${runId}] Starting job execution with ${testScripts.length} tests (container-only).`,
    );

    // Generate unique ID for this run to avoid conflicts in parallel executions
    const uniqueRunId = `${runId}-${crypto.randomUUID().substring(0, 8)}`;
    const s3ReportKeyPrefix = `${runId}/report`;
    let finalResult: TestExecutionResult;
    let s3Url: string | null = null;
    let finalError: string | null = null;
    const timestamp = new Date().toISOString();
    let overallSuccess = false; // Default to failure
    let stdout_log = '';
    let stderr_log = '';

    // Create temp directory for extracted reports (OS-managed temp)
    const extractedReportsDir = path.join(
      process.env.TMPDIR || process.env.TEMP || '/tmp',
      `supercheck-job-reports-${uniqueRunId}`,
    );

    // Track this execution
    this.activeExecutions.set(uniqueRunId, {
      startTime: Date.now(),
      memoryUsage: process.memoryUsage().heapUsed,
      countsTowardsLimit: true,
    });

    try {
      // 1. Validate input
      if (!testScripts || testScripts.length === 0) {
        throw new Error('No test scripts provided for job execution');
      }

      // Check for cancellation signal before starting job execution
      if (await this.cancellationService.isCancelled(runId)) {
        this.logger.warn(`[${runId}] Job execution cancelled before start`);
        throw new Error('Execution cancelled by user');
      }

      // 2. Store initial metadata
      await this.dbService.storeReportMetadata({
        entityId: runId,
        entityType,
        status: 'running',
        reportPath: s3ReportKeyPrefix,
      });

      // 3. Prepare all test scripts as inline content (container-only, no host files)
      this.logger.log(
        `[${runId}] Preparing ${testScripts.length} test scripts for container execution`,
      );

      const preparedScripts: Record<string, string> = {}; // filename -> content
      let mainTestFile: string | null = null;

      for (let i = 0; i < testScripts.length; i++) {
        // Check for cancellation between test preparations
        if (await this.cancellationService.isCancelled(runId)) {
          this.logger.warn(
            `[${runId}] Job execution cancelled during test preparation`,
          );
          throw new Error('Execution cancelled by user');
        }

        const { id, script: originalScript, name } = testScripts[i];
        const testId = id;
        const testName = name || `Test ${i + 1}`;

        this.logger.debug(
          `[Playwright Job] Processing test: ${testName} (${testId})`,
        );

        try {
          // Check if the script is Base64 encoded and decode it
          let decodedScript = originalScript;
          try {
            // Check if it looks like Base64 (typical characteristics)
            if (
              originalScript &&
              typeof originalScript === 'string' &&
              originalScript.length > 100 &&
              /^[A-Za-z0-9+/]+=*$/.test(originalScript)
            ) {
              const decoded = Buffer.from(originalScript, 'base64').toString(
                'utf8',
              );
              // Verify it's actually JavaScript by checking for common patterns
              if (
                decoded.includes('import') ||
                decoded.includes('test(') ||
                decoded.includes('describe(')
              ) {
                decodedScript = decoded;
                this.logger.debug(
                  `[Playwright Job] Decoded Base64 script for test ${testName}`,
                );
              }
            }
          } catch (decodeError) {
            this.logger.warn(
              `[Playwright Job] Failed to decode potential Base64 script for test ${testName}:`,
              decodeError,
            );
            // Continue with original script if decoding fails
          }

          // Ensure the script has proper trace configuration
          const script = ensureProperTraceConfiguration(decodedScript, testId);

          // Prepare script for inline container execution
          // Prefix with zero-padded order number for correct sorting in Playwright report
          const orderPrefix = String(i + 1).padStart(3, '0');
          const fileName = `${orderPrefix}-${testId}.spec.mjs`;
          preparedScripts[fileName] = script;

          // Use the first script as the main test file
          if (i === 0) {
            mainTestFile = fileName;
          }

          this.logger.debug(
            `[Playwright Job] Test spec prepared: ${testName} -> ${fileName}`,
          );
        } catch (error) {
          this.logger.error(
            `[Playwright Job] Error creating test file for ${testName}: ${(error as Error).message}`,
            (error as Error).stack,
          );
          continue; // Skip this test but continue with others
        }
      }

      if (!mainTestFile || Object.keys(preparedScripts).length === 0) {
        throw new Error('No valid test scripts found to execute for this job.');
      }

      this.logger.log(
        `[${runId}] Prepared ${Object.keys(preparedScripts).length} test spec files for container execution.`,
      );

      // 4. Execute ALL tests using container-only execution
      // For jobs, we use a wrapper directory approach: all scripts go in /tmp/tests/
      // and we run playwright test /tmp/tests/ to execute all of them
      this.logger.log(
        `[${runId}] Executing ${Object.keys(preparedScripts).length} test specs via Playwright runner (timeout: ${this.jobExecutionTimeoutMs}ms)...`,
      );

      // Prepare additionalFiles with subdirectory structure
      // Main script content becomes the first file, others are additional
      const [mainFileName, mainContent] = Object.entries(preparedScripts)[0];
      const additionalFiles: Record<string, string> = {};

      // Add all other scripts as additional files (skip first one)
      Object.entries(preparedScripts)
        .slice(1)
        .forEach(([fileName, content]) => {
          additionalFiles[fileName] = content;
        });

      // Check for cancellation signal before executing Playwright
      if (await this.cancellationService.isCancelled(runId)) {
        this.logger.warn(
          `[${runId}] Job execution cancelled before Playwright execution`,
        );
        throw new Error('Execution cancelled by user');
      }

      const execResult = await this._executePlaywrightNativeRunner(
        {
          scriptContent: mainContent,
          fileName: mainFileName,
        },
        extractedReportsDir,
        true,
        additionalFiles, // Pass additional test files to execute in container
        runId, // Pass runId for cancellation tracking
      );

      overallSuccess = execResult.success;
      stdout_log = execResult.stdout;
      stderr_log = execResult.stderr;
      finalError = execResult.error;

      // Check if this was a cancellation (exit code 137 = SIGKILL)
      const wasCancelled =
        !execResult.success && execResult.error?.includes('code 137');
      if (wasCancelled) {
        this.logger.warn(`[${runId}] Execution was cancelled (exit code 137)`);
        throw new Error('Execution cancelled by user');
      }

      // 5. Process result and upload report
      // Removed log - only log errors and final summary

      s3Url =
        this.s3Service.getBaseUrlForEntity(entityType, runId) + '/index.html';

      // Upload report using centralized service (container-extracted reports)
      const uploadResult = await this.reportUploadService.uploadReport({
        runDir: extractedReportsDir, // Container-extracted reports in OS temp
        testId: uniqueRunId, // Use uniqueRunId for jobs to match report directory naming
        executionId: runId, // Use runId for S3 path consistency
        s3ReportKeyPrefix,
        entityType: 'job',
        processReportFiles: true,
      });

      if (uploadResult.success) {
        s3Url = uploadResult.reportUrl;
        this.logger.log(`[${runId}] Report uploaded successfully to: ${s3Url}`);
      } else {
        this.logger.warn(
          `[${runId}] Report upload failed: ${uploadResult.error || 'Unknown error'}`,
        );
        s3Url = null;
        overallSuccess = false;
        finalError =
          finalError ||
          `Report upload failed: ${uploadResult.error || 'Unknown error'}`;
      }

      // Before publishing final status, calculate duration
      const endTime = new Date();
      const startTimeMs = new Date(timestamp).getTime();
      const durationMs = endTime.getTime() - startTimeMs;
      const durationStr = this.formatDuration(durationMs);
      const durationSeconds = this.getDurationSeconds(durationMs);

      // Evaluate report contents to determine real outcome; default to failed if unknown
      const reportOutcome =
        await this.evaluatePlaywrightReport(extractedReportsDir);
      overallSuccess = overallSuccess && !reportOutcome.hasFailures;

      // Update the finalResult to include duration
      finalResult = {
        jobId: runId,
        success: overallSuccess,
        error: overallSuccess ? null : finalError,
        reportUrl: s3Url,
        // Individual results are less meaningful with a combined report,
        // but we can pass overall status for now.
        results: testScripts.map((ts) => ({
          testId: ts.id,
          success: overallSuccess,
          error: overallSuccess ? null : finalError,
          reportUrl: s3Url, // Link to the combined job report
        })),
        timestamp,
        duration: durationStr,
        stdout: stdout_log,
        stderr: stderr_log,
      };

      // 6. Store final metadata in DB & publish status
      const finalStatus = overallSuccess ? 'passed' : 'failed';
      await this.dbService.storeReportMetadata({
        entityId: runId,
        entityType,
        reportPath: s3ReportKeyPrefix,
        status: finalStatus,
        s3Url: s3Url ?? undefined,
      });

      // Update the run record in the database with the duration
      try {
        await this.dbService.updateRunStatus(
          runId,
          finalStatus,
          durationSeconds.toString(),
        );
      } catch (updateError) {
        this.logger.error(
          `[${runId}] Error updating run duration: ${(updateError as Error).message}`,
          (updateError as Error).stack,
        );
      }

      // Store final run result
      await this.dbService.updateRunStatus(runId, finalStatus, durationStr);
      this.logger.log(
        `[Playwright Job] ${runId} ${finalStatus} (${durationMs}ms, ${testScripts.length} tests)`,
      );

      // Update requirement coverage snapshots for any linked requirements
      // This is done asynchronously and errors are logged but don't fail the job
      if (task.jobId && task.organizationId && task.projectId) {
        this.requirementCoverageService
          .updateCoverageAfterJobRun(task.jobId, task.organizationId, task.projectId)
          .catch((err) => {
            this.logger.warn(
              `[${runId}] Failed to update requirement coverage: ${err.message}`,
            );
          });
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      const isCancellation =
        errorMessage.includes('cancelled') ||
        errorMessage.includes('cancellation') ||
        errorMessage.includes('code 137');

      this.logger.error(
        `[${runId}] Unhandled error during job execution: ${errorMessage}`,
        (error as Error).stack,
      );

      // Use 'error' status for cancellation, 'failed' for other errors
      const finalStatus = isCancellation ? 'error' : 'failed';
      const errorDetails = isCancellation
        ? 'Cancellation requested by user'
        : errorMessage;

      // Attempt to mark DB with appropriate status
      await this.dbService
        .storeReportMetadata({
          entityId: runId,
          entityType,
          reportPath: s3ReportKeyPrefix,
          status: finalStatus,
          s3Url: s3Url ?? undefined,
        })
        .catch((dbErr) =>
          this.logger.error(
            `[${runId}] Failed to update DB status on error: ${(dbErr as Error).message}`,
          ),
        );

      // Store final run result with error - use error status for cancellation
      await this.dbService.updateRunStatus(
        runId,
        finalStatus,
        '0ms',
        errorDetails,
      );

      // Set finalResult for error case
      finalResult = {
        jobId: runId,
        success: false,
        error: errorDetails,
        reportUrl: null,
        results: [],
        timestamp,
        stdout: stdout_log,
        stderr: stderr_log + ((error as Error).stack || ''),
      };
      this.logger.error(
        `[Playwright Job] ${runId} ${isCancellation ? 'cancelled' : 'crashed'}: ${errorMessage}`,
      );
      return finalResult; // Return result to prevent further execution that would overwrite the error status
    } finally {
      // Remove from active executions
      this.activeExecutions.delete(uniqueRunId);

      // Cleanup extracted reports directory from OS temp
      // Container internals are automatically cleaned up on container destruction
      // We only need to clean up the host-extracted reports after S3 upload
      try {
        if (extractedReportsDir && existsSync(extractedReportsDir)) {
          await fs.rm(extractedReportsDir, { recursive: true, force: true });
          this.logger.debug(
            `[${runId}] Cleaned up extracted reports: ${extractedReportsDir}`,
          );
        }
      } catch (cleanupErr) {
        this.logger.warn(
          `[${runId}] Failed to cleanup extracted reports ${extractedReportsDir}: ${(cleanupErr as Error).message}`,
        );
      }
    }

    return finalResult;
  }

  /**
   * Execute a Playwright test using the native binary
   * @param runDir The base directory for this specific run where test files are located
   * @param isJob Whether this is a job execution (multiple tests)
   */
  /**
   * Executes Playwright test(s) in container-only mode
   * @param testScript - Script content and filename for inline container execution
   * @param extractedReportsDir - Host directory where container reports will be extracted
   * @param isJob - Whether this is a job (multiple tests) or single test
   * @param additionalFiles - Additional test files for job execution
   */
  private async _executePlaywrightNativeRunner(
    testScript: { scriptContent: string; fileName: string },
    extractedReportsDir: string,
    isJob: boolean = false,
    additionalFiles?: Record<string, string>,
    runId?: string,
  ): Promise<PlaywrightExecutionResult> {
    return this.executePlaywrightDirectly(
      testScript,
      extractedReportsDir,
      isJob,
      additionalFiles,
      runId,
    );
  }

  /**
   * Pure execution logic without span creation - Container-only execution
   * Test scripts passed inline, reports extracted from container /tmp
   * @param testScript - Script content and filename for inline container execution
   * @param extractedReportsDir - Host directory where container reports will be extracted
   * @param isJob - Whether this is a job (multiple tests) or single test
   * @param additionalFiles - Additional test files for job execution (all in /tmp/)
   */
  private async executePlaywrightDirectly(
    testScript: { scriptContent: string; fileName: string },
    extractedReportsDir: string,
    isJob: boolean,
    additionalFiles?: Record<string, string>,
    runId?: string,
  ): Promise<PlaywrightExecutionResult> {
    // For jobs with multiple tests, run playwright test /tmp/ to execute all tests
    // For single tests, target specific file
    const containerTestPath = isJob ? '/tmp/' : `/tmp/${testScript.fileName}`;

    // Reports go to /tmp inside container (NOT mounted, extracted via docker cp)
    const containerReportsDir = '/tmp/playwright-reports';
    const containerHtmlReport = path.join(containerReportsDir, 'html');
    const containerJsonResults = path.join(containerReportsDir, 'results.json');

    // Create a unique ID for this execution to prevent conflicts in parallel runs
    const executionId = crypto.randomUUID().substring(0, 8);

    try {
      this.logger.log(
        `[${isJob ? 'Job' : 'Test'} Execution ${executionId}] Running Playwright in container (${testScript.fileName})`,
      );

      // Environment variables for container execution
      // All paths point to container /tmp (test script + reports, nothing mounted)
      const envVars = {
        PLAYWRIGHT_TEST_DIR: '/tmp', // Test script is in /tmp
        PLAYWRIGHT_JSON_OUTPUT: containerJsonResults, // JSON results in container /tmp
        CI: 'true',
        PLAYWRIGHT_EXECUTION_ID: executionId,
        NODE_PATH: '/worker/node_modules',
        PLAYWRIGHT_OUTPUT_DIR: containerReportsDir,
        // All artifacts and reports go to container /tmp (unmounted, extracted later)
        PLAYWRIGHT_ARTIFACTS_DIR: `${containerReportsDir}/artifacts-${executionId}`,
        PLAYWRIGHT_HTML_REPORT: containerHtmlReport,
        // Set compilation cache directory to /tmp (writable tmpfs in container)
        PLAYWRIGHT_CACHE_DIR: '/tmp/.playwright-cache',
        // Set TMPDIR to container's /tmp
        TMPDIR: '/tmp',
        // Add timestamp to prevent caching issues
        PLAYWRIGHT_TIMESTAMP: Date.now().toString(),
        // Set browsers path to pre-installed location in Docker image
        PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
      };

      this.logger.debug(
        `Executing playwright with execution ID: ${executionId}`,
      );

      // Playwright command for container-only execution
      // Test file will be created in /tmp inside container via inline script
      // Reporters are configured in playwright.config.js via environment variables
      const command = 'npx';
      const args = [
        'playwright',
        'test',
        containerTestPath, // Test file path inside container /tmp
        '--config=/worker/playwright.config.js', // Config baked into worker image
        `--output=${containerReportsDir}/output-${executionId}`, // Output to container /tmp
      ];

      // Execute in container with inline script and report extraction
      const execResult = await this.executeCommandSafely(command, args, {
        env: {
          ...process.env,
          ...envVars,
        },
        cwd: '/worker', // Not used in inline mode, but set for consistency
        shell: false,
        timeout: isJob
          ? this.jobExecutionTimeoutMs
          : this.testExecutionTimeoutMs,
        scriptPath: null, // No host path to mount - using inline script
        workingDir: '/worker',
        runId, // Pass runId for cancellation tracking
        // Inline script execution mode
        inlineScriptContent: testScript.scriptContent,
        inlineScriptFileName: testScript.fileName,
        additionalFiles, // Additional test files for job execution
        ensureDirectories: [
          containerReportsDir,
          path.join(containerReportsDir, 'html'),
        ],
        // Extract playwright-reports directory contents (trailing /. copies contents, not the directory itself)
        extractFromContainer: `${containerReportsDir}/.`,
        extractToHost: extractedReportsDir,
      });

      // Improve error reporting - but preserve original error for cancellation detection
      let extractedError: string | null = null;
      if (!execResult.success) {
        // IMPORTANT: Preserve the original error if it contains exit code info (for cancellation detection)
        if (
          execResult.error &&
          (execResult.error.includes('code 137') ||
            execResult.error.includes('timed out'))
        ) {
          extractedError = execResult.error;
        } else if (
          execResult.stderr &&
          execResult.stderr.trim().length > 0 &&
          !execResult.stderr.toLowerCase().includes('deprecationwarning')
        ) {
          extractedError = execResult.stderr.trim();
        } else if (execResult.stdout) {
          // Look for common Playwright failure summaries in stdout
          const failureMatch = execResult.stdout.match(/(\d+ failed)/);
          if (failureMatch) {
            extractedError = `${failureMatch[1]} - Check report/logs for details.`;
          } else {
            extractedError = 'Script execution failed. Check report/logs.'; // Fallback if stderr is empty/unhelpful
          }
        } else {
          extractedError = 'Script execution failed with no error message.'; // Absolute fallback
        }
      }

      return {
        success: execResult.success,
        error: extractedError, // Use the extracted error message
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        executionTimeMs: execResult.executionTimeMs,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        stdout: '',
        stderr: (error as Error).stack || '',
      };
    }
  }

  /**
   * Inspect the extracted Playwright results.json to determine if any failures occurred.
   * Defaults to "hasFailures=true" when the report is missing or unreadable to stay fail-safe.
   */
  private async evaluatePlaywrightReport(
    extractedReportsDir: string,
  ): Promise<{ hasFailures: boolean; foundReport: boolean }> {
    const resultsPath = path.join(extractedReportsDir, 'results.json');

    try {
      const raw = await fs.readFile(resultsPath, 'utf-8');
      const parsed = JSON.parse(raw);

      const collectedTests = this.collectPlaywrightTests(parsed);
      this.logger.debug(
        `[Playwright Report] Parsed results.json - detected ${collectedTests.length} tests`,
      );

      if (collectedTests.length > 0) {
        const summarized = collectedTests.slice(0, 5).map((test: any) => ({
          title:
            Array.isArray(test?.titlePath) && test.titlePath.length > 0
              ? test.titlePath.join(' › ')
              : (test?.title ?? test?.name ?? 'unknown'),
          outcome: this.determinePlaywrightTestOutcome(test),
          attempts: Array.isArray(test?.results)
            ? test.results.map((result: any) => result?.status)
            : undefined,
        }));
        this.logger.debug(
          `[Playwright Report] Sample test outcomes: ${JSON.stringify(summarized)}`,
        );

        const hasActualFailures = collectedTests.some((test) =>
          this.isPlaywrightTestFailure(test),
        );

        if (hasActualFailures) {
          this.logger.debug(
            `[Playwright Report] At least one test has only failing attempts`,
          );
          return { hasFailures: true, foundReport: true };
        }

        this.logger.debug(
          `[Playwright Report] All tests either passed or were flaky (passed on retry)`,
        );
        return { hasFailures: false, foundReport: true };
      }

      // Fallback: Check summary fields if tests array is not available
      if (parsed?.summary && typeof parsed.summary.failed === 'number') {
        if (parsed.summary.failed > 0) {
          this.logger.debug(
            `[Playwright Report] Found ${parsed.summary.failed} failed tests in summary`,
          );
          return { hasFailures: true, foundReport: true };
        }
      }

      if (typeof parsed?.status === 'string') {
        const status = parsed.status.toLowerCase();
        if (status === 'failed' || status === 'timedout') {
          return { hasFailures: true, foundReport: true };
        }
        if (status === 'passed' || status === 'success') {
          return { hasFailures: false, foundReport: true };
        }
      }

      // Deep scan for any failed status or errors (last resort fallback)
      const deepFailure = this.detectPlaywrightFailure(parsed);
      return { hasFailures: deepFailure, foundReport: true };
    } catch (error) {
      this.logger.warn(
        `[Playwright Report] Could not evaluate results at ${resultsPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { hasFailures: true, foundReport: false };
    }
  }

  private detectPlaywrightFailure(node: unknown): boolean {
    if (!node) return false;

    if (Array.isArray(node)) {
      // For test results array, check if ANY test has a final status of 'failed' or 'timedout'
      // Flaky tests will have status 'passed' (the final retry result), so they won't be flagged
      return node.some((child) => {
        if (typeof child === 'object' && child !== null) {
          const obj = child as Record<string, unknown>;
          // Check the test's final status
          if (
            typeof obj.status === 'string' &&
            ['failed', 'timedout'].includes(obj.status.toLowerCase())
          ) {
            return true;
          }
        }
        return this.detectPlaywrightFailure(child);
      });
    }

    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;

      // Only flag as failure if status is 'failed' or 'timedout' (not 'skipped')
      // For flaky tests, the final status in results.json is 'passed', so this won't trigger
      if (
        typeof obj.status === 'string' &&
        ['failed', 'timedout'].includes(obj.status.toLowerCase())
      ) {
        return true;
      }

      // Check for actual errors (not just attempts with errors)
      if (Array.isArray(obj.errors) && obj.errors.length > 0) {
        // Only flag as failure if this is a test-level error, not an attempt-level error
        // Test-level errors indicate the test ultimately failed
        if (obj.status !== 'passed') {
          return true;
        }
      }

      return Object.values(obj).some((value) =>
        this.detectPlaywrightFailure(value),
      );
    }

    return false;
  }

  private collectPlaywrightTests(report: unknown): any[] {
    const collected: any[] = [];

    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') {
        return;
      }

      const obj = node as Record<string, unknown>;

      if (Array.isArray(obj.tests)) {
        for (const test of obj.tests) {
          if (test) {
            collected.push(test);
          }
        }
      }

      const nestedCollections: Array<unknown> = [];
      if (Array.isArray(obj.suites)) {
        nestedCollections.push(...obj.suites);
      }
      if (Array.isArray(obj.projects)) {
        nestedCollections.push(...obj.projects);
      }
      if (Array.isArray(obj.specs)) {
        nestedCollections.push(...obj.specs);
      }

      if (nestedCollections.length > 0) {
        nestedCollections.forEach(visit);
      }
    };

    visit(report);
    return collected;
  }

  private determinePlaywrightTestOutcome(
    test: any,
  ): 'passed' | 'flaky' | 'failed' | 'unknown' {
    const statuses = this.extractPlaywrightAttemptStatuses(test);
    const hasPassed = statuses.includes('passed');
    const hasFailure = statuses.some((status) =>
      this.isTerminalPlaywrightFailure(status),
    );

    if (hasPassed && hasFailure) {
      return 'flaky';
    }
    if (hasPassed) {
      return 'passed';
    }
    if (hasFailure) {
      return 'failed';
    }
    return 'unknown';
  }

  private isPlaywrightTestFailure(test: any): boolean {
    const statuses = this.extractPlaywrightAttemptStatuses(test);
    const hasPassed = statuses.includes('passed');
    const hasFailure = statuses.some((status) =>
      this.isTerminalPlaywrightFailure(status),
    );

    // Treat as failure only if there is no passing attempt
    if (!hasPassed && hasFailure) {
      return true;
    }

    const topLevelStatus = this.normalizePlaywrightStatus(test?.status);
    if (
      !hasPassed &&
      topLevelStatus &&
      this.isTerminalPlaywrightFailure(topLevelStatus)
    ) {
      return true;
    }

    return false;
  }

  private extractPlaywrightAttemptStatuses(test: any): string[] {
    const statuses: string[] = [];

    if (Array.isArray(test?.results)) {
      for (const result of test.results) {
        const normalized = this.normalizePlaywrightStatus(result?.status);
        if (normalized) {
          statuses.push(normalized);
        }
      }
    }

    const normalized = this.normalizePlaywrightStatus(test?.status);
    if (normalized) {
      statuses.push(normalized);
    }

    return statuses;
  }

  private normalizePlaywrightStatus(status: unknown): string | null {
    if (!status || typeof status !== 'string') {
      return null;
    }
    return status.toLowerCase();
  }

  private isTerminalPlaywrightFailure(status: string | null): boolean {
    if (!status) {
      return false;
    }

    return ['failed', 'timedout', 'interrupted', 'crashed'].includes(status);
  }

  /**
   * Kills a process and all its child processes
   * This is crucial for cleanup when tests have infinite loops or hanging processes
   */
  private killProcessTree(pid: number | undefined): void {
    if (!pid) {
      this.logger.warn('Cannot kill process tree: no PID provided');
      return;
    }

    try {
      if (isWindows) {
        // On Windows, use taskkill to kill the process tree
        execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' });
        this.logger.log(`Killed Windows process tree for PID: ${pid}`);
      } else {
        // On Unix-like systems, kill the process group
        try {
          // Try to kill the process group first (negative PID)
          process.kill(-pid, 'SIGKILL');
          this.logger.log(`Killed Unix process group for PID: ${pid}`);
        } catch {
          // If process group kill fails, try individual process
          process.kill(pid, 'SIGKILL');
          this.logger.log(`Killed individual Unix process for PID: ${pid}`);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to kill process tree for PID ${pid}: ${(error as Error).message}`,
      );
    }

    // Removed automatic browser process cleanup
  }

  /**
   * Cleanup browser processes only when explicitly needed - optimized for lower CPU usage
   */
  private async cleanupBrowserProcesses(): Promise<void> {
    try {
      // Only run cleanup if we actually had active executions recently
      if (this.activeExecutions.size === 0) {
        return;
      }

      if (isWindows) {
        // Minimal cleanup on Windows - only target obviously stuck processes
        const killPatterns = [
          'playwright.*test',
          'node.*spec.mjs',
          'for.*;;.*100', // Infinite loop patterns
        ];

        for (const pattern of killPatterns) {
          try {
            execSync(
              `wmic process where "commandline like '%${pattern}%'" delete`,
              {
                stdio: 'ignore',
                timeout: 5000,
                windowsHide: true,
              },
            );
          } catch {
            // Ignore errors if no matching processes
          }
        }
      } else {
        // Minimal Unix cleanup - only target specific test processes
        const killCommands = [
          'pkill -9 -f "node.*spec.mjs"',
          'pkill -9 -f "for.*;;.*100"', // Infinite loops
        ];

        for (const cmd of killCommands) {
          try {
            execSync(cmd, { stdio: 'ignore', timeout: 5000 });
          } catch {
            // Ignore errors if processes don't exist
          }
        }
      }

      this.logger.debug('Completed minimal browser process cleanup');
    } catch (cleanupError) {
      this.logger.warn(
        `Browser process cleanup failed: ${(cleanupError as Error).message}`,
      );
    }
  }

  /**
   * Execute a command safely - uses container isolation exclusively
   * This provides defense-in-depth security for user-supplied scripts
   *
   * IMPORTANT: Container execution is mandatory. Docker must be available.
   */
  private async executeCommandSafely(
    command: string,
    args: string[],
    options: {
      env?: Record<string, string | undefined>;
      cwd?: string;
      shell?: boolean;
      timeout?: number;
      scriptPath?: string | null; // Path to the script being executed (for container mounting), null for inline mode
      workingDir?: string; // Working directory inside container
      runId?: string; // Run ID for cancellation tracking
      extractFromContainer?: string; // Path inside container to extract
      extractToHost?: string; // Host path where extracted files should be placed
      inlineScriptContent?: string; // Inline script content for container-only execution
      inlineScriptFileName?: string; // Filename for inline script
      additionalFiles?: Record<string, string>; // Additional files for job execution
      ensureDirectories?: string[]; // Directories to create inside container before execution
    } = {},
  ): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    executionTimeMs?: number;
    error?: string;
  }> {
    const startTime = Date.now();

    // Validate execution mode: either scriptPath OR inlineScriptContent must be provided
    const useInlineScript = !!options.inlineScriptContent;
    const useMountedScript = !!options.scriptPath;

    if (!useInlineScript && !useMountedScript) {
      this.logger.error(
        '[Container] Either scriptPath or inlineScriptContent is required',
      );
      return {
        success: false,
        stdout: '',
        stderr:
          'Either scriptPath or inlineScriptContent must be provided for container execution.',
        executionTimeMs: Date.now() - startTime,
      };
    }

    this.logger.debug(
      `[Container] Executing in container: ${command} ${args.join(' ')}`,
    );

    // Execute in container - this is the only execution path
    const containerResult =
      await this.containerExecutorService.executeInContainer(
        options.scriptPath || null,
        [command, ...args],
        {
          timeoutMs: options.timeout,
          runId: options.runId, // Pass runId for cancellation tracking
          env: options.env as Record<string, string>,
          workingDir: options.workingDir || '/worker',
          memoryLimitMb: this.containerMemoryLimitMb,
          cpuLimit: this.containerCpuLimit,
          networkMode: 'bridge', // Allow network for Playwright
          autoRemove: true, // Will be disabled automatically if extraction is requested
          extractFromContainer: options.extractFromContainer,
          extractToHost: options.extractToHost,
          // Inline script options for container-only execution
          inlineScriptContent: options.inlineScriptContent,
          inlineScriptFileName: options.inlineScriptFileName,
          additionalFiles: options.additionalFiles, // Additional test files for job execution
          ensureDirectories: options.ensureDirectories,
        },
      );

    // Return the container execution result with proper error context
    if (!containerResult.success) {
      this.logger.error(
        `[Container] Container execution failed: ${containerResult.error || 'Unknown error'}`,
      );
    }

    return {
      success: containerResult.success,
      stdout: containerResult.stdout,
      stderr: containerResult.stderr,
      executionTimeMs: containerResult.duration,
      error: containerResult.error,
    };
  }

  /**
   * Maps a container /tmp path to the extracted host directory.
   */
  private mapTmpPathToExtracted(
    containerPath: string,
    extractedDir: string,
  ): string {
    const relativePath = path.relative('/tmp', containerPath);
    if (!relativePath || relativePath.startsWith('..')) {
      return path.join(extractedDir, path.basename(containerPath));
    }
    return path.join(extractedDir, relativePath);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async logExtractedDirectory(
    rootDir: string,
    heading: string,
    maxDepth = 3,
    maxEntries = 200,
  ): Promise<void> {
    try {
      const entries: string[] = [];
      const traverse = async (currentPath: string, depth: number) => {
        if (entries.length >= maxEntries || depth > maxDepth) {
          return;
        }
        const items = await fs.readdir(currentPath, { withFileTypes: true });
        for (const item of items) {
          const relativePath = path.relative(
            rootDir,
            path.join(currentPath, item.name),
          );
          entries.push(
            `${'  '.repeat(depth)}${item.isDirectory() ? '[D]' : '[F]'} ${relativePath || '.'}`,
          );
          if (entries.length >= maxEntries) {
            break;
          }
          if (item.isDirectory()) {
            await traverse(path.join(currentPath, item.name), depth + 1);
          }
        }
      };
      await traverse(rootDir, 0);
      this.logger.warn(heading);
      entries.forEach((entry) => this.logger.warn(entry));
      if (entries.length >= maxEntries) {
        this.logger.warn(
          `[artifact-debug] output truncated after ${maxEntries} entries`,
        );
      }
    } catch (error) {
      this.logger.debug(
        `[artifact-debug] Failed to list ${rootDir}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Helper method to execute a command with proper error handling and timeout
   * @private Internal use only - prefer executeCommandSafely for user-supplied scripts
   */
  private async _executeCommand(
    command: string,
    args: string[],
    options: {
      env?: Record<string, string | undefined>;
      cwd?: string;
      shell?: boolean;
      timeout?: number; // Add timeout option
    } = {},
  ): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    executionTimeMs?: number;
  }> {
    const startTime = Date.now();
    return new Promise((resolve) => {
      try {
        const childProcess = spawn(command, args, {
          env: { ...process.env, ...(options.env || {}) },
          cwd: options.cwd || process.cwd(),
          shell: options.shell || isWindows, // Always use shell on Windows
          // Create a new process group so we can kill all related processes
          detached: !isWindows, // Only use detached on Unix-like systems
          windowsHide: isWindows, // Hide window on Windows
        });

        // Update active executions with PID for better tracking
        for (const [
          executionId,
          execution,
        ] of this.activeExecutions.entries()) {
          if (!execution.pid) {
            execution.pid = childProcess.pid;
            break;
          }
        }

        let stdout = '';
        let stderr = '';
        const MAX_BUFFER = 10 * 1024 * 1024; // 10MB buffer limit
        let resolved = false;
        let timeoutHandle: NodeJS.Timeout | undefined;

        // Set up timeout if specified
        if (options.timeout && options.timeout > 0) {
          timeoutHandle = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              this.logger.error(
                `TIMEOUT: Command execution timed out after ${options.timeout}ms: ${command} ${args.join(' ')}`,
              );

              // Force kill the process and process tree to handle infinite loops
              if (childProcess && !childProcess.killed) {
                try {
                  // Kill the process tree forcefully to handle infinite loops
                  this.killProcessTree(childProcess.pid);

                  // Also send SIGKILL as backup
                  childProcess.kill('SIGKILL');

                  // Force browser cleanup in case browsers are stuck
                  void this.cleanupBrowserProcesses();
                } catch (killError) {
                  this.logger.error(
                    `Failed to kill timed out process: ${(killError as Error).message}`,
                  );
                }
              }

              resolve({
                success: false,
                stdout: stdout + '\n[EXECUTION TIMEOUT - PROCESS KILLED]',
                stderr:
                  stderr +
                  `\n[ERROR] Execution timed out after ${options.timeout}ms - Process and children killed`,
                executionTimeMs: Date.now() - startTime,
              });
            }
          }, options.timeout);
        }

        const cleanup = () => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          // Ensure process is terminated if still running - use SIGKILL for infinite loops
          if (childProcess && !childProcess.killed) {
            try {
              // Try SIGTERM first, then SIGKILL
              childProcess.kill('SIGTERM');
              setTimeout(() => {
                if (childProcess && !childProcess.killed) {
                  childProcess.kill('SIGKILL');
                }
              }, 2000); // 2 second grace period
            } catch (error) {
              // If SIGTERM fails, try SIGKILL immediately
              try {
                childProcess.kill('SIGKILL');
              } catch (killError) {
                this.logger.warn(
                  `Failed to kill process during cleanup: ${(killError as Error).message}`,
                );
              }
            }
          }
        };

        childProcess.stdout.on('data', (data: Buffer) => {
          const chunk = data.toString();
          if (stdout.length < MAX_BUFFER) {
            stdout += chunk;
          } else if (stdout.length === MAX_BUFFER) {
            stdout += '...[TRUNCATED]';
          }
          this.logger.debug(`STDOUT: ${chunk.trim()}`);
        });

        childProcess.stderr.on('data', (data: Buffer) => {
          const chunk = data.toString();
          if (stderr.length < MAX_BUFFER) {
            stderr += chunk;
          } else if (stderr.length === MAX_BUFFER) {
            stderr += '...[TRUNCATED]';
          }
          this.logger.debug(`STDERR: ${chunk.trim()}`);
        });

        childProcess.on('close', (code) => {
          if (!resolved) {
            resolved = true;
            cleanup();
            this.logger.debug(`Command completed with exit code: ${code}`);
            resolve({
              success: code === 0,
              stdout,
              stderr,
              executionTimeMs: Date.now() - startTime,
            });
          }
        });

        childProcess.on('exit', (code, signal) => {
          if (!resolved) {
            resolved = true;
            cleanup();
            this.logger.debug(
              `Command exited with code: ${code}, signal: ${signal}`,
            );
            resolve({
              success: code === 0,
              stdout,
              stderr: signal
                ? stderr +
                  `\n[TERMINATED] Process killed with signal: ${signal}`
                : stderr,
              executionTimeMs: Date.now() - startTime,
            });
          }
        });

        childProcess.on('error', (error) => {
          if (!resolved) {
            resolved = true;
            cleanup();
            this.logger.error(`Command execution failed: ${error.message}`);
            resolve({
              success: false,
              stdout,
              stderr: stderr + `\n[ERROR] ${error.message}`,
              executionTimeMs: Date.now() - startTime,
            });
          }
        });
      } catch (error) {
        this.logger.error(
          `Failed to spawn command: ${error instanceof Error ? error.message : String(error)}`,
        );
        resolve({
          success: false,
          stdout: '',
          stderr: `Failed to spawn command: ${error instanceof Error ? error.message : String(error)}`,
          executionTimeMs: Date.now() - startTime,
        });
      }
    });
  }

  /**
   * Prepares test script content for container execution
   * Returns the script content ready to be passed inline to container
   * Container-only: No host filesystem access needed
   */
  private async prepareSingleTest(
    testId: string,
    testScript: string,
  ): Promise<{ scriptContent: string; fileName: string }> {
    try {
      // Ensure proper trace configuration to avoid path issues
      const enhancedScript = ensureProperTraceConfiguration(testScript, testId);

      // Return script content for inline container execution
      return {
        scriptContent: enhancedScript,
        fileName: `${testId}.spec.mjs`, // ES module extension
      };
    } catch (error) {
      this.logger.error(
        `[${testId}] Failed to prepare test: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new Error(`Test preparation failed: ${(error as Error).message}`);
    }
  }

  /**
   * Formats duration in ms to a human-readable string
   * @param durationMs Duration in milliseconds
   * @returns Formatted duration string like "3s" or "1m 30s"
   */
  private formatDuration(durationMs: number): string {
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return remainingSeconds > 0
        ? `${minutes}m ${remainingSeconds}s`
        : `${minutes}m`;
    }
  }

  /**
   * Gets the duration in seconds from milliseconds
   * @param durationMs Duration in milliseconds
   * @returns Total seconds
   */
  private getDurationSeconds(durationMs: number): number {
    return Math.floor(durationMs / 1000);
  }

  /**
   * Cleanup method called when service is being destroyed
   */
  onModuleDestroy() {
    this.logger.log(
      'ExecutionService cleanup: clearing intervals and active executions',
    );

    // Clear intervals
    if (this.memoryCleanupInterval) {
      clearInterval(this.memoryCleanupInterval);
    }
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
    }

    // Clear active executions without killing processes
    this.activeExecutions.clear();

    // Removed aggressive browser process cleanup
  }
}
