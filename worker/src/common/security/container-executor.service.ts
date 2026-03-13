/**
 * Secure Script Execution Service
 *
 * Executes scripts as child processes inside the worker container.
 * gVisor (runsc) isolation is provided at the container runtime level:
 *
 * - Docker Compose: `runtime: runsc` on the worker service
 * - Kubernetes: `runtimeClassName: gvisor` on the worker pod
 *
 * In both cases, ALL processes (including spawned children) inherit the
 * gVisor sandbox automatically. No dual-mode routing needed.
 *
 * The worker image already has Playwright + k6 installed, and concurrency
 * is 1-per-process, so scripts run sequentially with process-level isolation.
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import { CancellationService } from '../services/cancellation.service';

export interface ContainerExecutionOptions {
  /**
   * Run ID for cancellation tracking.
   * If provided, the executor will poll for cancellation signals.
   */
  runId?: string;

  /**
   * Timeout in milliseconds.
   */
  timeoutMs?: number;

  /**
   * Memory limit in megabytes (validated but advisory — actual enforcement
   * is at the container runtime level via Docker/K8s resource limits).
   */
  memoryLimitMb?: number;

  /**
   * CPU limit (fraction of CPU, e.g., 0.5 for 50%).
   * Validated but advisory — actual enforcement is at the container runtime level.
   */
  cpuLimit?: number;

  /**
   * Environment variables to pass to the execution process.
   */
  env?: Record<string, string>;

  /**
   * Working directory for the child process.
   */
  workingDir?: string;

  /**
   * Container image (ignored — included for caller compatibility).
   */
  image?: string;

  /**
   * Network mode (reserved for future use).
   */
  networkMode?: 'none' | 'bridge' | 'host';

  /**
   * Whether to remove container after execution (reserved for future use).
   */
  autoRemove?: boolean;

  /**
   * Path to extract after execution (same local filesystem).
   */
  extractFromContainer?: string;

  /**
   * Host path where extracted files should be placed.
   * Required if extractFromContainer is specified.
   */
  extractToHost?: string;

  /**
   * Inline script content to write before execution.
   */
  inlineScriptContent?: string;

  /**
   * Filename for inline script (required if inlineScriptContent is provided).
   * Example: 'test.spec.ts'
   */
  inlineScriptFileName?: string;

  /**
   * Additional files to write before execution.
   * Key: relative path, Value: file content.
   */
  additionalFiles?: Record<string, string>;

  /**
   * Directories to create before execution.
   */
  ensureDirectories?: string[];

  /**
   * Streaming hooks for stdout/stderr chunks (used for live log streaming).
   */
  onStdoutChunk?: (chunk: string) => void | Promise<void>;
  onStderrChunk?: (chunk: string) => void | Promise<void>;
}

export interface ContainerExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
  error?: string;
}

/** Internal validated resource limits */
interface ValidatedLimits {
  valid: boolean;
  error?: string;
  memoryLimitMb: number;
  cpuLimit: number;
  timeoutMs: number;
}

@Injectable()
export class ContainerExecutorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContainerExecutorService.name);

  // -- Active processes for cleanup / cancellation --
  private readonly runningProcesses: Map<string, ChildProcess> = new Map();
  private readonly activeCancellationIntervals: Set<NodeJS.Timeout> =
    new Set();

  /** Max combined stdout+stderr size in bytes (10 MB) */
  private static readonly MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

  /** Grace period before SIGKILL after SIGTERM (ms) */
  private static readonly SIGTERM_GRACE_MS = 5000;

  /** Allowed filename pattern: alphanumeric, dots, hyphens, underscores */
  private static readonly SAFE_FILENAME_RE = /^[\w.\-]+$/;

  /** Environment variables allowed to pass to child processes */
  private static readonly ENV_ALLOWLIST = new Set([
    'PATH',
    'HOME',
    'USER',
    'LANG',
    'LC_ALL',
    'TZ',
    'NODE_ENV',
    'NODE_OPTIONS',
    'NODE_PATH',
    'PLAYWRIGHT_BROWSERS_PATH',
    'DISPLAY',
    'XDG_RUNTIME_DIR',
    'TMPDIR',
    'TEMP',
    'TMP',
  ]);

  constructor(
    private configService: ConfigService,
    private cancellationService: CancellationService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log(
      'Container executor initialized (gVisor isolation provided by container runtime)',
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Clear all cancellation intervals
    for (const interval of this.activeCancellationIntervals) {
      clearInterval(interval);
    }
    this.activeCancellationIntervals.clear();

    // Kill running child processes (entire process groups)
    for (const [runId, proc] of this.runningProcesses.entries()) {
      this.logger.warn(`Killing orphaned process for runId ${runId}`);
      this.killProcessTree(proc, 'SIGKILL');
    }
    this.runningProcesses.clear();
  }

  // =====================================================================
  //  PUBLIC API
  // =====================================================================

  /**
   * Resolves the worker directory. Returns `/worker` if it exists (Docker),
   * otherwise falls back to `process.cwd()` (local dev).
   */
  async resolveWorkerDir(): Promise<string> {
    try {
      await fs.access('/worker');
      return '/worker';
    } catch {
      return process.cwd();
    }
  }

  /**
   * Resolves the Playwright browsers path. Returns `/ms-playwright` if it
   * exists (Docker image with pre-installed browsers), otherwise `undefined`
   * so Playwright falls back to its system default (e.g. ~/Library/Caches/ms-playwright).
   */
  async resolveBrowsersPath(): Promise<string | undefined> {
    try {
      await fs.access('/ms-playwright');
      return '/ms-playwright';
    } catch {
      return undefined;
    }
  }

  /**
   * Executes a script as a child process inside the worker container.
   *
   * All callers (execution.service.ts, k6-execution.service.ts) pass the
   * same arguments — gVisor isolation is transparent at the runtime level.
   */
  async executeInContainer(
    scriptPath: string | null,
    command: string[],
    options: ContainerExecutionOptions = {},
  ): Promise<ContainerExecutionResult> {
    // Validate that scriptPath is null (legacy mode is not supported)
    if (scriptPath !== null) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr:
          'Legacy mode with scriptPath is no longer supported. Use inlineScriptContent instead.',
        duration: 0,
        timedOut: false,
        error: 'Legacy execution mode not supported',
      };
    }

    // Validate inline script options
    if (!options.inlineScriptContent) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'inlineScriptContent is required for container execution',
        duration: 0,
        timedOut: false,
        error: 'Missing inline script content',
      };
    }

    if (!options.inlineScriptFileName) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr:
          'inlineScriptFileName is required when using inlineScriptContent',
        duration: 0,
        timedOut: false,
        error: 'Missing script filename',
      };
    }

    // Validate filename safety — reject path traversal and shell metacharacters
    if (
      !ContainerExecutorService.SAFE_FILENAME_RE.test(
        options.inlineScriptFileName,
      )
    ) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: `Invalid script filename: ${options.inlineScriptFileName}`,
        duration: 0,
        timedOut: false,
        error: 'Script filename contains invalid characters',
      };
    }

    // Validate additionalFiles keys — no path traversal, no absolute paths
    if (options.additionalFiles) {
      for (const filePath of Object.keys(options.additionalFiles)) {
        if (
          filePath.includes('..') ||
          filePath.startsWith('/') ||
          !filePath
        ) {
          return {
            success: false,
            exitCode: 1,
            stdout: '',
            stderr: `Invalid additional file path: ${filePath}`,
            duration: 0,
            timedOut: false,
            error: 'Additional file path contains invalid characters',
          };
        }
      }
    }

    // Validate extraction options
    if (options.extractFromContainer && !options.extractToHost) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr:
          'extractToHost is required when extractFromContainer is specified',
        duration: 0,
        timedOut: false,
        error: 'Invalid extraction configuration',
      };
    }

    // Default options
    const {
      timeoutMs = 300000,
      memoryLimitMb = 512,
      cpuLimit = 0.5,
    } = options;

    // Validate resource limits
    const validatedLimits = this.validateResourceLimits({
      memoryLimitMb,
      cpuLimit,
      timeoutMs,
    });

    if (!validatedLimits.valid) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: validatedLimits.error || 'Invalid resource limits',
        duration: 0,
        timedOut: false,
        error: validatedLimits.error,
      };
    }

    return this.executeLocal(command, options, validatedLimits);
  }

  // =====================================================================
  //  EXECUTION — Direct child process
  // =====================================================================

  /**
   * Executes a script as a direct child process (sh -c "...").
   *
   * Security model:
   * - gVisor (runsc) sandboxing at the container runtime level
   * - Process isolation via separate child process
   * - Timeout enforcement via setTimeout + SIGKILL
   * - Cancellation via Redis poll + SIGKILL
   */
  private async executeLocal(
    command: string[],
    options: ContainerExecutionOptions,
    limits: ValidatedLimits,
  ): Promise<ContainerExecutionResult> {
    const startTime = Date.now();
    const shellScript = this.buildShellScript(options, command);

    this.logger.log(
      `Executing (timeout: ${limits.timeoutMs}ms): ${command.join(' ')}`,
    );

    let childProcess: ChildProcess | null = null;
    let cancellationInterval: NodeJS.Timeout | null = null;
    let killed = false;
    let timedOut = false;

    try {
      // Determine working directory — fall back to process.cwd() if the
      // requested directory doesn't exist (e.g. /worker on a dev host).
      const cwd = await this.resolveWorkerDir();

      // Build environment: allowlisted process env + caller-provided overrides.
      // Only safe env vars are inherited to prevent leaking secrets
      // (DATABASE_URL, S3_SECRET_KEY, etc.) to user-supplied scripts.
      const childEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined && ContainerExecutorService.ENV_ALLOWLIST.has(k)) {
          childEnv[k] = v;
        }
      }
      if (options.env) {
        for (const [k, v] of Object.entries(options.env)) {
          if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) {
            childEnv[k] = v;
          }
        }
      }

      const result = await new Promise<ContainerExecutionResult>(
        (resolve) => {
          let stdout = '';
          let stderr = '';

          childProcess = spawn('/bin/sh', ['-c', shellScript], {
            cwd,
            env: childEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
            // Create a new process group so we can kill the entire tree
            // (shell + npx + node + Chromium + k6) on timeout/cancel.
            detached: true,
          });

          // Register for cancellation
          if (options.runId && childProcess.pid) {
            this.runningProcesses.set(options.runId, childProcess);
          }

          // Timeout enforcement — SIGTERM first, then SIGKILL after grace period.
          // Uses process group kill to terminate the entire spawned tree.
          const timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (childProcess && !childProcess.killed) {
              this.killProcessTree(childProcess, 'SIGTERM');
              setTimeout(() => {
                if (childProcess && !childProcess.killed) {
                  this.killProcessTree(childProcess, 'SIGKILL');
                }
              }, ContainerExecutorService.SIGTERM_GRACE_MS).unref();
            }
          }, limits.timeoutMs);

          // Cancellation poller
          if (options.runId) {
            cancellationInterval = this.startCancellationPoller(
              options.runId,
              childProcess,
              () => {
                killed = true;
              },
            );
          }

          childProcess.stdout!.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            if (stdout.length < ContainerExecutorService.MAX_OUTPUT_BYTES) {
              stdout += text;
            }
            if (options.onStdoutChunk) {
              try {
                void options.onStdoutChunk(text);
              } catch {
                /* ignore */
              }
            }
          });
          childProcess.stdout!.on('error', () => {});

          childProcess.stderr!.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            if (stderr.length < ContainerExecutorService.MAX_OUTPUT_BYTES) {
              stderr += text;
            }
            if (options.onStderrChunk) {
              try {
                void options.onStderrChunk(text);
              } catch {
                /* ignore */
              }
            }
          });
          childProcess.stderr!.on('error', () => {});

          childProcess.on('close', (code) => {
            clearTimeout(timeoutHandle);
            const duration = Date.now() - startTime;
            const exitCode = code ?? (timedOut ? 124 : killed ? 137 : 1);

            resolve({
              success: exitCode === 0 && !timedOut && !killed,
              exitCode,
              stdout,
              stderr,
              duration,
              timedOut,
              error: timedOut
                ? `Execution timed out after ${limits.timeoutMs}ms`
                : killed
                  ? 'Execution cancelled (exit code 137)'
                  : exitCode !== 0
                    ? `Process exited with code ${exitCode}`
                    : undefined,
            });
          });

          childProcess.on('error', (err) => {
            clearTimeout(timeoutHandle);
            const duration = Date.now() - startTime;
            resolve({
              success: false,
              exitCode: 1,
              stdout,
              stderr: err.message,
              duration,
              timedOut: false,
              error: err.message,
            });
          });
        },
      );

      // Handle artifact extraction (same local filesystem).
      // Always attempt extraction — failed Playwright runs (exit 1) and k6
      // threshold breaches (exit 99) still produce artifacts needed for
      // report parsing (results.json, HTML reports, traces, screenshots).
      if (options.extractFromContainer && options.extractToHost) {
        try {
          await this.copyLocalArtifacts(
            options.extractFromContainer,
            options.extractToHost,
          );
        } catch (extractError) {
          this.logger.error(
            `Failed to copy artifacts: ${extractError instanceof Error ? extractError.message : String(extractError)}`,
          );
        }
      }

      const logResult = result.success ? 'succeeded' : 'failed';
      this.logger.log(
        `Execution ${logResult}: exitCode=${result.exitCode}, timedOut=${result.timedOut}, duration=${result.duration}ms`,
      );

      return result;
    } finally {
      // Cleanup
      if (cancellationInterval) {
        clearInterval(cancellationInterval);
        this.activeCancellationIntervals.delete(cancellationInterval);
      }
      if (options.runId) {
        this.runningProcesses.delete(options.runId);
      }
    }
  }

  /**
   * Kills an entire process tree by signalling the process group.
   * Falls back to direct kill if the group kill fails (e.g. PID already gone).
   */
  private killProcessTree(
    childProcess: ChildProcess,
    signal: NodeJS.Signals,
  ): void {
    try {
      if (childProcess.pid) {
        // Negative PID sends the signal to every process in the group
        // (requires `detached: true` in spawn options).
        process.kill(-childProcess.pid, signal);
      } else {
        childProcess.kill(signal);
      }
    } catch {
      // ESRCH — process already exited; safe to ignore.
      try {
        childProcess.kill(signal);
      } catch {
        // Already gone.
      }
    }
  }

  /**
   * Copies artifacts between directories on the local filesystem.
   */
  private async copyLocalArtifacts(
    sourcePath: string,
    destPath: string,
  ): Promise<void> {
    // Strip trailing '/.' if present (legacy convention)
    const cleanSource = sourcePath.replace(/\/\.$/g, '');

    try {
      await fs.access(cleanSource);
    } catch {
      this.logger.debug(
        `Source path ${cleanSource} does not exist — skipping artifact copy`,
      );
      return;
    }

    await fs.mkdir(destPath, { recursive: true });
    await fs.cp(cleanSource, destPath, { recursive: true });
    this.logger.debug(`Copied artifacts from ${cleanSource} to ${destPath}`);
  }

  /**
   * Starts a cancellation poller for a child process.
   * Checks Redis every 1s and sends SIGTERM then SIGKILL if cancelled.
   */
  private startCancellationPoller(
    runId: string,
    childProcess: ChildProcess,
    onCancelled: () => void,
  ): NodeJS.Timeout {
    const interval = setInterval(() => {
      void (async () => {
        try {
          const isCancelled =
            await this.cancellationService.isCancelled(runId);
          if (isCancelled) {
            this.logger.warn(
              `[${runId}] Cancellation detected — terminating process`,
            );
            onCancelled();
            if (!childProcess.killed) {
              this.killProcessTree(childProcess, 'SIGTERM');
              setTimeout(() => {
                if (!childProcess.killed) {
                  this.killProcessTree(childProcess, 'SIGKILL');
                }
              }, ContainerExecutorService.SIGTERM_GRACE_MS).unref();
            }
            await this.cancellationService.clearCancellationSignal(runId);
            clearInterval(interval);
            this.activeCancellationIntervals.delete(interval);
          }
        } catch (error) {
          this.logger.error(
            `Cancellation check error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
    }, 1000);

    this.activeCancellationIntervals.add(interval);
    return interval;
  }

  // =====================================================================
  //  Shell script builder
  // =====================================================================

  /**
   * Builds the shell script that runs inside the execution environment.
   *
   * Base64-decodes inline scripts, creates directories, symlinks
   * node_modules, then executes the command.
   */
  buildShellScript(
    options: ContainerExecutionOptions,
    command: string[],
  ): string {
    const shellCommands: string[] = [];

    // Ensure required directories exist before writing files
    if (options.ensureDirectories && options.ensureDirectories.length > 0) {
      const uniqueDirs = Array.from(new Set(options.ensureDirectories));
      for (const dir of uniqueDirs) {
        if (!dir || typeof dir !== 'string') {
          continue;
        }
        const escapedDir = dir.replace(/'/g, "'\\''");
        shellCommands.push(`mkdir -p '${escapedDir}'`);
      }
    }

    // Symlink node_modules so specs can resolve dependencies
    // Uses $PWD (set by spawn cwd) to work in both Docker (/worker) and local dev
    shellCommands.push(
      '[ -d "$PWD/node_modules" ] && [ ! -e /tmp/node_modules ] && ln -s "$PWD/node_modules" /tmp/node_modules || true',
    );

    // Write main script file via base64 decode
    // Filename is pre-validated by SAFE_FILENAME_RE in executeInContainer.
    const scriptContent = Buffer.from(options.inlineScriptContent!).toString(
      'base64',
    );
    const scriptPath = `/tmp/${options.inlineScriptFileName}`;
    const escapedScriptPath = scriptPath.replace(/'/g, "'\\''");
    shellCommands.push(
      `printf '%s' "${scriptContent}" | base64 -d > '${escapedScriptPath}'`,
    );
    shellCommands.push(`chmod +x '${escapedScriptPath}'`);

    // Write additional files if provided
    // Paths are pre-validated (no absolute, no '..') in executeInContainer.
    if (options.additionalFiles) {
      for (const [filePath, content] of Object.entries(
        options.additionalFiles,
      )) {
        const encodedContent = Buffer.from(content).toString('base64');
        const targetPath = `/tmp/${filePath}`;
        const escapedTarget = targetPath.replace(/'/g, "'\\''");
        shellCommands.push(
          `printf '%s' "${encodedContent}" | base64 -d > '${escapedTarget}'`,
        );
      }
    }

    // Build the execution command with proper quoting
    const adjustedCommand = command.map((arg) =>
      arg === options.inlineScriptFileName ? scriptPath : arg,
    );
    const quotedCommand = adjustedCommand
      .map((arg) => {
        if (/[\s|&;<>()$`"'\\]/.test(arg)) {
          return `'${arg.replace(/'/g, "'\\''")}'`;
        }
        return arg;
      })
      .join(' ');
    shellCommands.push(quotedCommand);

    return shellCommands.join(' && ');
  }

  // =====================================================================
  //  Resource limit validation
  // =====================================================================

  /**
   * Validates resource limits to prevent invalid configurations.
   */
  validateResourceLimits(limits: {
    memoryLimitMb: number;
    cpuLimit: number;
    timeoutMs: number;
  }): ValidatedLimits {
    const MIN_MEMORY_MB = 128;
    const MAX_MEMORY_MB = 8192;
    const MIN_CPU = 0.1;
    const MAX_CPU = 4.0;
    const MIN_TIMEOUT_MS = 5000;
    const MAX_TIMEOUT_MS = 3600000;

    const errors: string[] = [];

    if (limits.memoryLimitMb < MIN_MEMORY_MB) {
      errors.push(
        `memoryLimitMb (${limits.memoryLimitMb}) is below minimum ${MIN_MEMORY_MB}MB`,
      );
    }
    if (limits.memoryLimitMb > MAX_MEMORY_MB) {
      errors.push(
        `memoryLimitMb (${limits.memoryLimitMb}) exceeds maximum ${MAX_MEMORY_MB}MB`,
      );
    }

    if (limits.cpuLimit < MIN_CPU) {
      errors.push(`cpuLimit (${limits.cpuLimit}) is below minimum ${MIN_CPU}`);
    }
    if (limits.cpuLimit > MAX_CPU) {
      errors.push(`cpuLimit (${limits.cpuLimit}) exceeds maximum ${MAX_CPU}`);
    }

    if (limits.timeoutMs < MIN_TIMEOUT_MS) {
      errors.push(
        `timeoutMs (${limits.timeoutMs}) is below minimum ${MIN_TIMEOUT_MS}ms`,
      );
    }
    if (limits.timeoutMs > MAX_TIMEOUT_MS) {
      errors.push(
        `timeoutMs (${limits.timeoutMs}) exceeds maximum ${MAX_TIMEOUT_MS}ms`,
      );
    }

    if (errors.length > 0) {
      return {
        valid: false,
        error: `Invalid resource limits: ${errors.join('; ')}`,
        memoryLimitMb: limits.memoryLimitMb,
        cpuLimit: limits.cpuLimit,
        timeoutMs: limits.timeoutMs,
      };
    }

    return {
      valid: true,
      memoryLimitMb: limits.memoryLimitMb,
      cpuLimit: limits.cpuLimit,
      timeoutMs: limits.timeoutMs,
    };
  }
}
