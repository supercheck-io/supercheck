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
  // Hardcoded Playwright Docker image for security and consistency
  private readonly defaultImage = 'mcr.microsoft.com/playwright:v1.56.1-noble';

  constructor(private configService: ConfigService) {
    this.logger.log(
      `Container executor initialized with default image: ${this.defaultImage}`,
    );
  }

  /**
   * Executes a script in a secure Docker container
   */
  async executeInContainer(
    scriptPath: string,
    command: string[],
    options: ContainerExecutionOptions = {},
  ): Promise<ContainerExecutionResult> {
    const startTime = Date.now();

    // Validate script path
    const pathValidation = validatePath(scriptPath, {
      allowAbsolute: true,
      allowRelative: false,
      maxLength: 4096,
    });

    if (!pathValidation.valid) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: `Invalid script path: ${pathValidation.error}`,
        duration: Date.now() - startTime,
        timedOut: false,
        error: pathValidation.error,
      };
    }

    // Validate command arguments
    for (const arg of command) {
      const argValidation = validateCommandArgument(arg);
      if (!argValidation.valid) {
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: `Invalid command argument: ${argValidation.error}`,
          duration: Date.now() - startTime,
          timedOut: false,
          error: argValidation.error,
        };
      }
    }

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
      workingDir = '/workspace',
      image = this.defaultImage,
      networkMode = 'none',
      autoRemove = true,
    } = options;

    const containerName = `supercheck-exec-${randomUUID()}`;

    try {
      // Build Docker command with security constraints
      const dockerArgs = [
        'run',
        '--name',
        containerName,
        // Security options
        '--read-only', // Read-only root filesystem
        '--security-opt=no-new-privileges', // Prevent privilege escalation
        '--cap-drop=ALL', // Drop all Linux capabilities
        // Note: Not forcing --user because Playwright image has its own non-root user (pwuser)
        // Forcing a different UID causes permission issues with npm/npx
        // Resource limits
        `--memory=${memoryLimitMb}m`,
        `--cpus=${cpuLimit}`,
        '--pids-limit=100', // Limit number of processes
        // Network
        `--network=${networkMode}`,
        // Cleanup
        autoRemove ? '--rm' : '',
        // Working directory
        '-w',
        workingDir,
        // Mount script directory as read-write (containers need to write output files)
        // Handle both file and directory scriptPaths:
        // - If scriptPath is a file, mount its parent directory
        // - If scriptPath is a directory, mount it directly
        '-v',
        `${this.getMountPath(scriptPath)}:${workingDir}`,
        // Mount /tmp as tmpfs for writable temp files (needed for npm cache and npx binaries)
        // Note: Removed noexec to allow npx to install and execute playwright from /tmp
        '--tmpfs',
        '/tmp:rw,nosuid,size=512m',
        // Allocate larger shared memory for Playwright/Chromium browsers
        // Default 64MB is insufficient and causes crashes with multiple tabs/video recording
        '--shm-size=512m',
      ];

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

      // Add image
      dockerArgs.push(image);

      // Add command
      dockerArgs.push(...command);

      // Ensure timeout is a number (handle string values from config)
      const timeout = typeof timeoutMs === 'string' ? parseInt(timeoutMs, 10) : timeoutMs;
      const validTimeout = typeof timeout === 'number' && !isNaN(timeout) && timeout > 0 ? timeout : undefined;

      this.logger.log(
        `Executing in container: ${containerName} with timeout ${validTimeout || 'none'}ms`,
      );

      // Execute with timeout
      const result = await execa('docker', dockerArgs, {
        timeout: validTimeout,
        reject: false, // Don't throw on non-zero exit
        all: true, // Combine stdout and stderr
      });

      const duration = Date.now() - startTime;

      // Check if timed out
      const timedOut = result.timedOut || false;

      if (timedOut) {
        this.logger.warn(`Container execution timed out: ${containerName}`);
        // Force remove the container
        await this.forceRemoveContainer(containerName);
      }

      // Log detailed error information for debugging
      if (result.exitCode !== 0 && !timedOut) {
        this.logger.error(`Container ${containerName} exited with code ${result.exitCode}`);
        if (result.stdout) {
          this.logger.error(`Container stdout: ${result.stdout.substring(0, 500)}`);
        }
        if (result.stderr) {
          this.logger.error(`Container stderr: ${result.stderr.substring(0, 500)}`);
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
   * Determines the correct host path to mount in the container
   * - If scriptPath is a directory, mounts it directly
   * - If scriptPath is a file, mounts its parent directory
   */
  private getMountPath(scriptPath: string): string {
    try {
      const stats = fsSync.statSync(scriptPath);
      if (stats.isDirectory()) {
        return scriptPath;
      } else {
        return path.dirname(scriptPath);
      }
    } catch (error) {
      // If path doesn't exist or can't be stat'd, assume it's a file and use dirname
      this.logger.warn(
        `Could not stat scriptPath ${scriptPath}, assuming file: ${error}`,
      );
      return path.dirname(scriptPath);
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
