/**
 * Secure Script Execution Service
 *
 * Production execution backend:
 *
 * - `kubernetes`: Used for both cloud and self-hosted Docker/K3s deployments.
 *   Creates an ephemeral Job in the
 *   `supercheck-execution` namespace so untrusted code is isolated away from the
 *   long-lived worker control plane.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-promise-reject-errors */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as path from 'path';
import * as tar from 'tar';
import type * as k8s from '@kubernetes/client-node';
import { Readable, Writable } from 'stream';
import { finished } from 'stream/promises';
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
  private static readonly WORKSPACE_ROOT = '/tmp/supercheck';
  private static readonly POST_EXECUTION_GRACE_SECONDS = 300;
  private static readonly DEFAULT_DNS_OPTIONS: ReadonlyArray<k8s.V1PodDNSConfigOption> =
    Object.freeze([
      { name: 'ndots', value: '1' },
      { name: 'timeout', value: '2' },
      { name: 'attempts', value: '3' },
    ]);
  private static readonly SLOW_POD_STARTUP_WARN_MS = 5_000;
  private static readonly OUTCOME_POLL_FAST_UNTIL_MS = 15_000;
  private static readonly OUTCOME_POLL_MEDIUM_UNTIL_MS = 120_000;
  private static readonly OUTCOME_POLL_FAST_MS = 1_000;
  private static readonly OUTCOME_POLL_MEDIUM_MS = 2_000;
  private static readonly OUTCOME_POLL_SLOW_MS = 5_000;
  private readonly activeCancellationIntervals: Set<NodeJS.Timeout> = new Set();

  /** Max combined stdout+stderr size in bytes (10 MB) */
  private static readonly MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

  /** Max artifact tar archive size in bytes (100 MB) */
  private static readonly MAX_ARTIFACT_ARCHIVE_BYTES = 100 * 1024 * 1024;

  /**
   * Memory overhead added to the pod memory limit to account for:
   * - gVisor Sentry process (~100 MB)
   * - /dev/shm tmpfs counts against cgroup memory in K8s (unlike Docker --shm-size)
   *
   * In Docker, --memory and --shm-size are independent limits.
   * In Kubernetes, emptyDir with medium: Memory counts against the container's
   * cgroup memory limit.  Without this headroom, tests that used close to the
   * Docker memory ceiling will OOM under K8s/gVisor.
   */
  private static readonly SHM_SIZE_MB = 512;
  private static readonly GVISOR_SENTRY_OVERHEAD_MB = 150;
  private static readonly TOTAL_MEMORY_OVERHEAD_MB =
    ContainerExecutorService.SHM_SIZE_MB +
    ContainerExecutorService.GVISOR_SENTRY_OVERHEAD_MB;

  /** Allowed filename pattern: alphanumeric, dots, hyphens, underscores */
  private static readonly SAFE_FILENAME_RE = /^[\w.-]+$/;
  private readonly defaultImage: string;
  private readonly executionNamespace: string;
  private readonly executionRuntimeClassName: string | undefined;
  private readonly executionNodeSelector?: Record<string, string>;
  private readonly executionTolerations?: k8s.V1Toleration[];
  private readonly executionDnsNameservers?: string[];
  private k8sModule: typeof import('@kubernetes/client-node') | null = null;
  private kubeConfig: k8s.KubeConfig | null = null;
  private batchApi: k8s.BatchV1Api | null = null;
  private coreApi: k8s.CoreV1Api | null = null;
  private logClient: k8s.Log | null = null;
  private execClient: k8s.Exec | null = null;
  private readonly runningJobs: Map<string, string> = new Map();
  /** Track pods that have already logged an exec failure at warn level to avoid log spam. */
  private readonly execFailureLogged: Set<string> = new Set();

  constructor(
    private configService: ConfigService,
    private cancellationService: CancellationService,
  ) {
    this.defaultImage = this.configService.get<string>(
      'WORKER_IMAGE',
      'ghcr.io/supercheck-io/supercheck/worker:latest',
    );
    this.executionNamespace = this.configService.get<string>(
      'EXECUTION_NAMESPACE',
      'supercheck-execution',
    );
    const runtimeClass = this.configService
      .get<string>('EXECUTION_RUNTIME_CLASS_NAME', 'gvisor')
      ?.trim();
    this.executionRuntimeClassName =
      runtimeClass === 'none' || runtimeClass === ''
        ? undefined
        : runtimeClass || 'gvisor';
    this.executionNodeSelector = this.parseExecutionNodeSelector(
      this.configService.get<string>('EXECUTION_NODE_SELECTOR'),
    );
    this.executionTolerations = this.parseExecutionTolerations(
      this.configService.get<string>('EXECUTION_TOLERATIONS_JSON'),
    );
    this.executionDnsNameservers = this.parseExecutionDnsNameservers(
      this.configService.get<string>('EXECUTION_DNS_NAMESERVERS'),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.ensureKubernetesClients();
    this.logger.log('Container executor initialized');
    this.logger.log(`Execution namespace: ${this.executionNamespace}`);
    this.logger.log(`Default execution image: ${this.defaultImage}`);
    this.logger.log(
      `Execution runtimeClassName: ${this.executionRuntimeClassName ?? 'none (default runtime)'}`,
    );
    if (!this.executionRuntimeClassName) {
      this.logger.warn(
        'Sandbox isolation is DISABLED (EXECUTION_RUNTIME_CLASS_NAME=none). ' +
          'User-submitted code will run without gVisor protection. ' +
          'Do NOT use this setting in production.',
      );
    }
    if (this.executionNodeSelector) {
      this.logger.log(
        `Execution nodeSelector: ${JSON.stringify(this.executionNodeSelector)}`,
      );
    }
    if (this.executionTolerations?.length) {
      this.logger.log(
        `Execution tolerations: ${JSON.stringify(this.executionTolerations)}`,
      );
    }
    if (this.executionDnsNameservers?.length) {
      this.logger.log(
        `Execution DNS nameservers: ${this.executionDnsNameservers.join(', ')} (dnsPolicy: None, ndots=1, timeout=2, attempts=3)`,
      );
    } else {
      this.logger.log(
        'Execution DNS policy: ClusterFirst with resolver options ndots=1, timeout=2, attempts=3',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Clear all cancellation intervals
    for (const interval of this.activeCancellationIntervals) {
      clearInterval(interval);
    }
    this.activeCancellationIntervals.clear();

    const jobCleanup = Array.from(this.runningJobs.entries()).map(
      async ([runId, jobName]) => {
        this.logger.warn(
          `Deleting orphaned execution job ${jobName} for ${runId}`,
        );
        await this.deleteExecutionJob(jobName);
      },
    );
    await Promise.allSettled(jobCleanup);
    this.runningJobs.clear();
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

    const normalizedOptions: ContainerExecutionOptions = {
      ...options,
    };

    // Validate additionalFiles keys — no path traversal, no absolute paths
    if (options.additionalFiles) {
      const sanitizedAdditionalFiles: Record<string, string> = {};
      for (const [filePath, content] of Object.entries(
        options.additionalFiles,
      )) {
        const normalizedFilePath = this.normalizeRelativeWorkspacePath(
          filePath,
          'additional file path',
        );
        if (!normalizedFilePath.valid) {
          return {
            success: false,
            exitCode: 1,
            stdout: '',
            stderr: `Invalid additional file path: ${filePath}`,
            duration: 0,
            timedOut: false,
            error:
              normalizedFilePath.error ||
              'Additional file path contains invalid characters',
          };
        }
        sanitizedAdditionalFiles[normalizedFilePath.normalized!] = content;
      }
      normalizedOptions.additionalFiles = sanitizedAdditionalFiles;
    }

    if (options.ensureDirectories) {
      const sanitizedEnsureDirectories: string[] = [];
      for (const dirPath of options.ensureDirectories) {
        const normalizedDirPath = this.normalizeWorkspaceScopedPath(
          dirPath,
          'ensure directory path',
          { allowWorkspaceRoot: true },
        );
        if (!normalizedDirPath.valid) {
          return {
            success: false,
            exitCode: 1,
            stdout: '',
            stderr: `Invalid ensure directory path: ${dirPath}`,
            duration: 0,
            timedOut: false,
            error:
              normalizedDirPath.error ||
              'Ensure directory path contains invalid characters',
          };
        }
        if (
          !sanitizedEnsureDirectories.includes(normalizedDirPath.normalized!)
        ) {
          sanitizedEnsureDirectories.push(normalizedDirPath.normalized!);
        }
      }
      normalizedOptions.ensureDirectories = sanitizedEnsureDirectories;
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

    if (options.extractFromContainer) {
      const normalizedExtractPath = this.normalizeWorkspaceScopedPath(
        options.extractFromContainer,
        'extractFromContainer',
        { allowWorkspaceRoot: true },
      );
      if (!normalizedExtractPath.valid) {
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: `Invalid extractFromContainer path: ${options.extractFromContainer}`,
          duration: 0,
          timedOut: false,
          error:
            normalizedExtractPath.error || 'Invalid extractFromContainer path',
        };
      }
      normalizedOptions.extractFromContainer = normalizedExtractPath.normalized;
    }

    // Default options
    const { timeoutMs = 300000, memoryLimitMb = 512, cpuLimit = 0.5 } = options;

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

    return this.executeInKubernetes(
      command,
      normalizedOptions,
      validatedLimits,
    );
  }

  private async ensureKubernetesClients(): Promise<void> {
    if (
      this.kubeConfig &&
      this.batchApi &&
      this.coreApi &&
      this.logClient &&
      this.execClient
    ) {
      return;
    }

    const k8sModule =
      this.k8sModule || (await import('@kubernetes/client-node'));
    this.k8sModule = k8sModule;

    const kubeConfig = new k8sModule.KubeConfig();
    kubeConfig.loadFromDefault();

    this.kubeConfig = kubeConfig;
    this.batchApi = kubeConfig.makeApiClient(k8sModule.BatchV1Api);
    this.coreApi = kubeConfig.makeApiClient(k8sModule.CoreV1Api);
    this.logClient = new k8sModule.Log(kubeConfig);
    this.execClient = new k8sModule.Exec(kubeConfig);
  }

  private static readonly CONTAINER_WORKER_DIR = '/worker';

  /**
   * Rewrites host-local worker paths to the container-internal `/worker` path.
   * When the worker process runs on the host (local dev), `resolveWorkerDir()`
   * returns `process.cwd()` (e.g. `/Users/x/Code/supercheck/worker`). These
   * host paths leak into command args and env vars passed by callers. Inside
   * the K8s execution container, all worker files live at `/worker`.
   */
  private rewriteHostPathsForContainer(
    value: string,
    hostWorkerDir: string,
  ): string {
    if (
      !hostWorkerDir ||
      hostWorkerDir === ContainerExecutorService.CONTAINER_WORKER_DIR
    ) {
      return value;
    }
    // Replace all occurrences of the host worker dir with /worker
    return value
      .split(hostWorkerDir)
      .join(ContainerExecutorService.CONTAINER_WORKER_DIR);
  }

  private async executeInKubernetes(
    command: string[],
    options: ContainerExecutionOptions,
    limits: ValidatedLimits,
  ): Promise<ContainerExecutionResult> {
    const startTime = Date.now();
    const workspace = this.buildWorkspacePath(options.runId);

    // The K8s container image always has worker files at /worker.
    // When running locally, callers pass host-local paths (e.g. process.cwd())
    // which must be rewritten to /worker for the container.
    const hostWorkerDir =
      options.workingDir || ContainerExecutorService.CONTAINER_WORKER_DIR;
    const workingDir = ContainerExecutorService.CONTAINER_WORKER_DIR;

    // Rewrite host-local paths in command args
    const containerCommand = command.map((arg) =>
      this.rewriteHostPathsForContainer(arg, hostWorkerDir),
    );

    // Rewrite host-local paths in env vars
    const containerOptions = { ...options, workingDir };
    if (options.env) {
      const rewrittenEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(options.env)) {
        rewrittenEnv[key] = this.rewriteHostPathsForContainer(
          value,
          hostWorkerDir,
        );
      }
      containerOptions.env = rewrittenEnv;
    }

    const shellScript = this.buildShellScript(
      { ...containerOptions, _workspace: workspace },
      containerCommand,
    );
    const jobName = this.buildExecutionJobName(options.runId);

    let podName: string | null = null;
    let logAbort: AbortController | null = null;
    let cancellationInterval: NodeJS.Timeout | null = null;
    let killed = false;
    let timedOut = false;
    let combinedLogs = '';
    let podStartupDurationMs = 0;
    let artifactExtractionDurationMs = 0;
    const logCollector = this.createLogCollector(options);

    try {
      await this.ensureKubernetesClients();

      const job = this.buildExecutionJob({
        jobName,
        workspace,
        shellScript,
        workingDir,
        limits,
        options: containerOptions,
      });

      await this.batchApi!.createNamespacedJob({
        namespace: this.executionNamespace,
        body: job,
      });

      if (options.runId) {
        this.runningJobs.set(options.runId, jobName);
        cancellationInterval = this.startKubernetesCancellationPoller(
          options.runId,
          jobName,
          () => {
            killed = true;
          },
        );
      }

      const podWaitStartedAt = Date.now();
      podName = await this.waitForExecutionPod(jobName);
      podStartupDurationMs = Date.now() - podWaitStartedAt;
      if (
        podStartupDurationMs > ContainerExecutorService.SLOW_POD_STARTUP_WARN_MS
      ) {
        this.logger.warn(
          `[${jobName}] Execution pod ${podName} became visible after ${podStartupDurationMs}ms. Slow startup usually indicates image pull, scheduling pressure, or cluster DNS/network latency.`,
        );
      } else {
        this.logger.debug(
          `[${jobName}] Execution pod ${podName} became visible after ${podStartupDurationMs}ms`,
        );
      }

      logAbort = this.startLogStreamWithReconnect(
        podName,
        logCollector.stream,
        jobName,
      );

      const outcome = await this.waitForExecutionOutcome(
        podName,
        workspace,
        limits.timeoutMs,
      );
      timedOut = outcome.timedOut;
      killed = killed || outcome.cancelled;

      if (
        options.extractFromContainer &&
        options.extractToHost &&
        !timedOut &&
        !killed
      ) {
        const extractSource = this.rewriteTmpPath(
          options.extractFromContainer,
          workspace,
        );
        const extractionStartedAt = Date.now();
        try {
          await this.extractPodArtifacts(
            podName,
            extractSource,
            options.extractToHost,
            workspace,
          );
          artifactExtractionDurationMs = Date.now() - extractionStartedAt;
          this.logger.debug(
            `[${jobName}] Extracted artifacts from ${podName} in ${artifactExtractionDurationMs}ms`,
          );
        } catch (extractError) {
          artifactExtractionDurationMs = Date.now() - extractionStartedAt;
          this.logger.error(
            `Failed to extract pod artifacts after ${artifactExtractionDurationMs}ms: ${
              extractError instanceof Error
                ? extractError.message
                : String(extractError)
            }`,
          );
        }
      }

      if (!timedOut && !killed && podName) {
        await this.signalExecutionExit(podName, workspace).catch(
          (signalError) => {
            this.logger.debug(
              `Failed to signal execution pod exit for ${podName}: ${
                signalError instanceof Error
                  ? signalError.message
                  : String(signalError)
              }`,
            );
          },
        );
      }

      if (logAbort) {
        logAbort.abort();
      }

      combinedLogs = logCollector.getOutput();
      const finalLogs = await this.fetchPodLogsSnapshot(podName).catch(
        () => combinedLogs,
      );
      if (finalLogs.length >= combinedLogs.length) {
        combinedLogs = finalLogs;
      }

      const duration = Date.now() - startTime;
      const exitCode = killed
        ? 137
        : (outcome.exitCode ?? (timedOut ? 124 : 1));
      this.logger.log(
        `[${jobName}] Execution finished exitCode=${exitCode} duration=${duration}ms podStartup=${podStartupDurationMs}ms artifactExtraction=${artifactExtractionDurationMs}ms timedOut=${timedOut} cancelled=${killed}`,
      );

      return {
        success: exitCode === 0 && !timedOut && !killed,
        exitCode,
        stdout: combinedLogs,
        stderr: '',
        duration,
        timedOut,
        error: timedOut
          ? `Execution timed out after ${limits.timeoutMs}ms`
          : killed
            ? 'Execution cancelled (exit code 137)'
            : exitCode !== 0
              ? outcome.message || `Process exited with code ${exitCode}`
              : undefined,
      };
    } catch (error) {
      return {
        success: false,
        exitCode: 1,
        stdout: logCollector.getOutput(),
        stderr: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        timedOut,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (logAbort) {
        logAbort.abort();
      }
      if (cancellationInterval) {
        clearInterval(cancellationInterval);
        this.activeCancellationIntervals.delete(cancellationInterval);
      }
      if (options.runId) {
        this.runningJobs.delete(options.runId);
      }
      if (podName) {
        this.execFailureLogged.delete(podName);
      }
      await this.deleteExecutionJob(jobName);
    }
  }

  private buildExecutionJob(params: {
    jobName: string;
    workspace: string;
    shellScript: string;
    workingDir: string;
    limits: ValidatedLimits;
    options: ContainerExecutionOptions;
  }): k8s.V1Job {
    const { jobName, workspace, shellScript, workingDir, limits, options } =
      params;
    const image = options.image || this.defaultImage;
    const envVars = this.buildKubernetesEnv(options.env, workspace);
    const dnsSettings = this.buildExecutionPodDnsSettings();
    const deadlineSeconds = Math.ceil((limits.timeoutMs + 120_000) / 1000);
    const resourceCpuLimit = `${Math.max(100, Math.round(limits.cpuLimit * 1000))}m`;
    const resourceCpuRequest = `${Math.max(100, Math.round(limits.cpuLimit * 500))}m`;
    // Add overhead for /dev/shm tmpfs (counts against cgroup in K8s) and gVisor Sentry
    const effectiveMemoryMb =
      limits.memoryLimitMb + ContainerExecutorService.TOTAL_MEMORY_OVERHEAD_MB;
    const resourceMemoryLimit = `${effectiveMemoryMb}Mi`;
    const resourceMemoryRequest = `${Math.max(128, Math.round(effectiveMemoryMb * 0.75))}Mi`;
    const exitCodeFile = this.getWorkspaceExitCodeFile(workspace);
    const exitSignalFile = this.getWorkspaceExitSignalFile(workspace);
    const wrappedScript = this.buildKubernetesWrapperScript(
      shellScript,
      exitCodeFile,
      exitSignalFile,
    );
    const runLabel = this.buildLabelValue(options.runId);

    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace: this.executionNamespace,
        labels: {
          'app.kubernetes.io/managed-by': 'supercheck-worker',
          'app.kubernetes.io/component': 'execution',
          'supercheck.io/run-id': runLabel,
        },
      },
      spec: {
        ttlSecondsAfterFinished: 600,
        backoffLimit: 0,
        activeDeadlineSeconds: deadlineSeconds,
        template: {
          metadata: {
            labels: {
              'app.kubernetes.io/managed-by': 'supercheck-worker',
              'app.kubernetes.io/component': 'execution',
              'supercheck.io/run-id': runLabel,
            },
          },
          spec: {
            ...(this.executionRuntimeClassName
              ? { runtimeClassName: this.executionRuntimeClassName }
              : {}),
            restartPolicy: 'Never',
            automountServiceAccountToken: false,
            enableServiceLinks: false,
            terminationGracePeriodSeconds: 1,
            nodeSelector: this.executionNodeSelector,
            tolerations: this.executionTolerations,
            ...dnsSettings,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              fsGroup: 1000,
              seccompProfile: { type: 'RuntimeDefault' },
            },
            containers: [
              {
                name: 'execution',
                image,
                imagePullPolicy: 'IfNotPresent',
                command: ['/bin/sh', '-c', wrappedScript],
                workingDir,
                env: envVars,
                resources: {
                  requests: {
                    cpu: resourceCpuRequest,
                    memory: resourceMemoryRequest,
                  },
                  limits: {
                    cpu: resourceCpuLimit,
                    memory: resourceMemoryLimit,
                  },
                },
                securityContext: {
                  runAsNonRoot: true,
                  runAsUser: 1000,
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  capabilities: {
                    drop: ['ALL'],
                  },
                  seccompProfile: {
                    type: 'RuntimeDefault',
                  },
                },
                volumeMounts: [
                  {
                    name: 'tmp',
                    mountPath: '/tmp',
                  },
                  {
                    name: 'dshm',
                    mountPath: '/dev/shm',
                  },
                ],
              },
            ],
            volumes: [
              {
                name: 'tmp',
                emptyDir: {},
              },
              {
                name: 'dshm',
                emptyDir: {
                  medium: 'Memory',
                  sizeLimit: `${ContainerExecutorService.SHM_SIZE_MB}Mi`,
                },
              },
            ],
          },
        },
      },
    };
  }

  private buildExecutionPodDnsSettings(): Pick<
    k8s.V1PodSpec,
    'dnsPolicy' | 'dnsConfig'
  > {
    const options = [...ContainerExecutorService.DEFAULT_DNS_OPTIONS];

    if (this.executionDnsNameservers?.length) {
      return {
        dnsPolicy: 'None',
        dnsConfig: {
          nameservers: this.executionDnsNameservers,
          searches: [
            `${this.executionNamespace}.svc.cluster.local`,
            'svc.cluster.local',
            'cluster.local',
          ],
          options,
        },
      };
    }

    return {
      dnsPolicy: 'ClusterFirst',
      dnsConfig: {
        options,
      },
    };
  }

  private buildKubernetesWrapperScript(
    shellScript: string,
    exitCodeFile: string,
    exitSignalFile: string,
  ): string {
    const escapedExitCodeFile = this.escapeShellArg(exitCodeFile);
    const escapedExitSignalFile = this.escapeShellArg(exitSignalFile);
    return [
      `(${shellScript})`,
      'EXIT_CODE=$?',
      `printf '%s' "$EXIT_CODE" > ${escapedExitCodeFile}`,
      "trap 'exit $EXIT_CODE' TERM INT",
      `DEADLINE=$(( $(date +%s) + ${ContainerExecutorService.POST_EXECUTION_GRACE_SECONDS} ))`,
      `while [ ! -f ${escapedExitSignalFile} ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do sleep 1; done`,
      'exit $EXIT_CODE',
    ].join('; ');
  }

  private buildKubernetesEnv(
    env: Record<string, string> | undefined,
    workspace: string,
  ): k8s.V1EnvVar[] {
    const merged = new Map<string, string>([
      ['HOME', `${workspace}/home`],
      ['npm_config_cache', `${workspace}/.npm`],
      ['NPM_CONFIG_CACHE', `${workspace}/.npm`],
      ['TMPDIR', workspace],
      ['TEMP', workspace],
      ['TMP', workspace],
    ]);

    if (env) {
      for (const [name, value] of Object.entries(env)) {
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
          merged.set(name, this.rewriteTmpPath(value, workspace));
        }
      }
    }

    return Array.from(merged.entries()).map(([name, value]) => ({
      name,
      value,
    }));
  }

  private buildExecutionJobName(runId?: string): string {
    const suffix = crypto
      .createHash('sha256')
      .update(runId || crypto.randomUUID())
      .digest('hex')
      .slice(0, 20);
    return `sc-exec-${suffix}`;
  }

  private buildLabelValue(value?: string): string {
    const normalized = (value || crypto.randomUUID())
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!normalized) {
      return 'unknown';
    }
    return normalized.slice(0, 63);
  }

  private async waitForExecutionPod(jobName: string): Promise<string> {
    const timeoutAt = Date.now() + 120_000;
    const labelSelector = `job-name=${jobName}`;

    while (Date.now() < timeoutAt) {
      const pods = await this.coreApi!.listNamespacedPod({
        namespace: this.executionNamespace,
        labelSelector,
      });
      const pod = pods.items[0];
      if (pod?.metadata?.name) {
        // Return as soon as the pod exists (even in Pending phase).
        // On cold nodes, image pulls for the 3+ GB worker image can take
        // minutes — blocking here until Running would cause spurious
        // "did not appear within 120s" failures.
        // The log stream's reconnect logic handles 400 errors from the
        // API server while the container is still starting up.
        return pod.metadata.name;
      }
      await this.sleep(1000);
    }

    throw new Error(
      `Execution pod for job ${jobName} did not appear within 120s`,
    );
  }

  private createLogCollector(options: ContainerExecutionOptions): {
    stream: Writable & {
      suppressLiveForwarding: () => void;
      resumeLiveForwarding: () => void;
    };
    getOutput: () => string;
    suppressLiveForwarding: () => void;
    resumeLiveForwarding: () => void;
  } {
    let output = '';
    let suppressLive = false;
    const stream = new Writable({
      write: (chunk, _encoding, callback) => {
        const text = Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk);
        if (output.length < ContainerExecutorService.MAX_OUTPUT_BYTES) {
          output += text;
        }
        // Skip forwarding during reconnect replay to avoid duplicating
        // lines in the live console. The buffer still accumulates for the
        // final snapshot (which replaces it anyway).
        if (!suppressLive && options.onStdoutChunk) {
          try {
            void options.onStdoutChunk(text);
          } catch {
            /* ignore log callback failures */
          }
        }
        callback();
      },
    });
    const streamWithControls = Object.assign(stream, {
      suppressLiveForwarding: () => {
        suppressLive = true;
      },
      resumeLiveForwarding: () => {
        suppressLive = false;
      },
    });

    return {
      stream: streamWithControls,
      getOutput: () => output,
      suppressLiveForwarding: streamWithControls.suppressLiveForwarding,
      resumeLiveForwarding: streamWithControls.resumeLiveForwarding,
    };
  }

  /**
   * Start log streaming with automatic reconnect on network errors.
   *
   * K8s log follow streams can disconnect prematurely due to API server
   * timeouts, load-balancer idle timeouts, or transient network blips.
   * When the stream drops, we wait briefly and reconnect using
   * `sinceSeconds` so the API server resumes from roughly where we left
   * off (duplicates are harmless — the collector appends to the same
   * buffer and the final snapshot replaces it anyway).
   *
   * Completion is determined by `waitForExecutionOutcome()` (exit-code
   * file polling), NOT by the log stream lifecycle.
   *
   * On reconnect, `sinceSeconds: 5` replays the last few seconds to
   * avoid gaps. The collector's live-forwarding is suppressed during
   * the replay window so duplicate lines are not published to the
   * live console via `onStdoutChunk`.
   */
  private startLogStreamWithReconnect(
    podName: string,
    sink: Writable & {
      suppressLiveForwarding?: () => void;
      resumeLiveForwarding?: () => void;
    },
    jobName: string,
  ): AbortController {
    const controller = new AbortController();
    const reconnectDelayMs = 2_000;
    // Allow up to 60 reconnect attempts (~2 min) so that cold-node image
    // pulls (3+ GB worker image) don't exhaust reconnects before the
    // container starts.  Once the stream is established the reconnect
    // counter only matters for mid-stream network blips, which are rare.
    const maxReconnects = 60;
    const sinceSecondsOnReconnect = 5;

    const connect = async (attempt: number) => {
      if (controller.signal.aborted) return;

      // On reconnect, suppress live forwarding for the replay window
      // to prevent duplicating lines in the user-visible streaming output.
      let replayTimer: ReturnType<typeof setTimeout> | null = null;
      if (attempt > 0 && sink.suppressLiveForwarding) {
        sink.suppressLiveForwarding();
        // Resume after the replay window (sinceSeconds + reconnect delay buffer)
        replayTimer = setTimeout(
          () => {
            sink.resumeLiveForwarding?.();
            replayTimer = null;
          },
          (sinceSecondsOnReconnect + 1) * 1_000,
        );
      }

      try {
        const abort = await this.logClient!.log(
          this.executionNamespace,
          podName,
          'execution',
          sink,
          {
            follow: true,
            timestamps: false,
            ...(attempt > 0 ? { sinceSeconds: sinceSecondsOnReconnect } : {}),
          },
        );

        // When the outer controller is aborted, also abort the active stream.
        const onAbort = () => abort.abort();
        controller.signal.addEventListener('abort', onAbort, { once: true });

        // Listen for the underlying response closing unexpectedly.
        // The K8s client resolves the log call immediately once the
        // stream is established; the actual data flows via piping.
        // We detect disconnects through the response's 'close' / 'error'
        // events surfacing on the underlying socket, which k8s client-node
        // propagates by aborting its own internal controller.
        abort.signal.addEventListener(
          'abort',
          () => {
            controller.signal.removeEventListener('abort', onAbort);
            if (replayTimer) {
              clearTimeout(replayTimer);
              sink.resumeLiveForwarding?.();
            }
            if (!controller.signal.aborted && attempt < maxReconnects) {
              this.logger.warn(
                `Log stream for ${jobName} disconnected (attempt ${attempt + 1}/${maxReconnects}), reconnecting in ${reconnectDelayMs}ms`,
              );
              setTimeout(() => connect(attempt + 1), reconnectDelayMs);
            }
          },
          { once: true },
        );
      } catch (error) {
        if (replayTimer) {
          clearTimeout(replayTimer);
          sink.resumeLiveForwarding?.();
        }
        if (controller.signal.aborted) return;
        if (attempt < maxReconnects) {
          this.logger.warn(
            `Failed to start log stream for ${jobName} (attempt ${attempt + 1}/${maxReconnects}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          setTimeout(() => connect(attempt + 1), reconnectDelayMs);
        } else {
          this.logger.warn(
            `Exhausted log stream reconnect attempts for ${jobName}; final logs will be fetched via snapshot`,
          );
        }
      }
    };

    void connect(0);
    return controller;
  }

  private async fetchPodLogsSnapshot(podName: string): Promise<string> {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write: (chunk, _encoding, callback) => {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
        );
        callback();
      },
    });

    await this.logClient!.log(
      this.executionNamespace,
      podName,
      'execution',
      sink,
      { follow: false, timestamps: false },
    );
    await finished(sink);

    return Buffer.concat(chunks).toString('utf8');
  }

  private async waitForExecutionOutcome(
    podName: string,
    workspace: string,
    timeoutMs: number,
  ): Promise<{
    exitCode: number;
    timedOut: boolean;
    cancelled: boolean;
    message?: string;
  }> {
    const startedAt = Date.now();
    const timeoutAt = Date.now() + timeoutMs;
    const exitCodeFile = this.getWorkspaceExitCodeFile(workspace);

    while (Date.now() < timeoutAt) {
      const exitCode = await this.readExecutionExitCode(podName, exitCodeFile);
      if (exitCode !== null) {
        return {
          exitCode,
          timedOut: false,
          cancelled: false,
        };
      }

      let pod;
      try {
        pod = await this.coreApi!.readNamespacedPod({
          name: podName,
          namespace: this.executionNamespace,
        });
      } catch (podError) {
        const msg =
          podError instanceof Error ? podError.message : String(podError);
        if (
          msg.includes('404') ||
          msg.includes('NotFound') ||
          msg.includes('not found')
        ) {
          // Pod was deleted externally — most likely by the cancellation poller.
          // Treat as a user-initiated cancellation so processors record it correctly
          // instead of returning a generic exitCode=1 failure.
          this.logger.warn(
            `Pod ${podName} no longer exists — treating as cancellation`,
          );
          return {
            exitCode: 137,
            timedOut: false,
            cancelled: true,
            message: 'Pod deleted during execution (cancelled)',
          };
        }
        throw podError;
      }

      const terminated = pod.status?.containerStatuses?.find(
        (container) => container.name === 'execution',
      )?.state?.terminated;
      if (terminated) {
        const timedOut =
          terminated.reason === 'DeadlineExceeded' ||
          terminated.message?.includes('DeadlineExceeded') === true;
        return {
          exitCode: terminated.exitCode ?? (timedOut ? 124 : 1),
          timedOut,
          cancelled: terminated.exitCode === 137,
          message: terminated.message || terminated.reason,
        };
      }

      await this.sleep(
        this.getExecutionOutcomePollIntervalMs(startedAt, timeoutAt),
      );
    }

    return {
      exitCode: 124,
      timedOut: true,
      cancelled: false,
      message: `Execution timed out after ${timeoutMs}ms`,
    };
  }

  private getExecutionOutcomePollIntervalMs(
    startedAt: number,
    timeoutAt: number,
  ): number {
    const elapsedMs = Date.now() - startedAt;
    let intervalMs = ContainerExecutorService.OUTCOME_POLL_SLOW_MS;

    if (elapsedMs < ContainerExecutorService.OUTCOME_POLL_FAST_UNTIL_MS) {
      intervalMs = ContainerExecutorService.OUTCOME_POLL_FAST_MS;
    } else if (
      elapsedMs < ContainerExecutorService.OUTCOME_POLL_MEDIUM_UNTIL_MS
    ) {
      intervalMs = ContainerExecutorService.OUTCOME_POLL_MEDIUM_MS;
    }

    const remainingMs = Math.max(250, timeoutAt - Date.now());
    return Math.min(intervalMs, remainingMs);
  }

  private async readExecutionExitCode(
    podName: string,
    exitCodeFile: string,
  ): Promise<number | null> {
    const command = [
      '/bin/sh',
      '-c',
      `if [ -f ${this.escapeShellArg(exitCodeFile)} ]; then cat ${this.escapeShellArg(exitCodeFile)}; fi`,
    ];
    const stdout = await this.execInPod(podName, command).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Log exec failures at warn level on first occurrence so RBAC / connectivity
      // problems are immediately visible in production instead of being silently
      // swallowed at debug level for the entire timeout window.
      if (!this.execFailureLogged.has(podName)) {
        this.execFailureLogged.add(podName);
        this.logger.warn(
          `Exit code read via exec failed for ${podName} (will retry silently): ${msg}`,
        );
      } else {
        this.logger.debug(`Exit code read failed for ${podName}: ${msg}`);
      }
      return '';
    });
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }

    const exitCode = Number.parseInt(trimmed, 10);
    return Number.isFinite(exitCode) ? exitCode : null;
  }

  private async execInPod(podName: string, command: string[]): Promise<string> {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdout = new Writable({
      write: (chunk, _encoding, callback) => {
        stdoutChunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
        );
        callback();
      },
    });
    const stderr = new Writable({
      write: (chunk, _encoding, callback) => {
        stderrChunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
        );
        callback();
      },
    });

    const socket = await this.execClient!.exec(
      this.executionNamespace,
      podName,
      'execution',
      command,
      stdout,
      stderr,
      null,
      false,
    );

    await new Promise<void>((resolve, reject) => {
      socket.on('close', () => resolve());
      socket.on('error', (error) => reject(error));
    });

    const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();
    if (stderrText) {
      this.logger.debug(`exec stderr from ${podName}: ${stderrText}`);
    }

    return Buffer.concat(stdoutChunks).toString('utf8');
  }

  private async signalExecutionExit(
    podName: string,
    workspace: string,
  ): Promise<void> {
    const exitSignalFile = this.getWorkspaceExitSignalFile(workspace);
    await this.execInPod(podName, [
      '/bin/sh',
      '-c',
      `touch ${this.escapeShellArg(exitSignalFile)}`,
    ]);
  }

  private async extractPodArtifacts(
    podName: string,
    sourcePath: string,
    destPath: string,
    workspaceRoot: string,
  ): Promise<void> {
    const cleanSource = sourcePath.replace(/\/\.$/g, '');
    if (!this.isPathWithinBase(cleanSource, workspaceRoot)) {
      throw new Error(
        `Refusing to extract artifacts outside workspace: ${cleanSource}`,
      );
    }

    const archive = await this.capturePodTarStream(podName, cleanSource);
    if (archive.length === 0) {
      this.logger.debug(`No artifacts found at ${cleanSource} in ${podName}`);
      return;
    }

    await fs.mkdir(destPath, { recursive: true });
    await this.validateTarArchive(archive);
    const extractor = tar.x({
      cwd: destPath,
      preservePaths: false,
      strict: true,
      filter: (entryPath, entry) => {
        this.validateTarEntry(entryPath, entry);
        return true;
      },
    });
    await finished(Readable.from(archive).pipe(extractor));
  }

  private async capturePodTarStream(
    podName: string,
    sourcePath: string,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const stdout = new Writable({
      write: (chunk, _encoding, callback) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > ContainerExecutorService.MAX_ARTIFACT_ARCHIVE_BYTES) {
          callback(
            new Error(
              `Artifact archive exceeded ${ContainerExecutorService.MAX_ARTIFACT_ARCHIVE_BYTES} bytes`,
            ),
          );
          return;
        }
        chunks.push(buffer);
        callback();
      },
    });
    const stderrChunks: Buffer[] = [];
    const stderr = new Writable({
      write: (chunk, _encoding, callback) => {
        stderrChunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
        );
        callback();
      },
    });

    const command = [
      '/bin/sh',
      '-c',
      `if [ -e ${this.escapeShellArg(sourcePath)} ]; then tar cf - -C ${this.escapeShellArg(sourcePath)} .; fi`,
    ];
    const socket = await this.execClient!.exec(
      this.executionNamespace,
      podName,
      'execution',
      command,
      stdout,
      stderr,
      null,
      false,
    );

    await new Promise<void>((resolve, reject) => {
      socket.on('close', () => resolve());
      socket.on('error', (error) => reject(error));
    });

    const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();
    if (stderrText) {
      throw new Error(`tar extraction failed: ${stderrText}`);
    }

    return Buffer.concat(chunks);
  }

  private async validateTarArchive(archive: Buffer): Promise<void> {
    const parser = tar.t({
      onReadEntry: (entry) => {
        this.validateTarEntry(entry.path, entry);
        entry.resume();
      },
    });
    await finished(Readable.from(archive).pipe(parser));
  }

  private validateTarEntry(entryPath: string, entry: unknown): void {
    const normalized = entryPath.replace(/\\/g, '/');
    if (
      path.posix.isAbsolute(normalized) ||
      normalized.split('/').includes('..')
    ) {
      throw new Error(`Unsafe path in artifact archive: ${entryPath}`);
    }

    const disallowedTypes = new Set([
      'SymbolicLink',
      'Link',
      'CharacterDevice',
      'BlockDevice',
      'FIFO',
      'ContiguousFile',
    ]);
    const entryType =
      entry && typeof entry === 'object' && 'type' in entry
        ? (entry as { type?: string }).type
        : undefined;
    if (entryType && disallowedTypes.has(entryType)) {
      throw new Error(`Unsupported artifact entry type: ${entryType}`);
    }
  }

  private getWorkspaceExitCodeFile(workspace: string): string {
    return `${workspace}/.supercheck-exit-code`;
  }

  private getWorkspaceExitSignalFile(workspace: string): string {
    return `${workspace}/.supercheck-exit-now`;
  }

  private rewriteTmpPath(value: string, workspace: string): string {
    if (value.startsWith('/tmp/')) {
      return this.resolveWorkspacePath(workspace, value);
    }
    if (value === '/tmp' || value === '/tmp/') {
      return workspace;
    }
    return value;
  }

  private escapeShellArg(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  private startKubernetesCancellationPoller(
    runId: string,
    jobName: string,
    onCancelled: () => void,
  ): NodeJS.Timeout {
    const interval = setInterval(() => {
      void (async () => {
        try {
          const isCancelled = await this.cancellationService.isCancelled(runId);
          if (!isCancelled) {
            return;
          }

          this.logger.warn(
            `[${runId}] Cancellation detected — deleting execution job ${jobName}`,
          );
          onCancelled();
          await this.deleteExecutionJob(jobName);
          await this.cancellationService.clearCancellationSignal(runId);
          clearInterval(interval);
          this.activeCancellationIntervals.delete(interval);
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

  private async deleteExecutionJob(jobName: string): Promise<void> {
    if (!jobName) {
      return;
    }

    try {
      await this.ensureKubernetesClients();
      await this.batchApi!.deleteNamespacedJob({
        name: jobName,
        namespace: this.executionNamespace,
        gracePeriodSeconds: 0,
        propagationPolicy: 'Background',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('404') &&
        !message.includes('NotFound') &&
        !message.includes('not found')
      ) {
        this.logger.warn(
          `Failed to delete execution job ${jobName}: ${message}`,
        );
      }
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildWorkspacePath(runId?: string): string {
    const rawToken = runId || crypto.randomUUID();
    const safeToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex')
      .slice(0, 24);
    return `${ContainerExecutorService.WORKSPACE_ROOT}/run-${safeToken}`;
  }

  private isPathWithinBase(candidatePath: string, basePath: string): boolean {
    const normalizedBase = path.posix.normalize(basePath).replace(/\/+$/, '');
    const normalizedCandidate = path.posix.normalize(candidatePath);
    return (
      normalizedCandidate === normalizedBase ||
      normalizedCandidate.startsWith(`${normalizedBase}/`)
    );
  }

  private normalizeRelativeWorkspacePath(
    value: string,
    label: string,
  ): { valid: boolean; normalized?: string; error?: string } {
    return this.normalizeWorkspaceScopedPath(value, label, {
      allowAbsoluteTmp: false,
      allowWorkspaceRoot: false,
    });
  }

  private normalizeWorkspaceScopedPath(
    value: string,
    label: string,
    options: { allowAbsoluteTmp?: boolean; allowWorkspaceRoot?: boolean } = {},
  ): { valid: boolean; normalized?: string; error?: string } {
    const { allowAbsoluteTmp = true, allowWorkspaceRoot = false } = options;

    if (!value || typeof value !== 'string') {
      return {
        valid: false,
        error: `${label} must be a non-empty string`,
      };
    }

    if (/[\0\r\n]/.test(value)) {
      return {
        valid: false,
        error: `${label} contains invalid control characters`,
      };
    }

    const normalizedInput = path.posix.normalize(value.replace(/\\/g, '/'));
    if (
      allowAbsoluteTmp &&
      (normalizedInput === '/tmp' || normalizedInput.startsWith('/tmp/'))
    ) {
      return {
        valid: true,
        normalized: normalizedInput,
      };
    }

    if (path.posix.isAbsolute(normalizedInput)) {
      return {
        valid: false,
        error: `${label} must stay within the execution workspace`,
      };
    }

    if (normalizedInput === '..' || normalizedInput.startsWith('../')) {
      return {
        valid: false,
        error: `${label} must not escape the execution workspace`,
      };
    }

    if (normalizedInput === '.') {
      return allowWorkspaceRoot
        ? { valid: true, normalized: normalizedInput }
        : {
            valid: false,
            error: `${label} must point to a child path inside the execution workspace`,
          };
    }

    if (!normalizedInput || normalizedInput === '/') {
      return {
        valid: false,
        error: `${label} must be a non-empty path`,
      };
    }

    return {
      valid: true,
      normalized: normalizedInput,
    };
  }

  private resolveWorkspacePath(
    workspace: string,
    containerPath: string,
  ): string {
    const normalizedPath = path.posix.normalize(
      containerPath.replace(/\\/g, '/'),
    );
    if (normalizedPath === '/tmp' || normalizedPath === '/tmp/') {
      return workspace;
    }
    if (normalizedPath.startsWith('/tmp/')) {
      return path.posix.join(workspace, normalizedPath.slice('/tmp/'.length));
    }
    if (normalizedPath === '.') {
      return workspace;
    }
    return path.posix.join(workspace, normalizedPath);
  }

  private parseExecutionNodeSelector(
    rawValue?: string,
  ): Record<string, string> | undefined {
    const trimmed = rawValue?.trim();
    if (!trimmed) {
      return undefined;
    }

    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
          throw new Error('value must be a JSON object');
        }

        const selector = Object.fromEntries(
          Object.entries(parsed).flatMap(([key, value]) => {
            if (!key.trim() || typeof value !== 'string' || !value.trim()) {
              return [];
            }
            return [[key.trim(), value.trim()]];
          }),
        );

        return Object.keys(selector).length > 0 ? selector : undefined;
      } catch (error) {
        this.logger.warn(
          `Invalid EXECUTION_NODE_SELECTOR value; ignoring custom selector: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return undefined;
      }
    }

    const selector: Record<string, string> = {};
    for (const rawPair of trimmed.split(',')) {
      const [rawKey, ...rawValueParts] = rawPair.split('=');
      const key = rawKey?.trim();
      const value = rawValueParts.join('=').trim();
      if (!key || !value) {
        this.logger.warn(
          'Invalid EXECUTION_NODE_SELECTOR value; expected key=value pairs',
        );
        return undefined;
      }
      selector[key] = value;
    }

    return Object.keys(selector).length > 0 ? selector : undefined;
  }

  private parseExecutionTolerations(
    rawValue?: string,
  ): k8s.V1Toleration[] | undefined {
    const trimmed = rawValue?.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error('value must be a JSON array');
      }

      const tolerations = parsed.filter(
        (item): item is k8s.V1Toleration =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      );

      return tolerations.length > 0 ? tolerations : undefined;
    } catch (error) {
      this.logger.warn(
        `Invalid EXECUTION_TOLERATIONS_JSON value; ignoring custom tolerations: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  /**
   * Parses EXECUTION_DNS_NAMESERVERS into a list of IP addresses.
   * Accepts a comma-separated string of nameserver IPs.
   * Example: "169.254.20.10,10.43.0.10"
   *
   * When set, execution pods use dnsPolicy: None with these explicit
   * nameservers. When not set, pods use the default ClusterFirst policy.
   */
  private parseExecutionDnsNameservers(
    rawValue?: string,
  ): string[] | undefined {
    const trimmed = rawValue?.trim();
    if (!trimmed) {
      return undefined;
    }

    const nameservers = Array.from(
      new Set(trimmed.split(',').map((ns) => ns.trim())),
    ).filter((ns) => {
      if (!ns) return false;
      if (!this.isValidIpv4Address(ns)) {
        this.logger.warn(
          `Invalid nameserver IP in EXECUTION_DNS_NAMESERVERS: "${ns}"; skipping`,
        );
        return false;
      }
      return true;
    });

    return nameservers.length > 0 ? nameservers : undefined;
  }

  private isValidIpv4Address(value: string): boolean {
    const octets = value.split('.');
    if (octets.length !== 4) {
      return false;
    }

    return octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) {
        return false;
      }
      const numericValue = Number.parseInt(octet, 10);
      return numericValue >= 0 && numericValue <= 255;
    });
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
    options: ContainerExecutionOptions & { _workspace?: string },
    command: string[],
  ): string {
    const shellCommands: string[] = [];

    // Per-run workspace: isolates each execution to prevent cross-tenant
    // file contamination (GVISOR-002). Production always uses a dedicated
    // hashed workspace under /tmp/supercheck.
    const ws = options._workspace || this.buildWorkspacePath(options.runId);
    shellCommands.push(`mkdir -p '${ws.replace(/'/g, "'\\''")}'`);

    // Ensure required directories exist before writing files
    if (options.ensureDirectories && options.ensureDirectories.length > 0) {
      const uniqueDirs = Array.from(new Set(options.ensureDirectories));
      for (const dir of uniqueDirs) {
        if (!dir || typeof dir !== 'string') {
          continue;
        }
        const resolvedDir = this.resolveWorkspacePath(ws, dir);
        const escapedDir = resolvedDir.replace(/'/g, "'\\''");
        shellCommands.push(`mkdir -p '${escapedDir}'`);
      }
    }

    // Symlink node_modules into workspace so specs can resolve dependencies.
    // Each run gets its own symlink — no shared /tmp/node_modules.
    const wsEscaped = ws.replace(/'/g, "'\\''");
    shellCommands.push(
      `[ -d "$PWD/node_modules" ] && [ ! -e '${wsEscaped}/node_modules' ] && ln -s "$PWD/node_modules" '${wsEscaped}/node_modules' || true`,
    );

    // Write main script file via base64 decode
    // Filename is pre-validated by SAFE_FILENAME_RE in executeInContainer.
    const scriptContent = Buffer.from(options.inlineScriptContent!).toString(
      'base64',
    );
    const scriptPath = `${ws}/${options.inlineScriptFileName}`;
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
        // Values prefixed with "base64:" are already base64-encoded (binary files
        // from S3 that must not be re-encoded through UTF-8).
        const encodedContent = content.startsWith('base64:')
          ? content.slice(7)
          : Buffer.from(content).toString('base64');
        const targetPath = path.posix.join(ws, filePath);
        const escapedTarget = targetPath.replace(/'/g, "'\\''");
        // Ensure parent directory exists for nested files
        const parentDir = path.posix.dirname(targetPath);
        if (parentDir && parentDir !== ws) {
          shellCommands.push(`mkdir -p '${parentDir.replace(/'/g, "'\\''")}'`);
        }
        shellCommands.push(
          `printf '%s' "${encodedContent}" | base64 -d > '${escapedTarget}'`,
        );
      }
    }

    // Build the execution command with proper quoting.
    // Replace both the bare filename and /tmp/<filename> references with the
    // workspace-scoped path so callers that pass /tmp/ paths still work.
    const adjustedCommand = command.map((arg) => {
      if (arg === options.inlineScriptFileName) return scriptPath;
      if (!options._workspace) return arg;
      // Rewrite /tmp/ prefixed paths to the per-run workspace
      if (arg.startsWith('/tmp/')) {
        return `${ws}/${arg.slice(5)}`;
      }
      if (arg === '/tmp/' || arg === '/tmp') {
        return `${ws}/`;
      }
      // Rewrite embedded /tmp/ paths in key=value style args (e.g. json=/tmp/k6-output/metrics.json)
      const eqIdx = arg.indexOf('=/tmp/');
      if (eqIdx !== -1) {
        return `${arg.slice(0, eqIdx + 1)}${ws}/${arg.slice(eqIdx + 6)}`;
      }
      return arg;
    });
    const quotedCommand = adjustedCommand
      .map((arg) => this.escapeShellArg(arg))
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

    if (!Number.isFinite(limits.memoryLimitMb)) {
      errors.push('memoryLimitMb must be a finite number');
    }
    if (!Number.isFinite(limits.cpuLimit)) {
      errors.push('cpuLimit must be a finite number');
    }
    if (!Number.isFinite(limits.timeoutMs)) {
      errors.push('timeoutMs must be a finite number');
    }

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
