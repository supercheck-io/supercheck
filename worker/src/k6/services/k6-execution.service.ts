import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { S3Service } from '../../execution/services/s3.service';
import { DbService } from '../../execution/services/db.service';
import { RedisService } from '../../execution/services/redis.service';
import * as net from 'net';

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
  jobType?: string;
}

export interface K6ExecutionResult {
  success: boolean;
  timedOut: boolean;
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
  private readonly testExecutionTimeoutMs: number;
  private readonly jobExecutionTimeoutMs: number;
  private readonly dashboardPortStart: number;
  private readonly dashboardPortRange: number;
  private readonly dashboardBindAddress: string;
  private readonly useDashboardPortPool: boolean;
  private nextWebDashboardPort: number;
  private readonly allocatedDashboardPorts: Set<number> = new Set();
  private activeK6Runs: Map<
    string,
    { pid: number; startTime: number; runId: string; dashboardPort?: number }
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
      this.k6BinaryPath =
        process.env.NODE_ENV === 'production' ? '/usr/local/bin/k6' : 'k6';
    }

    this.baseLocalRunDir = path.join(process.cwd(), 'k6-reports');
    this.maxConcurrentK6Runs = this.configService.get<number>(
      'K6_MAX_CONCURRENCY',
      3,
    );

    this.logger.log(`K6 binary path: ${this.k6BinaryPath}`);
    this.logger.log(`Max concurrent k6 runs: ${this.maxConcurrentK6Runs}`);
    this.logger.log(`K6 reports directory: ${this.baseLocalRunDir}`);
    this.testExecutionTimeoutMs = this.configService.get<number>(
      'K6_TEST_EXECUTION_TIMEOUT_MS',
      60 * 60 * 1000,
    );
    this.jobExecutionTimeoutMs = this.configService.get<number>(
      'K6_JOB_EXECUTION_TIMEOUT_MS',
      60 * 60 * 1000,
    );
    this.logger.log(
      `k6 test execution timeout: ${this.testExecutionTimeoutMs}ms (${Math.round(this.testExecutionTimeoutMs / 60000)}m)`,
    );
    this.logger.log(
      `k6 job execution timeout: ${this.jobExecutionTimeoutMs}ms (${Math.round(this.jobExecutionTimeoutMs / 60000)}m)`,
    );

    // Verify k6 installation on startup
    this.verifyK6Installation();

    this.dashboardPortStart = this.configService.get<number>(
      'K6_WEB_DASHBOARD_START_PORT',
      6000,
    );
    this.dashboardPortRange = this.configService.get<number>(
      'K6_WEB_DASHBOARD_PORT_RANGE',
      0,
    );
    this.dashboardBindAddress = this.configService.get<string>(
      'K6_WEB_DASHBOARD_ADDR',
      '127.0.0.1',
    );
    this.useDashboardPortPool = this.dashboardPortRange > 0;
    this.nextWebDashboardPort = this.dashboardPortStart;
  }

  /**
   * Verify k6 is installed and working
   */
  private verifyK6Installation(): void {
    const childProcess = spawn(this.k6BinaryPath, ['version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let versionOutput = '';
    let versionError = '';

    childProcess.stdout?.on('data', (data) => {
      versionOutput += data.toString();
    });

    childProcess.stderr?.on('data', (data) => {
      versionError += data.toString();
    });

    childProcess.on('close', (code) => {
      if (code === 0 && versionOutput) {
        this.logger.log(`K6 is installed: ${versionOutput.trim()}`);
        // Verify web-dashboard extension is available
        this.verifyWebDashboardExtension();
      } else {
        this.logger.warn(
          `K6 verification failed. Code: ${code}, Output: ${versionOutput}, Error: ${versionError}`,
        );
      }
    });

    childProcess.on('error', (error) => {
      this.logger.error(
        `K6 verification error: ${getErrorMessage(error)}. Make sure k6 is installed at ${this.k6BinaryPath}`,
      );
    });
  }

  /**
   * Verify k6 web-dashboard extension is available
   */
  private verifyWebDashboardExtension(): void {
    const childProcess = spawn(this.k6BinaryPath, ['version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let versionOutput = '';

    childProcess.stdout?.on('data', (data) => {
      versionOutput += data.toString();
    });

    childProcess.on('close', (code) => {
      if (code === 0) {
        // Check if version output includes the dashboard extension
        if (
          versionOutput.includes('xk6-dashboard') ||
          versionOutput.includes('dashboard [output]')
        ) {
          this.logger.log('✓ K6 web-dashboard extension is available');
        } else {
          this.logger.error(
            '❌ CRITICAL: K6 web-dashboard extension NOT FOUND!',
          );
          this.logger.error(
            'The k6 binary does not include the xk6-dashboard extension.',
          );
          this.logger.error(
            'HTML report generation will fail. Please install k6 with web-dashboard:',
          );
          this.logger.error('  1. go install go.k6.io/xk6/cmd/xk6@latest');
          this.logger.error(
            '  2. xk6 build --with github.com/grafana/xk6-dashboard@latest',
          );
          this.logger.error(`  3. sudo mv k6 ${this.k6BinaryPath}`);
        }
      }
    });

    childProcess.on('error', (error) => {
      this.logger.warn(
        `Could not verify web-dashboard extension: ${getErrorMessage(error)}`,
      );
    });
  }

  /**
   * Execute a k6 performance test
   */
  async runK6Test(task: K6ExecutionTask): Promise<K6ExecutionResult> {
    const { runId, testId, script, location } = task;
    const startTime = Date.now();

    // Capture the active span at the start - this is the processor's span
    const { trace } = await import('@opentelemetry/api');
    const parentSpan = trace.getActiveSpan();

    const uniqueRunId = `${runId}-${crypto.randomUUID().substring(0, 8)}`;

    // Check concurrency and reserve a slot atomically to prevent race condition
    if (this.activeK6Runs.size >= this.maxConcurrentK6Runs) {
      throw new Error(
        `Max concurrent k6 runs reached: ${this.maxConcurrentK6Runs}`,
      );
    }

    // Reserve slot before async setup to prevent other calls from bypassing the limit
    this.activeK6Runs.set(uniqueRunId, {
      pid: 0, // Placeholder, will be updated in executeK6Binary
      startTime,
      runId,
    });

    const executionTimeoutMs = task.jobId
      ? this.jobExecutionTimeoutMs
      : this.testExecutionTimeoutMs;

    this.logger.log(
      `[${runId}] Starting k6 test${location ? ` (location: ${location})` : ''}`,
    );
    this.logger.debug(
      `[${runId}] Timeout configured for k6 execution: ${executionTimeoutMs}ms`,
    );
    const runDir = path.join(this.baseLocalRunDir, uniqueRunId);

    let finalResult: K6ExecutionResult;

    try {
      // 1. Create directory
      await fs.mkdir(runDir, { recursive: true });

      // 2. Write script
      const scriptPath = path.join(runDir, 'test.js');
      await fs.writeFile(scriptPath, script);

      // 3. Build k6 command with web dashboard for HTML report generation
      const reportDir = path.join(runDir, 'report');
      await fs.mkdir(reportDir, { recursive: true });
      const summaryPath = path.join(runDir, 'summary.json');
      const htmlReportPath = path.join(reportDir, 'report.html'); // k6 will export here
      const consolePath = path.join(runDir, 'console.log');

      // Build robust k6 command for HTML report generation
      // The web-dashboard output generates the interactive HTML report
      // K6_WEB_DASHBOARD_EXPORT writes it directly to a file without needing the web server
      const args = [
        'run',
        '--summary-export',
        summaryPath,
        '--out',
        'web-dashboard',
        scriptPath,
      ];

      // Configure web dashboard environment variables for robust HTML export
      // These settings ensure the HTML report is generated regardless of port conflicts
      const maxDashboardAttempts = Math.max(
        this.configService.get<number>('K6_WEB_DASHBOARD_MAX_ATTEMPTS', 5),
        1,
      );

      let execResult: {
        exitCode: number;
        stdout: string;
        stderr: string;
        error: string | null;
        timedOut: boolean;
      } | null = null;
      for (let attempt = 1; attempt <= maxDashboardAttempts; attempt++) {
        const dashboardPort = this.useDashboardPortPool
          ? await this.allocateDashboardPort(runId)
          : 0; // Let the OS choose a free ephemeral port

        const k6EnvOverrides: Record<string, string> = {
          K6_WEB_DASHBOARD: 'true',
          K6_WEB_DASHBOARD_EXPORT: htmlReportPath, // Write HTML report to this path
          K6_WEB_DASHBOARD_PORT: dashboardPort.toString(), // Use unique port
          K6_WEB_DASHBOARD_ADDR: this.dashboardBindAddress,
          K6_NO_COLOR: '1', // Disable ANSI colors in output
        };

        try {
          execResult = await this.executeK6Binary(
            args,
            runDir,
            runId,
            uniqueRunId,
            k6EnvOverrides,
            executionTimeoutMs,
            dashboardPort,
          );
        } finally {
          if (this.useDashboardPortPool) {
            this.releaseDashboardPort(dashboardPort);
          }
        }

        const portConflict =
          execResult.stderr.includes('address already in use') ||
          execResult.error?.includes('address already in use') ||
          execResult.stderr.includes('EADDRINUSE');

        if (execResult.exitCode === 0 || !portConflict) {
          break;
        }

        if (attempt < maxDashboardAttempts) {
          this.logger.warn(
            `[${runId}] k6 dashboard port ${dashboardPort} unavailable (attempt ${attempt}/${maxDashboardAttempts}). Retrying with a new port...`,
          );
          await this.resetDashboardArtifacts({
            reportDir,
            summaryPath,
            htmlReportPath,
            consolePath,
          });
          await this.delay(150);
        }
      }

      if (!execResult) {
        throw new Error(`[${runId}] k6 did not produce an execution result`);
      }

      const timedOut = execResult.timedOut;
      if (timedOut) {
        this.logger.warn(
          `[${runId}] k6 execution exceeded timeout of ${executionTimeoutMs}ms. Attempting graceful cleanup.`,
        );
      }

      // 5. Read summary file (created by --summary-export)
      let summary: any = null;
      try {
        const summaryContent = await fs.readFile(summaryPath, 'utf8');
        summary = JSON.parse(summaryContent);
      } catch (error) {
        this.logger.warn(
          `[${runId}] ${timedOut ? 'Summary not available before timeout' : 'Failed to read summary.json'}: ${getErrorMessage(error)}`,
        );
      }

      // 5a. Create individual spans from K6 summary (HTTP requests, checks, VUs)
      if (summary && !timedOut && parentSpan) {
        try {
          this.logger.debug(
            `[${runId}] Attempting to create K6 internal spans from summary.json`,
          );

          // Import dynamically to avoid circular dependencies
          const { createSpansFromK6Summary, hasK6Summary } = await import(
            '../../observability/k6-test-spans'
          );

          // Extract telemetry context from task data
          const telemetryCtx = {
            runId: task.runId,
            testId: task.testId,
            jobId: task.jobId ?? undefined,
            projectId: task.projectId,
            organizationId: task.organizationId,
            runType: task.jobId ? 'k6_job' : 'k6_test',
          };

          // Pass the parent span explicitly to ensure proper parent linkage
          const spanCount = await createSpansFromK6Summary(
            summaryPath,
            telemetryCtx,
            parentSpan,
          );
          this.logger.log(
            `[${runId}] Created ${spanCount} K6 internal spans from summary`,
          );
        } catch (error) {
          this.logger.error(
            `[${runId}] Failed to create K6 internal spans: ${getErrorMessage(error)}`,
          );
          // Don't fail the execution if span creation fails
        }
      }

      // 5b. HTML report is created directly by k6 web-dashboard with K6_WEB_DASHBOARD_EXPORT
      // Verify that k6 generated the HTML report when execution finished normally
      let hasHtmlReport = false;
      try {
        await fs.access(htmlReportPath);
        hasHtmlReport = true;
        this.logger.debug(
          `[${runId}] HTML report generated by k6 web-dashboard`,
        );
      } catch (error) {
        if (timedOut) {
          this.logger.warn(
            `[${runId}] HTML report not generated before timeout: ${getErrorMessage(error)}`,
          );
        } else {
          this.logger.error(
            `[${runId}] CRITICAL: HTML report not generated by k6 web-dashboard at ${htmlReportPath}: ${getErrorMessage(error)}`,
          );
          throw new Error(
            `K6 failed to generate HTML report. Ensure K6_WEB_DASHBOARD_EXPORT environment variable is set correctly.`,
          );
        }
      }

      const htmlIndexPath = path.join(reportDir, 'index.html');
      if (hasHtmlReport && htmlIndexPath !== htmlReportPath) {
        try {
          await fs.copyFile(htmlReportPath, htmlIndexPath);
        } catch (error) {
          this.logger.warn(
            `[${runId}] Failed to create index.html alias for HTML report: ${getErrorMessage(error)}`,
          );
        }
      }

      // 5b. Persist console output for artifact upload
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

      // HTML report is already in the report directory (generated directly by k6 web dashboard)

      try {
        await fs.rm(scriptPath);
      } catch (error) {
        this.logger.warn(
          `[${runId}] Failed to remove temporary script: ${getErrorMessage(error)}`,
        );
      }

      const s3KeyPrefix = `${runId}`;
      const bucket = this.s3Service.getBucketForEntityType('k6_performance');

      await this.s3Service.uploadDirectory(runDir, s3KeyPrefix, bucket);

      const baseUrl = this.s3Service.getBaseUrlForEntity(
        'k6_performance',
        runId,
      );
      const reportUrl = hasHtmlReport ? `${baseUrl}/index.html` : null;
      const summaryUrl = `${baseUrl}/summary.json`;
      const consoleUrl = `${baseUrl}/console.log`;

      // 7. Determine pass/fail (k6 exit code AND check if any checks failed)
      const thresholdsPassed = !timedOut && execResult.exitCode === 0;

      // Check if any validation checks failed
      const checksFailed = timedOut
        ? false
        : summary?.metrics?.checks?.fails
          ? summary.metrics.checks.fails > 0
          : false;

      // Test passes only if BOTH thresholds pass AND all checks pass without a timeout
      const overallSuccess = !timedOut && thresholdsPassed && !checksFailed;

      finalResult = {
        success: overallSuccess,
        timedOut,
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

      if (timedOut) {
        this.logger.warn(
          `[${runId}] k6 execution timed out after ${executionTimeoutMs}ms`,
        );
      } else {
        this.logger.log(
          `[${runId}] k6 completed: ${thresholdsPassed ? 'PASSED' : 'FAILED'}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[${runId}] k6 failed: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );

      finalResult = {
        success: false,
        timedOut: false,
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
   * Allocate a free port for the k6 web dashboard, probing to avoid clashes with lingering listeners.
   */
  private async allocateDashboardPort(runId: string): Promise<number> {
    const range = Math.max(this.dashboardPortRange, 1);
    const maxAttempts = range * 2;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let candidate = this.nextWebDashboardPort;

      if (
        candidate >= this.dashboardPortStart + range ||
        candidate < this.dashboardPortStart
      ) {
        candidate = this.dashboardPortStart;
      }

      this.nextWebDashboardPort =
        candidate + 1 >= this.dashboardPortStart + range
          ? this.dashboardPortStart
          : candidate + 1;

      if (this.allocatedDashboardPorts.has(candidate)) {
        continue;
      }

      const available = await this.isPortAvailable(candidate);
      if (available) {
        this.allocatedDashboardPorts.add(candidate);
        this.logger.debug(
          `[${runId}] Allocated k6 web dashboard port ${candidate}`,
        );
        return candidate;
      }
    }

    throw new Error(
      `[${runId}] Unable to allocate a free port for k6 web dashboard. Verify that ports ${this.dashboardPortStart}-${this.dashboardPortStart + range - 1} are available.`,
    );
  }

  private releaseDashboardPort(port?: number): void {
    if (typeof port === 'number') {
      this.allocatedDashboardPorts.delete(port);
    }
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = net.createServer();
      tester.unref();

      tester.once('error', () => {
        tester.close(() => resolve(false));
      });

      tester.once('listening', () => {
        tester.close(() => resolve(true));
      });

      tester.listen(port, this.dashboardBindAddress);
    });
  }

  private async resetDashboardArtifacts(paths: {
    reportDir: string;
    summaryPath: string;
    htmlReportPath: string;
    consolePath: string;
  }): Promise<void> {
    const { reportDir, summaryPath, htmlReportPath, consolePath } = paths;

    await Promise.allSettled([
      fs.rm(summaryPath, { force: true }),
      fs.rm(consolePath, { force: true }),
      fs.rm(htmlReportPath, { force: true }),
    ]);

    try {
      await fs.rm(reportDir, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(
        `Failed to remove report directory during retry cleanup: ${getErrorMessage(error)}`,
      );
    }

    await fs.mkdir(reportDir, { recursive: true });
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    timeoutMs?: number,
    dashboardPort?: number,
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    error: string | null;
    timedOut: boolean;
  }> {
    return new Promise((resolve, reject) => {
      this.logger.log(`[${runId}] Executing: k6 ${args.join(' ')}`);
      this.logger.debug(
        `[${runId}] k6 environment variables: ${JSON.stringify(overrideEnv, null, 2)}`,
      );

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
      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      let forceKillHandle: NodeJS.Timeout | undefined;
      let childClosed = false;

      if (childProcess.pid) {
        // Update placeholder entry with actual process info
        const existing = this.activeK6Runs.get(uniqueRunId);
        this.activeK6Runs.set(uniqueRunId, {
          pid: childProcess.pid,
          startTime: existing?.startTime ?? Date.now(),
          runId,
          dashboardPort,
        });
      }

      const gracePeriodMs = 10_000;
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          if (childClosed) {
            return;
          }

          timedOut = true;
          this.logger.warn(
            `[${runId}] k6 execution exceeded timeout of ${timeoutMs}ms. Sending SIGTERM.`,
          );
          try {
            const signalled = childProcess.kill('SIGTERM');
            if (!signalled) {
              this.logger.warn(
                `[${runId}] Failed to send SIGTERM to k6 process (process may have already exited).`,
              );
            }
          } catch (killError) {
            this.logger.error(
              `[${runId}] Error while sending SIGTERM to k6 process: ${getErrorMessage(killError)}`,
            );
          }

          forceKillHandle = setTimeout(() => {
            if (childClosed) {
              return;
            }

            this.logger.warn(
              `[${runId}] k6 process still running after timeout grace period. Forcing SIGKILL.`,
            );
            try {
              childProcess.kill('SIGKILL');
            } catch (killError) {
              this.logger.error(
                `[${runId}] Error while sending SIGKILL to k6 process: ${getErrorMessage(killError)}`,
              );
            }
          }, gracePeriodMs);
        }, timeoutMs);
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
        childClosed = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (forceKillHandle) {
          clearTimeout(forceKillHandle);
        }

        const wasSignaled = code === null;
        const exitCode = timedOut ? 124 : typeof code === 'number' ? code : 128;
        const exitDescription = timedOut
          ? `terminated after exceeding timeout (${timeoutMs ?? 'unknown'}ms)`
          : wasSignaled
            ? `terminated by signal ${signal ?? 'unknown'}`
            : `exited with code: ${exitCode}`;

        if (timedOut || wasSignaled) {
          this.logger.warn(`[${runId}] k6 ${exitDescription}`);
        } else {
          this.logger.log(`[${runId}] k6 ${exitDescription}`);
        }

        // Log stderr if present
        if (stderr) {
          if (exitCode !== 0) {
            this.logger.error(`[${runId}] k6 stderr output:\n${stderr}`);
          } else {
            this.logger.debug(`[${runId}] k6 stderr output:\n${stderr}`);
          }
        }

        // Log stdout for debugging (first 2000 chars)
        if (stdout) {
          const truncatedStdout =
            stdout.length > 2000
              ? `${stdout.substring(0, 2000)}\n... (truncated)`
              : stdout;
          this.logger.debug(`[${runId}] k6 stdout:\n${truncatedStdout}`);
        }

        this.activeK6Runs.delete(uniqueRunId);

        resolve({
          exitCode,
          stdout,
          stderr,
          error: timedOut
            ? `k6 execution timed out after ${timeoutMs}ms`
            : wasSignaled
              ? `k6 terminated by signal ${signal ?? 'unknown'}`
              : exitCode !== 0
                ? `k6 exited with code ${exitCode}`
                : null,
          timedOut,
        });
      });

      childProcess.on('error', (error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (forceKillHandle) {
          clearTimeout(forceKillHandle);
        }
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
