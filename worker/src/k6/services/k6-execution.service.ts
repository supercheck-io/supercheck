import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { S3Service } from '../../execution/services/s3.service';
import { DbService } from '../../execution/services/db.service';
import { RedisService } from '../../execution/services/redis.service';
import * as net from 'net';
import { createSafeTempPath } from '../../common/security/path-validator';
import { ContainerExecutorService } from '../../common/security/container-executor.service';
import {
  findFirstFileByNames,
  pathExists,
} from '../../common/utils/file-search';

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
  // Use custom worker image with xk6-dashboard pre-installed for consistency and performance
  private readonly k6DockerImage =
    'ghcr.io/supercheck-io/supercheck/worker:latest';
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

    /**
     * Maximum concurrent k6 runs per worker instance.
     *
     * ARCHITECTURE DECISION: This is hardcoded to 1 because:
     * - Horizontal scaling: Scale by adding worker replicas, not concurrent runs
     * - Resource isolation: Each k6 test gets dedicated CPU/memory
     * - Predictable performance: No resource contention between tests
     *
     * To increase capacity: use WORKER_REPLICAS environment variable
     */
    this.maxConcurrentK6Runs = 1;

    this.logger.log(`K6 binary path: ${this.k6BinaryPath}`);
    this.logger.log(`K6 Docker image: ${this.k6DockerImage}`);
    this.logger.log(`Max concurrent k6 runs: ${this.maxConcurrentK6Runs} (hardcoded for horizontal scaling)`);
    // Note: Environment variables are always strings, so we must parse them as numbers
    const testTimeoutEnv = this.configService.get<string>('K6_TEST_EXECUTION_TIMEOUT_MS');
    this.testExecutionTimeoutMs = testTimeoutEnv ? parseInt(testTimeoutEnv, 10) : 60 * 60 * 1000;
    
    const jobTimeoutEnv = this.configService.get<string>('K6_JOB_EXECUTION_TIMEOUT_MS');
    this.jobExecutionTimeoutMs = jobTimeoutEnv ? parseInt(jobTimeoutEnv, 10) : 60 * 60 * 1000;
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

    // Create OS temp directory for extracted reports (only location where host files exist)
    const extractedReportsDir = createSafeTempPath(`k6-reports-${uniqueRunId}`);

    let finalResult: K6ExecutionResult;

    try {
      // Ensure OS temp directory exists for extracted reports
      await fs.mkdir(extractedReportsDir, { recursive: true });

      // Build k6 command using container paths (/tmp inside container)
      // All files will be created inside the container at /tmp
      const scriptFileName = 'test.js';
      const summaryFileName = 'summary.json';
      const jsonOutputFileName = 'metrics.json';
      const reportDirName = 'report';
      const htmlReportFileName = 'index.html';
      const htmlExportFileName = 'report.html';
      const htmlExportPathContainer = `/tmp/${reportDirName}/${htmlExportFileName}`;

      const args = [
        'run',
        '--summary-export',
        `/tmp/${summaryFileName}`,
        // Include p(99) in summary.json - K6 defaults only include p(90) and p(95)
        '--summary-trend-stats',
        'avg,min,med,max,p(90),p(95),p(99)',
        '--out',
        'web-dashboard',
        '--out',
        `json=/tmp/${jsonOutputFileName}`, // JSON output for detailed network metrics
        `/tmp/${scriptFileName}`,
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
          K6_WEB_DASHBOARD_EXPORT: htmlExportPathContainer, // Export HTML into specific file under /tmp/report
          K6_WEB_DASHBOARD_PORT: dashboardPort.toString(), // Use unique port
          K6_WEB_DASHBOARD_ADDR: this.dashboardBindAddress,
          K6_NO_COLOR: '1', // Disable ANSI colors in output
        };

        try {
          execResult = await this.executeK6Binary(
            args,
            script, // Pass script content instead of directory
            extractedReportsDir, // Pass extraction directory
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
          // No need to reset artifacts - they're created fresh in each container
          await this.delay(150);
        }
      }

      if (!execResult) {
        throw new Error(`[${runId}] k6 did not produce an execution result`);
      }

      const timedOut = execResult.timedOut;
      const exitCode = execResult.exitCode;
      if (timedOut) {
        this.logger.warn(
          `[${runId}] k6 execution exceeded timeout of ${executionTimeoutMs}ms. Attempting graceful cleanup.`,
        );
      }

      // 5. Read summary file (extracted from container)
      let summaryPath = path.join(extractedReportsDir, summaryFileName);
      if (!(await pathExists(summaryPath))) {
        const fallbackSummary = await findFirstFileByNames(
          extractedReportsDir,
          [summaryFileName],
        );
        if (fallbackSummary) {
          this.logger.debug(
            `[${runId}] Located k6 summary at fallback path ${fallbackSummary}`,
          );
          summaryPath = fallbackSummary;
        }
      }
      let summary: any = null;
      try {
        const summaryContent = await fs.readFile(summaryPath, 'utf8');
        summary = JSON.parse(summaryContent);
      } catch (error) {
        this.logger.warn(
          `[${runId}] ${timedOut ? 'Summary not available before timeout' : 'Failed to read summary.json'}: ${getErrorMessage(error)}`,
        );
      }

      // 5. HTML report is extracted from container
      // Verify that k6 generated the HTML report when execution finished normally
      const reportDir = path.join(extractedReportsDir, reportDirName);
      await fs.mkdir(reportDir, { recursive: true });
      const htmlReportPath = path.join(reportDir, htmlReportFileName);
      let exportedHtmlPath = path.join(reportDir, htmlExportFileName);

      if (!(await pathExists(exportedHtmlPath))) {
        const fallbackHtml = await findFirstFileByNames(extractedReportsDir, [
          htmlExportFileName,
          htmlReportFileName,
        ]);
        if (fallbackHtml) {
          this.logger.debug(
            `[${runId}] Located k6 HTML export at fallback path ${fallbackHtml}`,
          );
          exportedHtmlPath = fallbackHtml;
        }
      }

      if (await pathExists(exportedHtmlPath)) {
        if (exportedHtmlPath !== htmlReportPath) {
          try {
            await fs.copyFile(exportedHtmlPath, htmlReportPath);
          } catch (moveError) {
            this.logger.debug(
              `[${runId}] Failed to copy HTML report to ${htmlReportPath}: ${getErrorMessage(moveError)}`,
            );
            try {
              await fs.rename(exportedHtmlPath, htmlReportPath);
            } catch (renameError) {
              this.logger.debug(
                `[${runId}] Skipping HTML rename step: ${getErrorMessage(renameError)}`,
              );
            }
          }
        }
      }
      let hasHtmlReport = false;
      try {
        await fs.access(htmlReportPath);
        hasHtmlReport = true;
        this.logger.debug(
          `[${runId}] HTML report generated by k6 web-dashboard`,
        );
      } catch (error) {
        const message = `[${runId}] HTML report not generated by k6 web-dashboard at ${htmlReportPath}: ${getErrorMessage(error)}`;
        if (timedOut) {
          this.logger.warn(message);
        } else if (exitCode !== 0) {
          this.logger.warn(
            `${message} (execution already failed with code ${exitCode})`,
          );
        } else {
          this.logger.error(message);
          throw new Error(
            `K6 failed to generate HTML report. Ensure K6_WEB_DASHBOARD_EXPORT environment variable is set correctly.`,
          );
        }
      }

      // 5c. Console output is already persisted by executeK6InContainer
      // Just get the path for later use
      const consolePath = path.join(extractedReportsDir, 'console.log');

      // 6. Prepare artifacts for upload (organize files in report directory)
      await fs.mkdir(reportDir, { recursive: true });

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

      // HTML report and metrics.json are already in the extracted directory

      // 7. Upload extracted reports to S3
      const s3KeyPrefix = `${runId}`;
      const bucket = this.s3Service.getBucketForEntityType('k6_performance');

      await this.s3Service.uploadDirectory(
        extractedReportsDir,
        s3KeyPrefix,
        bucket,
      );

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
      // Fall back to exit code if summary is missing (indicates k6 crash)
      const thresholdsPassed = this.checkThresholdsFromSummary(
        summary,
        timedOut,
        exitCode,
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
          status: overallSuccess ? 'passed' : 'failed',
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
        const statusMsg = overallSuccess ? 'PASSED' : 'FAILED';
        const details: string[] = [];
        if (!thresholdsPassed) details.push('thresholds breached');
        if (checksFailed) details.push('checks failed');
        const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
        this.logger.log(
          `[${runId}] k6 completed: ${statusMsg}${detailStr}`,
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

      // Clean up extracted reports directory (OS temp directory)
      try {
        await fs.rm(extractedReportsDir, { recursive: true, force: true });
        this.logger.debug(`[${runId}] Cleaned up extracted reports directory`);
      } catch (cleanupError) {
        this.logger.warn(
          `[${runId}] Failed to cleanup extracted reports directory: ${getErrorMessage(cleanupError)}`,
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

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute k6 binary in secure container with inline script
   * IMPORTANT: Container execution is mandatory for security
   */
  private async executeK6Binary(
    args: string[],
    scriptContent: string,
    extractToHost: string,
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

    // Note: No validation of shell command arguments here
    // The args will be part of a shell script generated by ContainerExecutorService
    // which handles its own validation and escaping

    try {
      // Find the script filename from args (first arg after "run" or first .js file)
      let scriptFileName = 'test.js'; // default
      const runIndex = args.indexOf('run');
      if (runIndex !== -1 && args.length > runIndex + 1) {
        // Next arg after "run" is usually the script
        const candidate = args[runIndex + 1];
        if (!candidate.startsWith('-')) {
          scriptFileName = path.basename(candidate);
        }
      }

      // Track the run start
      this.activeK6Runs.set(uniqueRunId, {
        pid: 0, // Container execution doesn't give us direct PID
        startTime: Date.now(),
        runId,
        dashboardPort,
      });

      this.logger.debug(
        `[${runId}] Using container-only execution with inline script: ${scriptFileName}`,
      );

      // Create report directory structure inside container before execution
      // K6_WEB_DASHBOARD_EXPORT requires the parent directory to exist
      const directoriesToEnsure = new Set<string>(['/tmp']);
      const webDashboardExportPath = overrideEnv.K6_WEB_DASHBOARD_EXPORT;
      if (webDashboardExportPath) {
        const exportDir = webDashboardExportPath.endsWith('.html')
          ? path.dirname(webDashboardExportPath)
          : webDashboardExportPath;
        directoriesToEnsure.add(exportDir);
      }

      // Execute in container with inline script
      const containerResult =
        await this.containerExecutorService.executeInContainer(
          null, // No host script path - using inline content
          ['k6', ...args],
          {
            runId, // Pass runId for cancellation tracking
            inlineScriptContent: scriptContent,
            inlineScriptFileName: scriptFileName,
            ensureDirectories: Array.from(directoriesToEnsure),
            extractFromContainer: '/tmp/.', // Extract contents of /tmp (trailing /. copies contents)
            extractToHost: extractToHost, // To OS temp directory
            timeoutMs: timeoutMs || this.testExecutionTimeoutMs,
            env: {
              ...overrideEnv,
              K6_NO_COLOR: '1', // Disable ANSI colors
            },
            workingDir: '/tmp',
            memoryLimitMb: 1536, // 1.5GB for k6 (reduced for 2 concurrent executions)
            cpuLimit: 1.0, // 1.0 CPU for load testing on Medium instances
            networkMode: 'bridge', // k6 needs network access
            autoRemove: false, // Don't auto-remove - we need to extract files first
            image: this.k6DockerImage, // Use K6-specific Docker image
            onStdoutChunk: async (chunk: string) => {
              try {
                await this.redisService
                  .getClient()
                  .publish(`k6:run:${runId}:console`, chunk);
              } catch (err) {
                this.logger.warn(
                  `[${runId}] Failed to publish streaming chunk: ${getErrorMessage(err)}`,
                );
              }
            },
          },
        );

      // Clean up active runs tracking
      this.activeK6Runs.delete(uniqueRunId);

      const timedOut = containerResult.timedOut;
      const exitCode = containerResult.exitCode;
      const stdout = containerResult.stdout;
      const stderr = containerResult.stderr;

      // Persist stdout + stderr to console.log so it can be fetched/archived later
      try {
        const combinedLog =
          (stdout || '') + (stderr ? `\n\n[stderr]\n${stderr}`.trimEnd() : '');
        await fs.writeFile(
          path.join(extractToHost, 'console.log'),
          combinedLog,
          'utf-8',
        );
      } catch (err) {
        this.logger.warn(
          `[${runId}] Failed to write console.log: ${getErrorMessage(err)}`,
        );
      }

      // Note: stdout was already streamed via onStdoutChunk callback during execution
      // No need to publish again - it would cause duplicate output in the UI

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

      // Note: Container executor already logs the full stdout output
      // No need to log it again here to avoid duplication

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
   * Check if thresholds passed by examining the summary.json structure and k6 exit code.
   * K6 exit code 99 definitively indicates threshold failure.
   * @param summary The K6 summary object from summary.json
   * @param timedOut Whether the execution timed out
   * @param exitCode The k6 process exit code (99 = threshold failure)
   * @returns true if all thresholds passed, false otherwise
   */
  private checkThresholdsFromSummary(
    summary: any,
    timedOut: boolean,
    exitCode: number,
  ): boolean {
    // If timed out, thresholds are considered failed
    if (timedOut) {
      this.logger.debug('Thresholds failed: execution timed out');
      return false;
    }

    // K6 exit code 99 definitively means threshold failure
    // This takes precedence over summary.json parsing since k6 knows best
    if (exitCode === 99) {
      this.logger.debug('Thresholds failed: k6 exit code 99 (threshold breach)');
      return false;
    }

    // If no summary or metrics, fall back to exit code
    // Missing summary indicates k6 crashed (syntax error, missing module, etc.)
    if (!summary || !summary.metrics) {
      // Exit code 0 means success, non-zero means failure
      const passed = exitCode === 0;
      this.logger.debug(
        `Thresholds ${passed ? 'passed' : 'failed'}: no summary available, using exit code ${exitCode}`,
      );
      return passed;
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
    this.logger.debug('All thresholds passed');
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
