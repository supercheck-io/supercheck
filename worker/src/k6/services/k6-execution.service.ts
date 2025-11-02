import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { S3Service } from '../../execution/services/s3.service';
import { DbService } from '../../execution/services/db.service';
import { RedisService } from '../../execution/services/redis.service';

// Utility function to safely get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Utility function to safely get error stack
function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

export interface K6ExecutionTask {
  runId: string;
  testId: string;
  organizationId: string;
  projectId: string;
  script: string; // Decoded k6 script
  jobId?: string | null;
  tests: Array<{ id: string; script: string }>;
  location?: string; // Execution location
}

export interface K6ExecutionResult {
  success: boolean;
  runId: string;
  durationMs: number;
  summary: any;
  thresholdsPassed: boolean;
  reportUrl: string | null;
  summaryUrl: string | null;
  consoleUrl: string | null;
  logsUrl: string | null;
  error: string | null;
  consoleOutput: string | null;
}

@Injectable()
export class K6ExecutionService {
  private readonly logger = new Logger(K6ExecutionService.name);
  private readonly k6BinaryPath: string;
  private readonly baseLocalRunDir: string;
  private readonly maxConcurrentK6Runs: number;
  private activeK6Runs: Map<
    string,
    { pid: number; startTime: number; runId: string }
  > = new Map();

  constructor(
    private configService: ConfigService,
    private s3Service: S3Service,
    private dbService: DbService,
    private redisService: RedisService,
  ) {
    // Check for k6 binary in multiple common locations
    const configuredPath = this.configService.get<string>('K6_BIN_PATH', '');

    // Priority order: env var > /usr/local/bin/k6 > just 'k6' (assumes in PATH)
    if (configuredPath) {
      this.k6BinaryPath = configuredPath;
    } else {
      // Default to /usr/local/bin/k6 (Docker) or 'k6' (local dev, assumes in PATH)
      this.k6BinaryPath = process.env.NODE_ENV === 'production'
        ? '/usr/local/bin/k6'
        : 'k6';
    }

    this.baseLocalRunDir = path.join(process.cwd(), 'k6-reports');
    this.maxConcurrentK6Runs = this.configService.get<number>(
      'K6_MAX_CONCURRENCY',
      3,
    );

    this.logger.log(`K6 binary path: ${this.k6BinaryPath}`);
    this.logger.log(`Max concurrent k6 runs: ${this.maxConcurrentK6Runs}`);
    this.logger.log(`K6 reports directory: ${this.baseLocalRunDir}`);
  }

  /**
   * Execute a k6 performance test
   */
  async runK6Test(task: K6ExecutionTask): Promise<K6ExecutionResult> {
    const { runId, testId, script, location } = task;
    const startTime = Date.now();

    // Check concurrency
    if (this.activeK6Runs.size >= this.maxConcurrentK6Runs) {
      throw new Error(
        `Max concurrent k6 runs reached: ${this.maxConcurrentK6Runs}`,
      );
    }

    this.logger.log(
      `[${runId}] Starting k6 test${location ? ` (location: ${location})` : ''}`,
    );

    const uniqueRunId = `${runId}-${crypto.randomUUID().substring(0, 8)}`;
    const runDir = path.join(this.baseLocalRunDir, uniqueRunId);

    let finalResult: K6ExecutionResult;

    try {
      // 1. Create directory
      await fs.mkdir(runDir, { recursive: true });

      // 2. Write script
      const scriptPath = path.join(runDir, 'test.js');
      await fs.writeFile(scriptPath, script);

      // 3. Build k6 command
      const reportDir = path.join(runDir, 'report');
      await fs.mkdir(reportDir, { recursive: true });
      const reportPath = path.join(reportDir, 'index.html');
      const summaryPath = path.join(runDir, 'summary.json');
      const consolePath = path.join(runDir, 'console.log');
      const args = [
        'run',
        '--out',
        `web-dashboard=${reportDir}`,
        '--summary-export',
        summaryPath,
        scriptPath,
      ];
      const k6EnvOverrides = {
        K6_WEB_DASHBOARD: process.env.K6_WEB_DASHBOARD ?? 'true',
        K6_WEB_DASHBOARD_OPEN: process.env.K6_WEB_DASHBOARD_OPEN ?? 'false',
        K6_WEB_DASHBOARD_EXPORT:
          process.env.K6_WEB_DASHBOARD_EXPORT ?? reportPath,
        K6_WEB_DASHBOARD_RECORD:
          process.env.K6_WEB_DASHBOARD_RECORD ?? 'true',
      };

      // 4. Execute k6 and stream output
      const execResult = await this.executeK6Binary(
        args,
        runDir,
        runId,
        uniqueRunId,
        k6EnvOverrides,
      );

      // 5. Read summary
      let summary = null;
      try {
        const summaryContent = await fs.readFile(summaryPath, 'utf8');
        summary = JSON.parse(summaryContent);
      } catch (error) {
        this.logger.warn(
          `[${runId}] Failed to read summary.json: ${getErrorMessage(error)}`,
        );
      }

      // 5a. Persist console output for artifact upload
      try {
        const combinedLog =
          execResult.stdout +
          (execResult.stderr
            ? `\n\n[stderr]\n${execResult.stderr}`.trimEnd()
            : '');
        await fs.writeFile(consolePath, combinedLog);
      } catch (error) {
        this.logger.warn(
          `[${runId}] Failed to write console.log: ${getErrorMessage(error)}`,
        );
      }

      // 6. Prepare artifacts for upload
      const targetSummaryPath = path.join(reportDir, 'summary.json');
      try {
        await fs.rename(summaryPath, targetSummaryPath);
      } catch (error) {
        this.logger.warn(
          `[${runId}] Failed to move summary.json into report directory: ${getErrorMessage(error)}`,
        );
        try {
          await fs.copyFile(summaryPath, targetSummaryPath);
        } catch (copyError) {
          this.logger.warn(
            `[${runId}] Failed to copy summary.json into report directory: ${getErrorMessage(copyError)}`,
          );
        }
      }

      const reportConsolePath = path.join(reportDir, 'console.log');
      try {
        await fs.rename(consolePath, reportConsolePath);
      } catch (error) {
        this.logger.warn(
          `[${runId}] Failed to move console.log into report directory: ${getErrorMessage(error)}`,
        );
        try {
          await fs.copyFile(consolePath, reportConsolePath);
        } catch (copyError) {
          this.logger.warn(
            `[${runId}] Failed to copy console.log into report directory: ${getErrorMessage(copyError)}`,
          );
        }
      }

      try {
        await fs.rm(scriptPath);
      } catch (error) {
        this.logger.warn(
          `[${runId}] Failed to remove temporary script: ${getErrorMessage(error)}`,
        );
      }

      const s3KeyPrefix = `${runId}`;
      const bucket = this.s3Service.getBucketForEntityType('k6_performance');

      let hasHtmlReport = false;
      try {
        await fs.access(reportPath);
        hasHtmlReport = true;
      } catch (error) {
        this.logger.warn(
          `[${runId}] HTML report not generated by k6: ${getErrorMessage(error)}`,
        );
      }

      await this.s3Service.uploadDirectory(runDir, s3KeyPrefix, bucket);

      const baseUrl = this.s3Service.getBaseUrlForEntity('k6_performance', runId);
      const reportUrl = hasHtmlReport ? `${baseUrl}/index.html` : null;
      const summaryUrl = `${baseUrl}/summary.json`;
      const consoleUrl = `${baseUrl}/console.log`;

      // 7. Determine pass/fail (k6 exit code)
      const thresholdsPassed = execResult.exitCode === 0;

      finalResult = {
        success: thresholdsPassed,
        runId,
        durationMs: Date.now() - startTime,
        summary,
        thresholdsPassed,
        reportUrl,
        summaryUrl,
        consoleUrl,
        logsUrl: consoleUrl,
        consoleOutput: execResult.stdout || null,
        error: execResult.error,
      };

      // Store report metadata so the app can proxy the report via /api/test-results
      try {
        await this.dbService.storeReportMetadata({
          entityId: runId,
          entityType: 'k6_performance',
          reportPath: `${s3KeyPrefix}/report`,
          status: thresholdsPassed ? 'passed' : 'failed',
          s3Url: reportUrl ?? undefined,
        });
      } catch (metadataError) {
        this.logger.warn(
          `[${runId}] Failed to store report metadata: ${getErrorMessage(metadataError)}`,
        );
      }

      this.logger.log(
        `[${runId}] k6 completed: ${thresholdsPassed ? 'PASSED' : 'FAILED'}`,
      );
    } catch (error) {
      this.logger.error(
        `[${runId}] k6 failed: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );

      finalResult = {
        success: false,
        runId,
        durationMs: Date.now() - startTime,
        summary: null,
        thresholdsPassed: false,
        reportUrl: null,
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        consoleOutput: null,
        error: getErrorMessage(error),
      };

      throw error;
    } finally {
      this.activeK6Runs.delete(uniqueRunId);

      // Cleanup
      try {
        await fs.rm(runDir, { recursive: true, force: true });
      } catch (cleanupError) {
        this.logger.warn(
          `[${runId}] Cleanup failed: ${getErrorMessage(cleanupError)}`,
        );
      }
    }

    return finalResult;
  }

  /**
   * Execute k6 binary and stream stdout
   */
  private async executeK6Binary(
    args: string[],
    cwd: string,
    runId: string,
    uniqueRunId: string,
    overrideEnv: Record<string, string> = {},
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    error: string | null;
  }> {
    return new Promise((resolve, reject) => {
      this.logger.log(`[${runId}] Executing: k6 ${args.join(' ')}`);

      const childProcess = spawn(this.k6BinaryPath, args, {
        cwd,
        env: {
          ...process.env,
          ...overrideEnv,
          K6_NO_COLOR: '1', // Disable ANSI colors
        },
      });

      let stdout = '';
      let stderr = '';

      if (childProcess.pid) {
        this.activeK6Runs.set(uniqueRunId, {
          pid: childProcess.pid,
          startTime: Date.now(),
          runId,
        });
      }

      // Stream stdout to Redis (for real-time console)
      childProcess.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;

        // Publish to Redis for SSE
        this.redisService
          .getClient()
          .publish(`k6:run:${runId}:console`, chunk)
          .catch((err) => {
            this.logger.warn(
              `Failed to publish console: ${getErrorMessage(err)}`,
            );
          });
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
      });

      childProcess.on('close', (code, signal) => {
        const wasSignaled = code === null;
        const exitCode = typeof code === 'number' ? code : 128;
        const exitDescription = wasSignaled
          ? `terminated by signal ${signal ?? 'unknown'}`
          : `exited with code: ${exitCode}`;

        if (wasSignaled) {
          this.logger.warn(`[${runId}] k6 ${exitDescription}`);
        } else {
          this.logger.log(`[${runId}] k6 ${exitDescription}`);
        }

        this.activeK6Runs.delete(uniqueRunId);

        resolve({
          exitCode,
          stdout,
          stderr,
          error: wasSignaled
            ? `k6 terminated by signal ${signal ?? 'unknown'}`
            : exitCode !== 0
            ? `k6 exited with code ${exitCode}`
            : null,
        });
      });

      childProcess.on('error', (error) => {
        this.logger.error(
          `[${runId}] k6 process error: ${getErrorMessage(error)}`,
        );
        reject(error);
      });
    });
  }

  /**
   * Get active k6 runs count (for monitoring)
   */
  getActiveRunsCount(): number {
    return this.activeK6Runs.size;
  }

  /**
   * Get active k6 runs details (for monitoring)
   */
  getActiveRuns(): Array<{ runId: string; pid: number; duration: number }> {
    const now = Date.now();
    return Array.from(this.activeK6Runs.entries()).map(
      ([, { pid, startTime, runId }]) => {
        return {
          runId,
          pid,
          duration: now - startTime,
        };
      },
    );
  }

}
