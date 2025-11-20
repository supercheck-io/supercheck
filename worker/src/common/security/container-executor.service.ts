/**
 * Container-Based Secure Script Execution Service
 *
 * Implements sandboxed execution of user-supplied scripts using Docker containers
 * with strict resource limits and security boundaries.
 *
 * Security Features:
 * - Isolated execution environment
 * - Resource limits (CPU, memory, disk, network)
 * - Read-only root filesystem
 * - No privilege escalation
 * - Timeout enforcement
 * - Clean-up of containers
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execa } from 'execa';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { randomUUID } from 'crypto';
import {
  validatePath,
  validateCommandArgument,
  createSafeTempPath,
} from './path-validator';

export interface ContainerExecutionOptions {
  /**
   * Timeout in milliseconds
   */
  timeoutMs?: number;

  /**
   * Memory limit in megabytes
   */
  memoryLimitMb?: number;

  /**
   * CPU limit (fraction of CPU, e.g., 0.5 for 50%)
   */
  cpuLimit?: number;

  /**
   * Environment variables to pass to the container
   */
  env?: Record<string, string>;

  /**
   * Working directory inside the container
   */
  workingDir?: string;

  /**
   * Docker image to use
   */
  image?: string;

  /**
   * Network mode (none, bridge, host)
   */
  networkMode?: 'none' | 'bridge' | 'host';

  /**
   * Whether to remove container after execution
   */
  autoRemove?: boolean;

  /**
   * Path inside container to extract before destroying container
   * If specified, files will be copied to extractToHost path
   */
  extractFromContainer?: string;

  /**
   * Host path where extracted files should be placed
   * Required if extractFromContainer is specified
   */
  extractToHost?: string;

  /**
   * Inline script content to write inside container
   * If provided, script will be written to workingDir/scriptFileName inside container
   * This enables true container isolation without host filesystem dependencies
   */
  inlineScriptContent?: string;

  /**
   * Filename for inline script (required if inlineScriptContent is provided)
   * Example: 'test.spec.mjs'
   */
  inlineScriptFileName?: string;

  /**
   * Additional files to write inside container before execution
   * Key: relative path inside container, Value: file content
   */
  additionalFiles?: Record<string, string>;

  /**
   * Absolute directories that should be created inside the container prior to execution
   * Useful for ensuring report/output paths exist
   */
  ensureDirectories?: string[];

  /**
   * Streaming hooks for stdout/stderr chunks (used for live log streaming)
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

@Injectable()
export class ContainerExecutorService {
  private readonly logger = new Logger(ContainerExecutorService.name);
  // Use custom worker image with Playwright browsers and k6 pre-installed
  private readonly defaultImage = 'ghcr.io/supercheck-io/supercheck/worker:latest';

  constructor(private configService: ConfigService) {
    this.logger.log(
      `Container executor initialized with default image: ${this.defaultImage}`,
    );
  }

  /**
   * Executes a script in a secure Docker container using inline script content
   * IMPORTANT: All execution must use inline scripts - no host filesystem dependencies
   */
  async executeInContainer(
    scriptPath: string | null, // DEPRECATED: Only kept for signature compatibility, must be null
    command: string[],
    options: ContainerExecutionOptions = {},
  ): Promise<ContainerExecutionResult> {
    const startTime = Date.now();

    // Validate that scriptPath is null (legacy mode is not supported)
    if (scriptPath !== null) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'Legacy mode with scriptPath is no longer supported. Use inlineScriptContent instead.',
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
        stderr: 'inlineScriptFileName is required when using inlineScriptContent',
        duration: 0,
        timedOut: false,
        error: 'Missing script filename',
      };
    }

    // Note: We skip command argument validation for inline script mode because:
    // 1. The command will be wrapped in a controlled shell script we generate
    // 2. All paths and content are sanitized separately (script content is base64-encoded)
    // 3. The actual execution happens via 'sh -c <our_script>', not the raw command
    // 4. Validating would reject valid commands like 'k6 run --out json=/tmp/file.json'
    //
    // For non-inline mode (if we ever add it back), validation would be needed.

    // Check if Docker is available
    const dockerAvailable = await this.checkDockerAvailable();
    if (!dockerAvailable) {
      this.logger.error(
        'Docker is not available. Please ensure Docker is installed, running, and the required image is available.',
      );
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'Docker is not available or the required image could not be pulled. Please ensure Docker is installed and running, and you have access to pull the required image.',
        duration: Date.now() - startTime,
        timedOut: false,
        error: 'Docker is not available or image pull failed',
      };
    }

    // Default options
    const {
      timeoutMs = 300000, // 5 minutes
      memoryLimitMb = 512,
      cpuLimit = 0.5,
      env = {},
      workingDir = '/worker',
      image = this.defaultImage,
      networkMode = 'none',
      autoRemove = true,
      extractFromContainer,
      extractToHost,
    } = options;

    // If extraction is requested, disable auto-remove so we can copy files first
    const shouldAutoRemove = autoRemove && !extractFromContainer;

    // Validate extraction options
    if (extractFromContainer && !extractToHost) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'extractToHost is required when extractFromContainer is specified',
        duration: 0,
        timedOut: false,
        error: 'Invalid extraction configuration',
      };
    }

    const containerName = `supercheck-exec-${randomUUID()}`;

    try {
      // Build Docker command with security constraints
      const dockerArgs = [
        'run',
        '--name',
        containerName,
        // Security options
        // NOTE: --read-only flag removed because container needs to write:
        // 1. Test scripts to /tmp/ (inline script injection)
        // 2. Test reports to /tmp/playwright-reports/ or /tmp/ (for docker cp extraction)
        // Container is still secure via: --security-opt=no-new-privileges, --cap-drop=ALL,
        // resource limits, and automatic removal after execution.
        '--security-opt=no-new-privileges', // Prevent privilege escalation
        '--cap-drop=ALL', // Drop all Linux capabilities
        // Resource limits
        `--memory=${memoryLimitMb}m`,
        `--cpus=${cpuLimit}`,
        '--pids-limit=256', // Increased for parallel browser instances
        // Network
        `--network=${networkMode}`,
      ];

      // Cleanup (disabled if we need to extract files)
      if (shouldAutoRemove) {
        dockerArgs.push('--rm');
      }

      // Working directory
      dockerArgs.push('-w', workingDir);

      // Container-only execution: Only mount node_modules (read-only)
      // Test scripts will be created inside container via shell commands
      // NOTE: Do NOT bind-mount /worker/node_modules or config files here.
      // In containerized deployments (Dokploy/Kubernetes/Docker Compose) the worker
      // runs inside a container and the Docker daemon on the host cannot access the
      // worker's filesystem paths. Binding a non-existent host path would mask the
      // baked-in node_modules inside the execution image, forcing npm to try fetching
      // Playwright at runtime and fail with EACCES. We rely on the dependencies
      // already baked into the worker image instead.

      // NOTE: Do NOT use --tmpfs for /tmp because tmpfs is destroyed when container exits,
      // preventing docker cp extraction. Use regular container filesystem instead - it's
      // still isolated and cleaned up when container is removed.

      // Allocate shared memory for Playwright/Chromium browsers (2GB for multiple instances)
      dockerArgs.push('--shm-size=2048m');

      // Add environment variables
      for (const [key, value] of Object.entries(env)) {
        // Validate env var names (allow alphanumeric and underscore, must start with letter or underscore)
        // This allows npm_* and other common environment variables
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
          this.logger.warn(`Invalid environment variable name: ${key}`);
          continue;
        }
        dockerArgs.push('-e', `${key}=${value}`);
      }

      // Ensure we have a POSIX shell entrypoint so shell script execution is consistent across images (e.g., grafana/k6)
      dockerArgs.push('--entrypoint', '/bin/sh');

      // Add image
      dockerArgs.push(image);

      // Container-only execution: Wrap command in shell script that:
      // 1. Creates test file(s) from inline content
      // 2. Executes the original command
      // Using base64 encoding to safely pass script content

      const scriptContent = Buffer.from(options.inlineScriptContent!).toString(
        'base64',
      );
      const scriptPath = `/tmp/${options.inlineScriptFileName!}`;

      // Build shell wrapper commands as an array, then join
      const shellCommands: string[] = [];

      // Ensure required directories exist before writing files or executing commands
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

      // Ensure specs can resolve dependencies by linking /tmp/node_modules -> /worker/node_modules
      shellCommands.push(
        '[ -d /worker/node_modules ] && [ ! -e /tmp/node_modules ] && ln -s /worker/node_modules /tmp/node_modules || true',
      );

      // Write main script file (using printf for better compatibility)
      shellCommands.push(
        `printf '%s' "${scriptContent}" | base64 -d > ${scriptPath}`,
      );
      shellCommands.push(`chmod +x ${scriptPath}`);

      // Write additional files if provided
      if (options.additionalFiles) {
        for (const [filePath, content] of Object.entries(
          options.additionalFiles,
        )) {
          const encodedContent = Buffer.from(content).toString('base64');
          const targetPath = filePath.startsWith('/')
            ? filePath
            : `/tmp/${filePath}`;
          shellCommands.push(`printf '%s' "${encodedContent}" | base64 -d > ${targetPath}`);
        }
      }

      // Execute the original command
      // Replace any reference to the script path with the container path
      const adjustedCommand = command.map((arg) =>
        arg === options.inlineScriptFileName ? scriptPath : arg,
      );

      // Build the exec command with proper quoting for args that might have special chars
      const quotedCommand = adjustedCommand.map((arg) => {
        // If arg contains spaces or special characters, quote it
        if (/[\s|&;<>()$`"'\\]/.test(arg)) {
          // Escape single quotes in the arg, then wrap in single quotes
          return `'${arg.replace(/'/g, "'\\''")}'`;
        }
        return arg;
      }).join(' ');

      shellCommands.push(quotedCommand);

      // Join main commands with && (each must succeed)
      const mainScript = shellCommands.join(' && ');

      // Use main script directly
      const shellScript = mainScript;

      this.logger.debug(
        `[Container-Only] Generated shell wrapper for inline script execution`,
      );
      this.logger.debug(`[Container-Only] Shell script: ${shellScript.substring(0, 1000)}`);

      // Execute via shell
      dockerArgs.push('-c', shellScript);

      // Ensure timeout is a number (handle string values from config)
      const timeout = typeof timeoutMs === 'string' ? parseInt(timeoutMs, 10) : timeoutMs;
      const validTimeout = typeof timeout === 'number' && !isNaN(timeout) && timeout > 0 ? timeout : undefined;

      this.logger.log(
        `Executing in container: ${containerName} with timeout ${validTimeout || 'none'}ms`,
      );

      // Execute with timeout
      const child = execa('docker', dockerArgs, {
        timeout: validTimeout,
        reject: false, // Don't throw on non-zero exit
        all: true, // Combine stdout and stderr
      });

      // Stream chunks if requested
      if (options.onStdoutChunk && child.stdout) {
        child.stdout.on('data', (chunk: Buffer) => {
          try {
            void options.onStdoutChunk?.(chunk.toString());
          } catch {
            /* ignore streaming errors */
          }
        });
      }

      if (options.onStderrChunk && child.stderr) {
        child.stderr.on('data', (chunk: Buffer) => {
          try {
            void options.onStderrChunk?.(chunk.toString());
          } catch {
            /* ignore streaming errors */
          }
        });
      }

      const result = await child;

      const duration = Date.now() - startTime;

      // Check if timed out
      const timedOut = result.timedOut || false;

      if (timedOut) {
        this.logger.warn(`Container execution timed out: ${containerName}`);
        // Don't remove container yet if extraction is requested
        // Extraction logic will handle cleanup in finally block
        if (!extractFromContainer && !extractToHost) {
          // No extraction needed, safe to remove immediately
          await this.forceRemoveContainer(containerName);
        }
      }

      // Log detailed execution information for debugging
      this.logger.debug(`Container ${containerName} exited with code ${result.exitCode}`);
      if (result.stdout && result.stdout.trim().length > 0) {
        // Log more stdout to see full Playwright output including report generation
        this.logger.debug(`Container stdout (first 3000 chars): ${result.stdout.substring(0, 3000)}`);
        if (result.stdout.length > 3000) {
          this.logger.debug(`Container stdout (last 2000 chars): ${result.stdout.substring(result.stdout.length - 2000)}`);
        }
      }
      if (result.stderr && result.stderr.trim().length > 0) {
        this.logger.debug(`Container stderr (first 2000 chars): ${result.stderr.substring(0, 2000)}`);
      }

      // Log errors for non-zero exits
      if (result.exitCode !== 0 && !timedOut) {
        this.logger.error(`Container ${containerName} failed with exit code ${result.exitCode}`);
      }

      // Extract files from container if requested (before container is destroyed)
      if (extractFromContainer && extractToHost) {
        try {
          this.logger.log(
            `Extracting ${extractFromContainer} from container ${containerName} to ${extractToHost}`,
          );

          // Ensure the host directory exists
          await fs.mkdir(extractToHost, { recursive: true });

          // Use docker cp to extract files from container
          // Format: docker cp <container>:<src_path>/. <dest_path>
          // The trailing /. extracts the CONTENTS of the directory, not the directory itself
          await execa('docker', [
            'cp',
            `${containerName}:${extractFromContainer}/.`,
            extractToHost,
          ]);

          this.logger.log(`Successfully extracted files to ${extractToHost}`);
        } catch (extractError) {
          this.logger.error(
            `Failed to extract files from container: ${extractError instanceof Error ? extractError.message : String(extractError)}`,
          );
          // Continue execution - don't fail the whole operation if extraction fails
        } finally {
          // Clean up the container after extraction (or if extraction failed)
          await this.forceRemoveContainer(containerName);
        }
      }

      return {
        success: result.exitCode === 0 && !timedOut,
        exitCode: result.exitCode || (timedOut ? 124 : 1),
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        duration,
        timedOut,
        error: timedOut
          ? `Execution timed out after ${timeoutMs}ms`
          : result.exitCode !== 0
            ? `Container exited with code ${result.exitCode}`
            : undefined,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Container execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Try to clean up the container
      await this.forceRemoveContainer(containerName);

      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        duration,
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Checks if Docker is available and the required image exists
   */
  private async checkDockerAvailable(): Promise<boolean> {
    try {
      // Check if Docker daemon is running
      const result = await execa('docker', ['--version'], {
        timeout: 5000,
        reject: false,
      });

      if (result.exitCode !== 0) {
        return false;
      }

      // Check if required image exists locally
      const imageCheck = await execa('docker', ['images', '-q', this.defaultImage], {
        timeout: 5000,
        reject: false,
      });

      // If image doesn't exist, try to pull it automatically
      if (!imageCheck.stdout || imageCheck.stdout.trim() === '') {
        this.logger.warn(
          `Docker image ${this.defaultImage} not found locally. Attempting to pull...`,
        );

        try {
          const pullResult = await execa('docker', ['pull', this.defaultImage], {
            timeout: 120000, // 2 minutes for pull
            reject: false,
          });

          if (pullResult.exitCode === 0) {
            this.logger.log(`Successfully pulled Docker image: ${this.defaultImage}`);
            return true;
          } else {
            this.logger.warn(
              `Failed to pull Docker image: ${pullResult.stderr}`,
            );
            return false;
          }
        } catch (pullError) {
          this.logger.warn(
            `Could not pull Docker image: ${pullError instanceof Error ? pullError.message : String(pullError)}`,
          );
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Force removes a Docker container
   */
  private async forceRemoveContainer(containerName: string): Promise<void> {
    try {
      this.logger.log(`Force removing container: ${containerName}`);
      await execa('docker', ['rm', '-f', containerName], {
        timeout: 10000,
        reject: false,
      });
    } catch (error) {
      this.logger.error(
        `Failed to remove container ${containerName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Lists running containers created by this service
   */
  async listActiveContainers(): Promise<string[]> {
    try {
      const result = await execa(
        'docker',
        ['ps', '--filter', 'name=supercheck-exec-*', '--format', '{{.Names}}'],
        {
          timeout: 5000,
          reject: false,
        },
      );

      if (result.exitCode === 0 && result.stdout) {
        return result.stdout.split('\n').filter((name) => name.length > 0);
      }
    } catch (error) {
      this.logger.error(
        `Failed to list containers: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return [];
  }

  /**
   * Cleans up all orphaned containers
   */
  async cleanupOrphanedContainers(): Promise<number> {
    const containers = await this.listActiveContainers();
    let cleaned = 0;

    for (const container of containers) {
      await this.forceRemoveContainer(container);
      cleaned++;
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} orphaned containers`);
    }

    return cleaned;
  }
}
