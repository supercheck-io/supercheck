import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { S3Service } from '../../execution/services/s3.service';
import { DbService } from '../../execution/services/db.service';
import { RedisService } from '../../execution/services/redis.service';
import * as net from 'net';
import { validatePath, validateCommandArgument } from '../../common/security/path-validator';
import { ContainerExecutorService } from '../../common/security/container-executor.service';

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
  // Hardcoded K6 Docker image for container execution
  private readonly k6DockerImage = 'grafana/k6:latest';
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
    private containerExecutorService: ContainerExecutorService,
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
    this.logger.log(`K6 Docker image: ${this.k6DockerImage}`);
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
  private async verifyK6Installation(): Promise<void> {
    try {
      const result = await execa(this.k6BinaryPath, ['version'], {
        timeout: 5000,
        reject: false,
      });

      if (result.exitCode === 0 && result.stdout) {
        this.logger.log(`K6 is installed: ${result.stdout.trim()}`);
        // Verify web-dashboard extension is available
        await this.verifyWebDashboardExtension();
      } else {
        this.logger.warn(
          `K6 verification failed. Exit code: ${result.exitCode}, Output: ${result.stdout}, Error: ${result.stderr}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `K6 verification error: ${getErrorMessage(error)}. Make sure k6 is installed at ${this.k6BinaryPath}`,
      );
    }
  }

  /**
   * Verify k6 web-dashboard extension is available
   */
  private async verifyWebDashboardExtension(): Promise<void> {
    try {
      const result = await execa(this.k6BinaryPath, ['version'], {
        timeout: 5000,
        reject: false,
      });

      if (result.exitCode === 0) {
        const versionOutput = result.stdout || '';
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
    } catch (error) {
      this.logger.warn(
        `Could not verify web-dashboard extension: ${getErrorMessage(error)}`,
      );
    }
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

      // Validate script path before writing
      const scriptPathValidation = validatePath(scriptPath, {
        allowAbsolute: true,
        allowRelative: false,
        allowedExtensions: ['.js'],
        baseDirectory: runDir,
      });

      if (!scriptPathValidation.valid) {
        throw new Error(
          `Invalid script path: ${scriptPathValidation.error}`,
        );
      }

      await fs.writeFile(scriptPathValidation.sanitized!, script);

      // 3. Build k6 command with web dashboard for HTML report generation
      const reportDir = path.join(runDir, 'report');
      await fs.mkdir(reportDir, { recursive: true });
      const summaryPath = path.join(runDir, 'summary.json');
      const htmlReportPath = path.join(reportDir, 'report.html'); // k6 will export here
      const consolePath = path.join(runDir, 'console.log');
      const jsonOutputPath = path.join(runDir, 'metrics.json');

      // Build robust k6 command for HTML report generation
      // The web-dashboard output generates the interactive HTML report
      // K6_WEB_DASHBOARD_EXPORT writes it directly to a file without needing the web server
      // Also output JSON metrics for granular observability spans
      // Build args with container paths
      // Files are mounted at /workspace, so use paths relative to that
      const args = [
        'run',
        '--summary-export',
        `/workspace/${path.basename(summaryPath)}`,
        '--out',
        'web-dashboard',
        '--out',
        `json=/workspace/${path.basename(jsonOutputPath)}`, // JSON output for detailed network metrics
        `/workspace/${path.basename(scriptPath)}`,
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
          K6_WEB_DASHBOARD_EXPORT: `/workspace/report/${path.basename(htmlReportPath)}`, // Write HTML report using container path
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
      this.logger.log(
        `[${runId}] DEBUG: summary=${summary ? 'present' : 'null'}, timedOut=${timedOut}, parentSpan=${parentSpan ? 'present' : 'null'}`,
      );

      if (summary && !timedOut && parentSpan) {
        try {
          this.logger.log(
            `[${runId}] Attempting to create K6 internal spans from summary.json at ${summaryPath}`,
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

          this.logger.log(
            `[${runId}] Calling createSpansFromK6Summary with parent span`,
          );

          // Pass the parent span and start time explicitly to ensure proper timing
          const spanCount = await createSpansFromK6Summary(
            summaryPath,
            telemetryCtx,
            parentSpan,
            startTime, // Actual execution start time for accurate span timing
          );
          this.logger.log(
            `[${runId}] ✅ Created ${spanCount} K6 internal spans from summary`,
          );

          // Create detailed network request spans from JSON output
          try {
            const { createSpansFromK6JSON } = await import(
              '../../observability/k6-json-parser'
            );

            this.logger.log(
              `[${runId}] Attempting to create detailed network spans from JSON output at ${jsonOutputPath}`,
            );

            const networkSpanCount = await createSpansFromK6JSON(
              jsonOutputPath,
              telemetryCtx,
              parentSpan,
              startTime,
              {
                aggregateByEndpoint: true, // Aggregate requests by endpoint pattern
                includeScenarios: true, // Include scenario-level spans
                includeChecks: true, // Include check result spans
                sampleSlowRequests: 10, // Sample top 10 slowest requests
                sampleFailedRequests: true, // Include all failed requests
              },
            );

            if (networkSpanCount > 0) {
              this.logger.log(
                `[${runId}] ✅ Created ${networkSpanCount} detailed network spans from K6 JSON output`,
              );
            } else {
              this.logger.debug(
                `[${runId}] No network spans created from JSON output (file may be empty or not found)`,
              );
            }
          } catch (jsonError) {
            this.logger.warn(
              `[${runId}] Failed to create network spans from K6 JSON: ${getErrorMessage(jsonError)}`,
            );
            // Don't fail the execution if JSON span creation fails
          }
        } catch (error) {
          this.logger.error(
            `[${runId}] ❌ Failed to create K6 internal spans: ${getErrorMessage(error)}`,
          );
          // Don't fail the execution if span creation fails
        }
      } else {
        this.logger.log(
          `[${runId}] Skipping K6 child span creation: summary=${summary ? 'present' : 'null'}, timedOut=${timedOut}, parentSpan=${parentSpan ? 'present' : 'null'}`,
        );
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

      // 7. Determine pass/fail by checking actual threshold results in summary.json
      // K6's exit code doesn't always accurately reflect threshold status
      // Check each metric's thresholds to see if any failed (ok: false)
      const thresholdsPassed = this.checkThresholdsFromSummary(
        summary,
        timedOut,
      );

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
   * Execute k6 binary in secure container
   * IMPORTANT: Container execution is mandatory for security
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
    const startTime = Date.now();
    this.logger.log(`[${runId}] Executing in container: k6 ${args.join(' ')}`);
    this.logger.debug(
      `[${runId}] k6 environment variables: ${JSON.stringify(overrideEnv, null, 2)}`,
    );

    // Note: We don't validate the host's k6 binary path for container execution
    // since k6 will be available in the container's PATH

    // Validate all arguments
    for (const arg of args) {
      const argValidation = validateCommandArgument(arg);
      if (!argValidation.valid) {
        const errorMsg = argValidation.error || 'Unknown validation error';
        this.logger.error(
          `[${runId}] Invalid k6 argument: ${errorMsg}`,
        );
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Invalid argument: ${errorMsg}`,
          error: errorMsg,
          timedOut: false,
        };
      }
    }

    try {
      // Find the script file from args (first arg after "run" or first .js file)
      let scriptFile = 'script.js'; // default
      const runIndex = args.indexOf('run');
      if (runIndex !== -1 && args.length > runIndex + 1) {
        // Next arg after "run" is usually the script
        const candidate = args[runIndex + 1];
        if (!candidate.startsWith('-')) {
          scriptFile = path.basename(candidate);
        }
      }

      // Create a marker file to indicate start of execution
      const scriptPath = path.join(cwd, scriptFile);

      // Track the run start
      this.activeK6Runs.set(uniqueRunId, {
        pid: 0, // Container execution doesn't give us direct PID
        startTime: Date.now(),
        runId,
        dashboardPort,
      });

      this.logger.debug(
        `[${runId}] Using container execution with script: ${scriptPath}`,
      );

      // Execute in container
      // Note: grafana/k6 image has 'k6' as ENTRYPOINT, so we only pass the subcommand and args
      const containerResult = await this.containerExecutorService.executeInContainer(
        scriptPath,
        args, // Just pass args directly (e.g., ['run', '--summary-export', ...])
        {
          timeoutMs: timeoutMs || this.testExecutionTimeoutMs,
          env: {
            ...overrideEnv,
            K6_NO_COLOR: '1', // Disable ANSI colors
          },
          workingDir: '/workspace',
          memoryLimitMb: 2048, // 2GB for k6 (may need more for large tests)
          cpuLimit: 2.0, // 200% of one CPU
          networkMode: 'bridge', // k6 needs network access
          autoRemove: true,
          image: this.k6DockerImage, // Use K6-specific Docker image
        },
      );

      // Clean up active runs tracking
      this.activeK6Runs.delete(uniqueRunId);

      const timedOut = containerResult.timedOut;
      const exitCode = containerResult.exitCode;
      const stdout = containerResult.stdout;
      const stderr = containerResult.stderr;

      // Publish final output to Redis (since we can't stream from container)
      if (stdout) {
        try {
          await this.redisService
            .getClient()
            .publish(`k6:run:${runId}:console`, stdout);
        } catch (err) {
          this.logger.warn(
            `[${runId}] Failed to publish console output: ${getErrorMessage(err)}`,
          );
        }
      }

      const exitDescription = timedOut
        ? `terminated after exceeding timeout (${timeoutMs ?? 'unknown'}ms)`
        : `exited with code: ${exitCode}`;

      if (timedOut || exitCode !== 0) {
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

      return {
        exitCode,
        stdout,
        stderr,
        error: containerResult.error || null,
        timedOut,
      };
    } catch (error) {
      this.activeK6Runs.delete(uniqueRunId);
      this.logger.error(
        `[${runId}] k6 container execution error: ${getErrorMessage(error)}`,
      );

      return {
        exitCode: 1,
        stdout: '',
        stderr: getErrorMessage(error),
        error: getErrorMessage(error),
        timedOut: false,
      };
    }
  }

  /**
   * Check if thresholds passed by examining the summary.json structure
   * K6 exit code doesn't always reflect threshold status accurately
   * @param summary The K6 summary object from summary.json
   * @param timedOut Whether the execution timed out
   * @returns true if all thresholds passed or no thresholds defined, false otherwise
   */
  private checkThresholdsFromSummary(
    summary: any,
    timedOut: boolean,
  ): boolean {
    // If timed out, thresholds are considered failed
    if (timedOut) {
      return false;
    }

    // If no summary or metrics, assume pass (no thresholds defined)
    if (!summary || !summary.metrics) {
      return true;
    }

    // Check each metric's thresholds for failures
    // Each threshold has an "ok" property: true=passed, false=failed
    for (const [metricName, metric] of Object.entries(summary.metrics)) {
      if (!metric || typeof metric !== 'object') {
        continue;
      }

      const metricData = metric as any;
      const thresholds = metricData.thresholds;

      // If this metric has thresholds, check if any failed
      if (thresholds && typeof thresholds === 'object') {
        for (const [thresholdName, threshold] of Object.entries(thresholds)) {
          const thresholdData = threshold as any;
          // If ok is false, this threshold failed
          if (thresholdData && thresholdData.ok === false) {
            this.logger.warn(
              `Threshold failed: ${metricName} - ${thresholdName}`,
            );
            return false;
          }
        }
      }
    }

    // All thresholds passed (or no thresholds defined)
    return true;
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
