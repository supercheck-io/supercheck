import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { S3Service } from './s3.service';
import { DbService } from './db.service';
import { RedisService } from './redis.service';
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
  private readonly baseLocalRunDir: string;
  private readonly maxConcurrentExecutions: number; // Configurable via MAX_CONCURRENT_EXECUTIONS env var
  private readonly memoryThresholdMB = 2048; // 2GB memory threshold
  private activeExecutions: Map<
    string,
    { pid?: number; startTime: number; memoryUsage: number }
  > = new Map();
  private memoryCleanupInterval: NodeJS.Timeout;
  private readonly gcInterval: NodeJS.Timeout;

  constructor(
    private configService: ConfigService,
    private s3Service: S3Service,
    private dbService: DbService,
    private redisService: RedisService,
  ) {
    // Set timeouts: configurable via env vars with sensible defaults
    this.testExecutionTimeoutMs = this.configService.get<number>(
      'TEST_EXECUTION_TIMEOUT_MS',
      120000, // 2 minutes default
    );
    this.jobExecutionTimeoutMs = this.configService.get<number>(
      'JOB_EXECUTION_TIMEOUT_MS',
      900000, // 15 minutes default
    );

    const maxConcurrencyRaw =
      this.configService.get<string>('MAX_CONCURRENT_EXECUTIONS') ??
      process.env.MAX_CONCURRENT_EXECUTIONS;
    const parsedConcurrency = Number.parseInt(maxConcurrencyRaw ?? '', 10);
    this.maxConcurrentExecutions = Number.isFinite(parsedConcurrency)
      ? Math.max(1, parsedConcurrency)
      : 5; // Default to 5 concurrent executions if not provided

    // Determine Playwright config path
    const configPath = path.join(process.cwd(), 'playwright.config.js');
    if (!existsSync(configPath)) {
      this.logger.warn(
        'playwright.config.js not found at project root. Playwright might use defaults or fail.',
      );
      // Consider throwing an error if config is mandatory
    }
    this.playwrightConfigPath = configPath;

    this.baseLocalRunDir = path.join(process.cwd(), 'playwright-reports');
    this.logger.log(
      `Test execution timeout set to: ${this.testExecutionTimeoutMs}ms (${this.testExecutionTimeoutMs / 1000}s)`,
    );
    this.logger.log(
      `Job execution timeout set to: ${this.jobExecutionTimeoutMs}ms (${this.jobExecutionTimeoutMs / 1000}s)`,
    );
    this.logger.log(`Base local run directory: ${this.baseLocalRunDir}`);
    this.logger.log(
      `Using Playwright config (relative): ${path.relative(process.cwd(), this.playwrightConfigPath)}`,
    );

    // Log configuration
    this.logger.log(
      `Max concurrent executions: ${this.maxConcurrentExecutions}`,
    );
    this.logger.log(`Memory threshold: ${this.memoryThresholdMB}MB`);

    // Ensure base local dir exists and has correct permissions
    void this.ensureBaseDirectoryPermissions();

    // Setup basic memory monitoring
    this.setupMemoryMonitoring();
  }

  /**
   * Clean up local report directory after successful S3 upload
   */
  private async cleanupLocalReportDirectory(
    dirPath: string,
    entityId: string,
  ): Promise<void> {
    try {
      if (existsSync(dirPath)) {
        // Removed log for cleanup - only log on error
        await fs.rm(dirPath, { recursive: true, force: true });
        // Removed success log for cleanup
      }
    } catch (error) {
      this.logger.warn(
        `[${entityId}] Failed to cleanup local report directory ${dirPath}:`,
        error,
      );
      // Don't throw - cleanup failure shouldn't break the main flow
    }
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
   * Performs optimized memory cleanup operations - only when needed
   */
  private async performMemoryCleanup(): Promise<void> {
    try {
      const memUsage = process.memoryUsage();
      const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      // Only perform cleanup if memory is actually high or we have active executions
      if (
        memUsageMB > this.memoryThresholdMB * 0.8 ||
        this.activeExecutions.size > 0
      ) {
        await this.cleanupOldTempFiles();
      }

      // Reduced logging frequency
      if (memUsageMB > this.memoryThresholdMB * 0.9) {
        this.logger.debug(`Memory usage: ${memUsageMB}MB`);
      }
    } catch (error) {
      this.logger.error(`Error during cleanup: ${(error as Error).message}`);
    }
  }

  /**
   * Cleans up old temporary files to prevent disk space issues - optimized for performance
   */
  private async cleanupOldTempFiles(): Promise<void> {
    try {
      // Check if base directory exists before trying to read it
      if (!existsSync(this.baseLocalRunDir)) {
        return;
      }

      const dirs = await fs.readdir(this.baseLocalRunDir);

      // Only clean up if there are many directories (performance optimization)
      if (dirs.length < 10) {
        return;
      }

      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000; // Increased to 2 hours to reduce frequency
      let cleanedCount = 0;

      for (const dir of dirs) {
        const dirPath = path.join(this.baseLocalRunDir, dir);

        try {
          const stats = await fs.stat(dirPath);

          if (stats.isDirectory() && stats.mtime.getTime() < twoHoursAgo) {
            await fs.rm(dirPath, { recursive: true, force: true });
            cleanedCount++;
            this.logger.debug(`Cleaned up old temp directory: ${dirPath}`);

            // Limit cleanup operations per run to reduce CPU usage
            if (cleanedCount >= 5) {
              break;
            }
          }
        } catch (statError) {
          // Skip files that can't be stat'd (might be in use)
          continue;
        }
      }

      if (cleanedCount > 0) {
        this.logger.debug(`Cleaned up ${cleanedCount} old temp directories`);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to cleanup old temp files: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Ensures base directory exists and has correct permissions for the nodejs user
   */
  private async ensureBaseDirectoryPermissions(): Promise<void> {
    try {
      // Create the base directory if it doesn't exist
      await fs.mkdir(this.baseLocalRunDir, { recursive: true });

      // Test write permissions by creating and removing a test file
      const testFile = path.join(this.baseLocalRunDir, '.permission-test');
      await fs.writeFile(testFile, 'test', { mode: 0o644 });
      await fs.unlink(testFile);

      this.logger.log(
        `Base directory permissions verified: ${this.baseLocalRunDir}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to create or verify permissions for base directory ${this.baseLocalRunDir}: ${(error as Error).message}`,
        (error as Error).stack,
      );

      // Try to fix permissions if possible (works when container has sufficient privileges)
      // Skip on Windows as chmod doesn't exist
      if (!isWindows) {
        try {
          execSync(`chmod -R 755 ${this.baseLocalRunDir}`, { stdio: 'ignore' });
          this.logger.log(
            `Attempted to fix permissions for ${this.baseLocalRunDir}`,
          );
        } catch (chmodError) {
          this.logger.warn(
            `Could not fix permissions: ${(chmodError as Error).message}`,
          );
        }
      }
    }
  }

  /**
   * Creates a run directory with proper permissions and enhanced error handling
   */
  private async createRunDirectoryWithPermissions(
    runDir: string,
    entityId: string,
  ): Promise<void> {
    try {
      await fs.mkdir(runDir, { recursive: true });
      this.logger.debug(
        `[${entityId}] Successfully created run directory: ${runDir}`,
      );
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'EACCES') {
        this.logger.error(
          `[${entityId}] Permission denied when creating directory ${runDir}. ` +
            `This usually happens when the mounted volume has incorrect ownership. ` +
            `Container user: nodejs (UID 1001), Error: ${(error as Error).message}`,
        );

        // Try alternative approaches
        try {
          // Check if parent directory exists and is writable
          const parentDir = path.dirname(runDir);
          await fs.access(parentDir, fs.constants.F_OK | fs.constants.W_OK);

          // Try creating with explicit permissions
          await fs.mkdir(runDir, { recursive: true, mode: 0o755 });
          this.logger.log(
            `[${entityId}] Successfully created directory with explicit permissions`,
          );
        } catch (fallbackError: unknown) {
          this.logger.error(
            `[${entityId}] All attempts to create directory failed. ` +
              `Please ensure the host directory has correct ownership (UID 1001) or is writable by the container. ` +
              `Fallback error: ${(fallbackError as Error).message}`,
          );
          throw new Error(
            `Unable to create test execution directory: ${(error as Error).message}. ` +
              `Please check Docker volume mount permissions for playwright-reports directory.`,
          );
        }
      } else {
        this.logger.error(
          `[${entityId}] Unexpected error creating directory ${runDir}: ${(error as Error).message}`,
        );
        throw error;
      }
    }
  }

  /**
   * Runs a single test defined by the task data.
   * Adapted from the original test worker handler.
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
      this.activeExecutions.size >= this.maxConcurrentExecutions
    ) {
      throw new Error(
        `Maximum concurrent executions limit reached: ${this.maxConcurrentExecutions}`,
      );
    }

    this.logger.log(`[${testId}] Starting single test execution.`);

    // Generate unique ID for this run to avoid conflicts in parallel executions
    const uniqueRunId = `${testId}-${crypto.randomUUID().substring(0, 8)}`;
    const runDir = path.join(this.baseLocalRunDir, uniqueRunId);
    // For monitor executions, use uniqueRunId to preserve historical reports and separate bucket
    // For regular test execution, use testId to maintain existing behavior (overwrite previous report)
    const executionId = isMonitorExecution ? uniqueRunId : testId;
    const s3ReportKeyPrefix = `${executionId}/report`;
    const entityType = isMonitorExecution ? 'monitor' : 'test';
    let finalResult: TestResult;
    let s3Url: string | null = null;

    // Track this execution
    this.activeExecutions.set(uniqueRunId, {
      startTime: Date.now(),
      memoryUsage: process.memoryUsage().heapUsed,
    });

    try {
      // 1. Validate input
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        throw new Error('No test code provided.');
      }

      // 2. Store initial metadata about the run
      await this.dbService.storeReportMetadata({
        entityId: executionId,
        entityType,
        status: 'running',
        reportPath: s3ReportKeyPrefix,
      });

      // 3. Create test script and prepare runner
      let testDirPath: string;

      try {
        // Prepare the test script in the run directory
        // Note: prepareSingleTest now returns the directory path, not the file path
        testDirPath = await this.prepareSingleTest(testId, code, runDir);
      } catch (error) {
        throw new Error(`Failed to prepare test: ${(error as Error).message}`);
      }

      // 4. Execute the test script using the native Playwright runner with timeout
      // Removed verbose execution log
      // Pass the directory path to the runner (the runner will find the .spec.mjs file inside)
      const execResult = await this._executePlaywrightNativeRunner(
        testDirPath,
        false,
      );

      // 5. Process result and upload report
      const testBucket = this.s3Service.getBucketForEntityType(entityType);
      let finalStatus: 'passed' | 'failed' = 'failed'; // Default to failed

      if (execResult.success) {
        finalStatus = 'passed';
        // Removed success log - only log errors and completion summary

        // Use same reporting structure as job execution
        // First, check if there's a normal report generated in the specified output directory
        let reportFound = false;
        // Look for the outputDir generated by Playwright during execution
        const outputDir = path.join(runDir, `report-${testId.substr(0, 8)}`);

        if (existsSync(outputDir)) {
          try {
            const reportFiles = await fs.readdir(outputDir);

            // Look for index.html in the output directory
            if (reportFiles.includes('index.html')) {
              // Removed log for finding report
              reportFound = true;

              try {
                // Process the report files to fix trace URLs before uploading
                await this._processReportFilesForS3(outputDir, executionId);

                await this.s3Service.uploadDirectory(
                  outputDir,
                  s3ReportKeyPrefix,
                  testBucket,
                  executionId,
                  entityType,
                );
                // Removed upload success log

                // Clean up local report directory after successful upload
                await this.cleanupLocalReportDirectory(outputDir, executionId);

                s3Url =
                  this.s3Service.getBaseUrlForEntity(entityType, executionId) +
                  '/index.html';
              } catch (uploadErr: any) {
                this.logger.error(
                  `[${testId}] Report upload failed from ${outputDir}: ${(uploadErr as Error).message}`,
                );
                s3Url = null;
              }
            }
          } catch (err) {
            this.logger.error(
              `[${testId}] Error reading output directory: ${(err as Error).message}`,
            );
          }
        }

        // If no report found in the output directory, check for the default playwright-report location
        if (!reportFound) {
          const playwrightReportDir = path.join(runDir, 'pw-report');

          if (existsSync(playwrightReportDir)) {
            // Removed log for finding report in default location
            try {
              // Process the report files to fix trace URLs before uploading
              await this._processReportFilesForS3(
                playwrightReportDir,
                executionId,
              );

              // Upload the playwright-report directory contents
              await this.s3Service.uploadDirectory(
                playwrightReportDir,
                s3ReportKeyPrefix,
                testBucket,
                executionId,
                entityType,
              );
              // Removed upload success log
              reportFound = true;

              // Clean up local report directory after successful upload
              await this.cleanupLocalReportDirectory(
                playwrightReportDir,
                executionId,
              );
              s3Url =
                this.s3Service.getBaseUrlForEntity(entityType, executionId) +
                '/index.html';
            } catch (uploadErr: any) {
              this.logger.error(
                `[${testId}] Report upload failed from default location: ${(uploadErr as Error).message}`,
              );
              s3Url = null;
            }
          }
        }

        // If we still haven't found a report, log an error
        if (!reportFound) {
          this.logger.warn(
            `[${testId}] No HTML report found in any expected location. S3 URL might not point to a viewable report.`,
          );

          // Keep s3Url pointing to where index.html *should* be. User might need to browse S3.
          this.logger.warn(
            `[${testId}] No valid HTML report found. S3 URL will point to an expected but possibly missing index.html.`,
          );
        }

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

        // Even on failure, attempt to upload the local report directory
        let reportFound = false;
        // Look for the outputDir generated by Playwright during execution
        const outputDir = path.join(runDir, `report-${testId.substr(0, 8)}`);

        if (existsSync(outputDir)) {
          try {
            const reportFiles = await fs.readdir(outputDir);

            // Look for index.html in the output directory
            if (reportFiles.includes('index.html')) {
              reportFound = true;

              try {
                // Process the report files to fix trace URLs before uploading
                await this._processReportFilesForS3(outputDir, executionId);

                await this.s3Service.uploadDirectory(
                  outputDir,
                  s3ReportKeyPrefix,
                  testBucket,
                  executionId,
                  entityType,
                );

                // Clean up local report directory after successful upload
                await this.cleanupLocalReportDirectory(outputDir, executionId);

                s3Url =
                  this.s3Service.getBaseUrlForEntity(entityType, executionId) +
                  '/index.html';
              } catch (uploadErr: any) {
                this.logger.error(
                  `[${testId}] Report upload failed from ${outputDir}: ${(uploadErr as Error).message}`,
                );
                s3Url = null;
              }
            }
          } catch (err) {
            this.logger.error(
              `[${testId}] Error reading output directory: ${(err as Error).message}`,
            );
          }
        }

        // If no report found in the output directory, check for the default playwright-report location
        if (!reportFound) {
          const playwrightReportDir = path.join(runDir, 'pw-report');

          if (existsSync(playwrightReportDir)) {
            this.logger.log(
              `[${testId}] Found HTML report in default location for failure case: ${playwrightReportDir}`,
            );
            try {
              // Process the report files to fix trace URLs before uploading
              await this._processReportFilesForS3(
                playwrightReportDir,
                executionId,
              );

              // Upload the playwright-report directory contents
              await this.s3Service.uploadDirectory(
                playwrightReportDir,
                s3ReportKeyPrefix,
                testBucket,
                executionId,
                entityType,
              );
              reportFound = true;

              // Clean up local report directory after successful upload
              await this.cleanupLocalReportDirectory(
                playwrightReportDir,
                executionId,
              );

              s3Url =
                this.s3Service.getBaseUrlForEntity(entityType, executionId) +
                '/index.html';
            } catch (uploadErr: any) {
              this.logger.error(
                `[${testId}] Report upload failed from default location: ${(uploadErr as Error).message}`,
              );
              s3Url = null;
            }
          }
        }

        // If we still haven't found a report, log an error
        if (!reportFound) {
          this.logger.warn(
            `[${testId}] No HTML report found in any expected location for failure case. S3 URL might not point to a viewable report.`,
          );
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

        // <<< REMOVED: Do not throw error here; return the result object >>>
        // throw new Error(specificError); // OLD WAY
      }
    } catch (error: any) {
      // Catch unexpected errors during the process
      this.logger.error(
        `[${testId}] Unhandled error during single test execution: ${(error as Error).message}`,
        (error as Error).stack,
      );

      // Ensure DB status is marked as failed
      await this.dbService
        .storeReportMetadata({
          entityId: executionId,
          entityType,
          reportPath: s3ReportKeyPrefix,
          status: 'failed',
          s3Url: s3Url ?? undefined, // Use final s3Url
        })
        .catch((dbErr) =>
          this.logger.error(
            `[${testId}] Failed to update DB status on error: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
          ),
        );

      finalResult = {
        success: false,
        error: (error as Error).message,
        reportUrl: null,
        testId: uniqueRunId, // Use unique execution ID instead of test ID
        stdout: '',
        stderr: (error as Error).stack || (error as Error).message,
      };
      // Propagate the error to the BullMQ processor so the job is marked as failed
      throw error;
    } finally {
      // Remove from active executions
      this.activeExecutions.delete(uniqueRunId);

      // 6. Cleanup local run directory after all processing is complete
      // Removed cleanup log - only log errors
      await fs.rm(runDir, { recursive: true, force: true }).catch((err) => {
        this.logger.warn(
          `[${testId}] Failed to cleanup local run directory ${runDir}: ${(err as Error).message}`,
        );
      });

      // Removed forced garbage collection
    }

    return finalResult;
  }

  /**
   * Runs a job (multiple tests) defined by the task data.
   * Uses the native Playwright test runner and HTML reporter.
   */
  async runJob(task: JobExecutionTask): Promise<TestExecutionResult> {
    const { runId, testScripts } = task;

    // Check concurrency limits
    if (this.activeExecutions.size >= this.maxConcurrentExecutions) {
      throw new Error(
        `Maximum concurrent executions limit reached: ${this.maxConcurrentExecutions}`,
      );
    }

    const entityType = 'job';
    this.logger.log(
      `[${runId}] Starting job execution with ${testScripts.length} tests.`,
    );

    // Generate unique ID for this run to avoid conflicts in parallel executions
    const uniqueRunId = `${runId}-${crypto.randomUUID().substring(0, 8)}`;
    const runDir = path.join(this.baseLocalRunDir, uniqueRunId);
    const reportDir = path.join(runDir, 'report');
    const s3ReportKeyPrefix = `${runId}/report`;
    let finalResult: TestExecutionResult;
    let s3Url: string | null = null;
    let finalError: string | null = null;
    const timestamp = new Date().toISOString();
    let overallSuccess = false; // Default to failure
    let stdout_log = '';
    let stderr_log = '';

    // Track this execution
    this.activeExecutions.set(uniqueRunId, {
      startTime: Date.now(),
      memoryUsage: process.memoryUsage().heapUsed,
    });

    try {
      // 1. Validate input
      if (!testScripts || testScripts.length === 0) {
        throw new Error('No test scripts provided for job execution');
      }

      // 2. Create necessary directories with enhanced error handling
      await this.createRunDirectoryWithPermissions(runDir, runId);
      // reportDir will be created by the copy operation later
      this.logger.debug(`[${runId}] Created local run directory: ${runDir}`);

      // Store initial metadata
      await this.dbService.storeReportMetadata({
        entityId: runId,
        entityType,
        status: 'running',
        reportPath: s3ReportKeyPrefix,
      });

      // Process each script, creating a Playwright test file for each
      this.logger.log(
        `[${runId}] Processing ${testScripts.length} test scripts`,
      );
      for (let i = 0; i < testScripts.length; i++) {
        const { id, script: originalScript } = testScripts[i];
        const testId = id;
        this.logger.debug(`[${runId}] Processing test ${testId}`);

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
                  `[${runId}] Decoded Base64 script for test ${testId}`,
                );
              }
            }
          } catch (decodeError) {
            this.logger.warn(
              `[${runId}] Failed to decode potential Base64 script for test ${testId}:`,
              decodeError,
            );
            // Continue with original script if decoding fails
          }

          // Ensure the script has proper trace configuration
          const script = ensureProperTraceConfiguration(decodedScript, testId);

          // Create the test file with unique ID in filename (using .mjs for ES module support)
          const testFilePath = path.join(runDir, `${testId}.spec.mjs`);

          // Write the individual test script content
          // No need to remove require/import as each is a standalone file
          await fs.writeFile(testFilePath, script);
          this.logger.debug(
            `[${runId}] Individual test spec written to: ${testFilePath}`,
          );
        } catch (error) {
          this.logger.error(
            `[${runId}] Error creating test file for ${testId}: ${(error as Error).message}`,
            (error as Error).stack,
          );
          continue;
        }
      }

      if (testScripts.length === 0) {
        throw new Error('No valid test scripts found to execute for this job.');
      }
      this.logger.log(
        `[${runId}] Prepared ${testScripts.length} individual test spec files.`,
      );

      // 4. Execute ALL tests in the runDir using the native runner
      this.logger.log(
        `[${runId}] Executing all test specs in directory via Playwright runner (timeout: ${this.jobExecutionTimeoutMs}ms)...`,
      );
      // Pass isJob=true so the helper knows to execute the directory
      const execResult = await this._executePlaywrightNativeRunner(
        runDir,
        true,
      );
      overallSuccess = execResult.success;
      stdout_log = execResult.stdout;
      stderr_log = execResult.stderr;
      finalError = execResult.error;

      // 5. Process result and upload report
      // Removed log - only log errors and final summary

      const jobBucket = this.s3Service.getBucketForEntityType(entityType);
      s3Url =
        this.s3Service.getBaseUrlForEntity(entityType, runId) + '/index.html';

      // First, check if there's a normal report generated in the specified output directory
      let reportFound = false;

      if (existsSync(reportDir)) {
        const reportFiles = await fs.readdir(reportDir);

        // Look for index.html in the output directory
        if (reportFiles.includes('index.html')) {
          reportFound = true;

          try {
            // Process the report files to fix trace URLs before uploading
            await this._processReportFilesForS3(reportDir, runId);

            await this.s3Service.uploadDirectory(
              reportDir,
              s3ReportKeyPrefix,
              jobBucket,
              runId,
              entityType,
            );
            this.logger.log(
              `[${runId}] Report directory contents uploaded to S3 prefix: ${s3ReportKeyPrefix}`,
            );

            // Clean up local report directory after successful upload
            await this.cleanupLocalReportDirectory(reportDir, runId);
          } catch (uploadErr: any) {
            this.logger.error(
              `[${runId}] Report upload failed from ${reportDir}: ${(uploadErr as Error).message}`,
            );
            s3Url = null;
            overallSuccess = false;
            finalError =
              finalError ||
              `Report upload failed: ${(uploadErr as Error).message}`;
          }
        }
      }

      // If no report found in the output directory, check for the default playwright-report location
      if (!reportFound) {
        const playwrightReportDir = path.join(runDir, 'pw-report');

        if (existsSync(playwrightReportDir)) {
          try {
            // Process the report files to fix trace URLs before uploading
            await this._processReportFilesForS3(playwrightReportDir, runId);

            // Upload the playwright-report directory contents
            await this.s3Service.uploadDirectory(
              playwrightReportDir,
              s3ReportKeyPrefix,
              jobBucket,
              runId,
              entityType,
            );
            this.logger.log(
              `[${runId}] Report directory uploaded from default location to S3 prefix: ${s3ReportKeyPrefix}`,
            );
            reportFound = true;

            // Clean up local report directory after successful upload
            await this.cleanupLocalReportDirectory(playwrightReportDir, runId);
          } catch (uploadErr: any) {
            this.logger.error(
              `[${runId}] Report upload failed from default location: ${(uploadErr as Error).message}`,
            );
            s3Url = null;
            overallSuccess = false;
            finalError =
              finalError ||
              `Report upload failed: ${(uploadErr as Error).message}`;
          }
        }
      }

      // If we still haven't found a report, log an error
      if (!reportFound) {
        this.logger.warn(
          `[${runId}] No HTML report found in any expected location. S3 URL might not point to a viewable report.`,
        );
        if (existsSync(reportDir)) {
          // If the reportDir exists but doesn't have index.html, upload it anyway for the artifacts
          try {
            // Process the report files to fix trace URLs before uploading
            await this._processReportFilesForS3(reportDir, runId);

            await this.s3Service.uploadDirectory(
              reportDir,
              s3ReportKeyPrefix,
              jobBucket,
              runId,
              entityType,
            );
            this.logger.log(
              `[${runId}] Uploaded test artifacts to S3 prefix: ${s3ReportKeyPrefix}`,
            );

            // Clean up local report directory after successful upload
            await this.cleanupLocalReportDirectory(reportDir, runId);
          } catch (uploadErr: any) {
            this.logger.error(
              `[${runId}] Artifacts upload failed: ${(uploadErr as Error).message}`,
            );
          }
        }

        // Keep s3Url pointing to where index.html *should* be. User might need to browse S3.
        this.logger.warn(
          `[${runId}] No valid HTML report found. S3 URL will point to an expected but possibly missing index.html.`,
        );
      }

      // Before publishing final status, calculate duration
      const endTime = new Date();
      const startTimeMs = new Date(timestamp).getTime();
      const durationMs = endTime.getTime() - startTimeMs;
      const durationStr = this.formatDuration(durationMs);
      const durationSeconds = this.getDurationSeconds(durationMs);

      // Update the finalResult to include duration
      finalResult = {
        jobId: runId,
        success: overallSuccess,
        error: finalError,
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
    } catch (error) {
      this.logger.error(
        `[${runId}] Unhandled error during job execution: ${(error as Error).message}`,
        (error as Error).stack,
      );
      const finalStatus = 'failed';
      // Attempt to mark DB as failed
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

      // Store final run result with error
      await this.dbService.updateRunStatus(runId, 'failed', '0ms');

      finalResult = {
        jobId: runId,
        success: false,
        error: (error as Error).message,
        reportUrl: null,
        results: [],
        timestamp,
        stdout: stdout_log,
        stderr: stderr_log + ((error as Error).stack || ''),
      };
      throw error;
    } finally {
      // Remove from active executions
      this.activeExecutions.delete(uniqueRunId);

      // 7. Cleanup local run directory after all processing is complete
      // Removed cleanup log - only log errors
      await fs.rm(runDir, { recursive: true, force: true }).catch((err) => {
        this.logger.warn(
          `[${runId}] Failed to cleanup local run directory ${runDir}: ${(err as Error).message}`,
        );
      });

      // Removed forced garbage collection
    }

    return finalResult;
  }

  /**
   * Execute a Playwright test using the native binary
   * @param runDir The base directory for this specific run where test files are located
   * @param isJob Whether this is a job execution (multiple tests)
   */
  private async _executePlaywrightNativeRunner(
    runDir: string, // Directory containing the spec file(s) OR the single spec file for single tests
    isJob: boolean = false, // Flag to indicate if running multiple tests in a dir (job) vs single file
  ): Promise<PlaywrightExecutionResult> {
    const serviceRoot = process.cwd();
    const playwrightConfigPath = path.join(serviceRoot, 'playwright.config.js'); // Get absolute path to config
    // Use a subdirectory in the provided runDir for the standard playwright report
    const playwrightReportDir = path.join(runDir, 'pw-report');

    // Create a unique ID for this execution to prevent conflicts in parallel runs
    let executionId: string;

    if (isJob) {
      // For jobs, use the last part of the runDir path as the ID
      const runDirParts = runDir.split(path.sep);
      executionId = runDirParts[runDirParts.length - 1].substr(0, 8);
    } else {
      // For single tests, extract the testId from the directory name or file name
      const dirName = path.basename(runDir);
      const testId = dirName.split('-')[0]; // Take the part before the first hyphen
      executionId = testId.substr(0, 8);
    }

    // Ensure we have an execution ID
    if (!executionId) {
      executionId = crypto.randomUUID().substring(0, 8);
    }

    try {
      let targetPath: string; // Path to run tests against (file or directory)

      if (isJob) {
        // For jobs, run all tests in the runDir
        targetPath = runDir;
        this.logger.log(
          `[Job Execution ${executionId}] Running tests in directory: ${targetPath}`,
        );
      } else {
        // For single tests, find the specific test spec file (.mjs for ES module support)
        const files = await fs.readdir(runDir);
        const singleTestFile = files.find((file) => file.endsWith('.spec.mjs'));
        if (!singleTestFile) {
          throw new Error(
            `No .spec.mjs file found in ${runDir} for single test execution. Files present: ${files.join(', ')}`,
          );
        }
        targetPath = path.join(runDir, singleTestFile);
        this.logger.log(
          `[Single Test Execution ${executionId}] Running specific test file: ${targetPath}`,
        );
      }

      // Add unique environment variables for this execution
      const envVars = {
        PLAYWRIGHT_TEST_DIR: runDir,
        CI: 'true',
        PLAYWRIGHT_EXECUTION_ID: executionId,
        // Create a unique artifacts folder for this execution
        PLAYWRIGHT_ARTIFACTS_DIR: path.join(
          runDir,
          `.artifacts-${executionId}`,
        ),
        // Standard location for Playwright HTML report
        PLAYWRIGHT_HTML_REPORT: playwrightReportDir,
        // Add timestamp to prevent caching issues
        PLAYWRIGHT_TIMESTAMP: Date.now().toString(),
      };

      this.logger.debug(
        `Executing playwright with execution ID: ${executionId}`,
      );

      // Handle path differences between Windows and Unix-like systems
      let command: string;
      let args: string[];

      if (isWindows) {
        // On Windows, use npx to execute playwright more reliably
        command = 'npx';
        args = [
          'playwright',
          'test',
          `"${targetPath}"`, // Quote paths on Windows
          `--config="${playwrightConfigPath}"`,
          '--reporter=html,list',
        ];
      } else {
        // On Unix-like systems, use node directly with playwright CLI
        const playwrightCliPath = path.join(
          serviceRoot,
          'node_modules',
          '.bin',
          'playwright',
        );
        command = 'node';
        args = [
          playwrightCliPath,
          'test',
          targetPath,
          `--config=${playwrightConfigPath}`,
          '--reporter=html,list',
        ];
      }

      // Add unique output dir for this execution - using consistent naming across job and test
      const outputDir = path.join(runDir, `report-${executionId}`);
      args.push(`--output=${outputDir}`);

      // Execute the command with environment variables, ensuring correct CWD
      const execResult = await this._executeCommand(command, args, {
        env: { ...process.env, ...envVars },
        cwd: serviceRoot, // Run playwright from service root
        shell: isWindows, // Use shell on Windows for proper command execution
        timeout: isJob
          ? this.jobExecutionTimeoutMs
          : this.testExecutionTimeoutMs, // Apply timeout
      });

      // Improve error reporting
      let extractedError: string | null = null;
      if (!execResult.success) {
        // Prioritize stderr if it contains meaningful info, otherwise use stdout
        if (
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
   * Helper method to execute a command with proper error handling and timeout
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
   * Fix trace file paths in HTML reports before uploading to S3
   * This prevents issues when absolute file paths are used in trace URLs
   */
  private async _processReportFilesForS3(
    reportDir: string,
    runId: string,
  ): Promise<void> {
    try {
      // Look for index.html in the report directory
      const indexPath = path.join(reportDir, 'index.html');
      if (!existsSync(indexPath)) {
        this.logger.warn(
          `No index.html found in ${reportDir}, skipping trace path processing`,
        );
        return;
      }

      // Process HTML files in the report directory
      const processHtmlFile = async (filePath: string) => {
        // Removed processing log - only log errors
        let content = await fs.readFile(filePath, 'utf8');
        let modified = false;

        // Patterns to replace absolute trace paths with relative ones
        const patterns = [
          // Pattern 1: URL search parameter with absolute path to trace.zip
          {
            regex: /trace=(https?:\/\/[^"'&]+\/[^"'&]+\/trace\.zip)/g,
            replacement: 'trace=../data',
          },
          // Pattern 2: Direct absolute path references to trace.zip
          {
            regex: /(["'])(https?:\/\/[^"']+\/[^"']+\/trace\.zip)(['"])/g,
            replacement: '$1../data$3',
          },
          // Pattern 3: Absolute file paths starting with file:// or /Users, /home, etc.
          {
            regex:
              /(["'])(file:\/\/\/|\/(?:Users|home|var|tmp)[^"']+\/trace\.zip)(['"])/g,
            replacement: '$1../data$3',
          },
          // Pattern 4: Windows absolute paths (C:\, D:\, etc.)
          {
            regex: /(["'])([A-Z]:\\[^"']+\\trace\.zip)(['"])/g,
            replacement: '$1../data$3',
          },
          // Pattern 5: Trace directory paths (including custom trace-* directories)
          {
            regex:
              /(["'])(\.\/trace-[^"']+|\.playwright-artifacts-\d+\/traces)[^"']*(['"])/g,
            replacement: '$1../data$3',
          },
          // Pattern 6: Any reference to .network files in absolute paths
          {
            regex: /(["'])(\/[^"']+\.network)(['"])/g,
            replacement: '$1../data$3',
          },
          // Pattern 7: Any path with the runId in it - could be an artifact path
          {
            regex: new RegExp(`(["'])(/[^"']*${runId}[^"']*)(['"])`, 'g'),
            replacement: '$1../data$3',
          },
        ];

        // Apply all patterns
        for (const pattern of patterns) {
          const newContent = content.replace(
            pattern.regex,
            pattern.replacement,
          );
          if (newContent !== content) {
            modified = true;
            content = newContent;
          }
        }

        // Process iframe srcs that might contain trace references
        const iframeSrcRegex = /<iframe[^>]+src=["']([^"']+)["'][^>]*>/g;
        let match: RegExpExecArray | null;
        while ((match = iframeSrcRegex.exec(content)) !== null) {
          const originalSrc = match[1];
          if (originalSrc.includes('trace') || originalSrc.includes(runId)) {
            // Replace absolute paths in iframe src with relative ones
            const newSrc = originalSrc.replace(
              /\/[^/]+\/trace\.zip/,
              '../data',
            );
            if (newSrc !== originalSrc) {
              content = content.replace(originalSrc, newSrc);
              modified = true;
            }
          }
        }

        // Only save the file if we made changes
        if (modified) {
          await fs.writeFile(filePath, content, 'utf8');
          // Removed success log
        }
        // Removed no-changes log
      };

      // Process main index.html
      await processHtmlFile(indexPath);

      // Process trace/index.html if it exists
      const traceIndexPath = path.join(reportDir, 'trace', 'index.html');
      if (existsSync(traceIndexPath)) {
        await processHtmlFile(traceIndexPath);
      }

      // Look for other HTML files in the trace directory
      const traceDir = path.join(reportDir, 'trace');
      if (existsSync(traceDir)) {
        try {
          const files = await fs.readdir(traceDir);
          for (const file of files) {
            if (file.endsWith('.html') && file !== 'index.html') {
              await processHtmlFile(path.join(traceDir, file));
            }
          }
        } catch (err) {
          this.logger.warn(
            `Error reading trace directory: ${(err as Error).message}`,
          );
        }
      }
    } catch (error) {
      // Log error but don't fail the process
      this.logger.error(
        `Error processing report files for S3: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Inner function to handle test preparation
   */
  private async prepareSingleTest(
    testId: string,
    testScript: string,
    runDir: string,
  ): Promise<string> {
    try {
      // Removed log - only log errors

      // Ensure proper trace configuration to avoid path issues
      const enhancedScript = ensureProperTraceConfiguration(testScript, testId);

      // Use .mjs extension for ES module support in test files only
      const testFilePath = path.join(runDir, `${testId}.spec.mjs`);

      // Ensure the directory exists before writing to it
      await this.createRunDirectoryWithPermissions(runDir, testId);

      // Use the script exactly as provided - no conversion at all
      const scriptForRunner = enhancedScript;

      // Write the script to the test file exactly as provided
      await fs.writeFile(testFilePath, scriptForRunner);
      // Removed success log

      return runDir; // Return the directory path similar to how _executePlaywrightNativeRunner is called
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
