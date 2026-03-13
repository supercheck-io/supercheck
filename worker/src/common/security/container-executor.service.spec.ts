// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('fs/promises');

// Mock child_process
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import {
  ContainerExecutorService,
  ContainerExecutionOptions,
} from './container-executor.service';
import { CancellationService } from '../services/cancellation.service';

// ── Test helpers ─────────────────────────────────────────────────────────────

const defaultOptions: ContainerExecutionOptions = {
  inlineScriptContent: 'console.log("hello")',
  inlineScriptFileName: 'test.spec.ts',
  timeoutMs: 30000,
  memoryLimitMb: 512,
  cpuLimit: 0.5,
};

/**
 * Creates a mock child process (EventEmitter with stdout/stderr streams + kill).
 */
function createMockChildProcess(exitCode = 0, stdout = '', stderr = '') {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
    killed: boolean;
    kill: jest.Mock;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 12345;
  proc.killed = false;
  proc.kill = jest.fn(() => {
    proc.killed = true;
    process.nextTick(() => proc.emit('close', 137));
  });

  // Emit stdout/stderr data and close in the next microtask
  process.nextTick(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    process.nextTick(() => proc.emit('close', exitCode));
  });

  return proc;
}

/**
 * Creates a mock child process that never closes (for timeout/cancel tests).
 */
function createHangingProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
    killed: boolean;
    kill: jest.Mock;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 12345;
  proc.killed = false;
  proc.kill = jest.fn(() => {
    proc.killed = true;
    process.nextTick(() => proc.emit('close', 137));
  });
  return proc;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('ContainerExecutorService', () => {
  let service: ContainerExecutorService;
  let mockCancellationService: { isCancelled: jest.Mock; clearCancellationSignal: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockCancellationService = {
      isCancelled: jest.fn().mockResolvedValue(false),
      clearCancellationSignal: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerExecutorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              const config: Record<string, string> = {
                WORKER_IMAGE: 'ghcr.io/supercheck-io/worker:test',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: CancellationService,
          useValue: mockCancellationService,
        },
      ],
    }).compile();

    service = module.get<ContainerExecutorService>(ContainerExecutorService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  // ── Input validation ───────────────────────────────────────────────────

  describe('input validation', () => {
    it('should reject non-null scriptPath (legacy mode)', async () => {
      const result = await service.executeInContainer(
        '/some/path.ts',
        ['npx', 'playwright', 'test'],
        defaultOptions,
      );

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Legacy execution mode not supported');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should reject missing inlineScriptContent', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        inlineScriptFileName: 'test.ts',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing inline script content');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should reject missing inlineScriptFileName', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        inlineScriptContent: 'console.log("hi")',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing script filename');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should reject extractFromContainer without extractToHost', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        extractFromContainer: '/tmp/report',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid extraction configuration');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should reject filenames with shell metacharacters', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        inlineScriptFileName: 'test.ts; curl evil.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid characters');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should reject filenames with path traversal', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        inlineScriptFileName: '../../etc/cron.d/evil',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid characters');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should reject additionalFiles with absolute paths', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        additionalFiles: { '/etc/passwd': 'malicious' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid characters');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should reject additionalFiles with path traversal', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        additionalFiles: { '../../../etc/cron.d/evil': 'malicious' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid characters');
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  // ── Resource limit validation ──────────────────────────────────────────

  describe('resource limits', () => {
    it('should reject memory below 128MB', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        memoryLimitMb: 32,
      });
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('memoryLimitMb');
      expect(result.stderr).toContain('below minimum');
    });

    it('should reject memory above 8192MB', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        memoryLimitMb: 16384,
      });
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('memoryLimitMb');
      expect(result.stderr).toContain('exceeds maximum');
    });

    it('should reject CPU below 0.1', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        cpuLimit: 0.01,
      });
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('cpuLimit');
      expect(result.stderr).toContain('below minimum');
    });

    it('should reject CPU above 4', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        cpuLimit: 8,
      });
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('cpuLimit');
      expect(result.stderr).toContain('exceeds maximum');
    });

    it('should reject timeout below 5 seconds', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        timeoutMs: 1000,
      });
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('timeoutMs');
      expect(result.stderr).toContain('below minimum');
    });

    it('should reject timeout above 1 hour', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        timeoutMs: 2 * 60 * 60 * 1000,
      });
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('timeoutMs');
      expect(result.stderr).toContain('exceeds maximum');
    });
  });

  // ── Successful execution ───────────────────────────────────────────────

  describe('successful execution', () => {
    it('should execute via child process and return success', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(0, 'test output', ''));

      const result = await service.executeInContainer(
        null,
        ['npx', 'playwright', 'test'],
        defaultOptions,
      );

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('test output');
      expect(result.timedOut).toBe(false);
      expect(result.duration).toBeGreaterThanOrEqual(0);

      // Should spawn /bin/sh with the shell script
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockSpawn).toHaveBeenCalledWith(
        '/bin/sh',
        ['-c', expect.any(String)],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    });

    it('should return failure for non-zero exit code', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(1, '', 'test failed'));

      const result = await service.executeInContainer(null, ['node'], defaultOptions);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('test failed');
    });

    it('should capture stdout and stderr separately', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(0, 'output', 'warnings'));

      const result = await service.executeInContainer(null, ['node'], defaultOptions);

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('output');
      expect(result.stderr).toBe('warnings');
    });

    it('should call onStdoutChunk callback', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(0, 'streamed output', ''));
      const onStdoutChunk = jest.fn();

      await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        onStdoutChunk,
      });

      expect(onStdoutChunk).toHaveBeenCalledWith('streamed output');
    });

    it('should call onStderrChunk callback', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(0, '', 'warnings'));
      const onStderrChunk = jest.fn();

      await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        onStderrChunk,
      });

      expect(onStderrChunk).toHaveBeenCalledWith('warnings');
    });

    it('should filter invalid env var names', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(0));

      await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        env: {
          VALID_VAR: 'v1',
          '123bad': 'v2',
          'has space': 'v3',
          _OK: 'v4',
        },
      });

      const spawnEnv = mockSpawn.mock.calls[0][2].env;
      expect(spawnEnv.VALID_VAR).toBe('v1');
      expect(spawnEnv._OK).toBe('v4');
      expect(spawnEnv['123bad']).toBeUndefined();
      expect(spawnEnv['has space']).toBeUndefined();
    });

    it('should not leak process.env secrets to child process', async () => {
      // Set secrets in process.env for this test
      process.env.DATABASE_URL = 'postgres://secret';
      process.env.S3_SECRET_KEY = 'supersecret';
      process.env.REDIS_URL = 'redis://secret';

      mockSpawn.mockReturnValue(createMockChildProcess(0));

      await service.executeInContainer(null, ['node'], defaultOptions);

      const spawnEnv = mockSpawn.mock.calls[0][2].env;
      expect(spawnEnv.DATABASE_URL).toBeUndefined();
      expect(spawnEnv.S3_SECRET_KEY).toBeUndefined();
      expect(spawnEnv.REDIS_URL).toBeUndefined();

      // But PATH should be inherited
      if (process.env.PATH) {
        expect(spawnEnv.PATH).toBe(process.env.PATH);
      }

      // Clean up
      delete process.env.DATABASE_URL;
      delete process.env.S3_SECRET_KEY;
      delete process.env.REDIS_URL;
    });
  });

  // ── Shell script building ──────────────────────────────────────────────

  describe('shell script building', () => {
    it('should base64-encode inline script content', () => {
      const script = service.buildShellScript(
        {
          inlineScriptContent: 'console.log("hello world")',
          inlineScriptFileName: 'test.ts',
        },
        ['node', 'test.ts'],
      );

      const expectedB64 = Buffer.from('console.log("hello world")').toString('base64');
      expect(script).toContain(expectedB64);
      expect(script).toContain('/tmp/test.ts');
      expect(script).toContain('node /tmp/test.ts');
    });

    it('should create ensureDirectories', () => {
      const script = service.buildShellScript(
        {
          inlineScriptContent: 'test',
          inlineScriptFileName: 'test.ts',
          ensureDirectories: ['/tmp/reports', '/tmp/output'],
        },
        ['node'],
      );

      expect(script).toContain("mkdir -p '/tmp/reports'");
      expect(script).toContain("mkdir -p '/tmp/output'");
    });

    it('should symlink node_modules', () => {
      const script = service.buildShellScript(
        {
          inlineScriptContent: 'test',
          inlineScriptFileName: 'test.ts',
        },
        ['node'],
      );

      expect(script).toContain('ln -s "$PWD/node_modules" /tmp/node_modules');
    });

    it('should write additional files via base64', () => {
      const script = service.buildShellScript(
        {
          inlineScriptContent: 'test',
          inlineScriptFileName: 'test.ts',
          additionalFiles: { 'config.json': '{"key": "value"}' },
        },
        ['node'],
      );

      const expectedB64 = Buffer.from('{"key": "value"}').toString('base64');
      expect(script).toContain(expectedB64);
      expect(script).toContain('/tmp/config.json');
    });
  });

  // ── Timeout handling ───────────────────────────────────────────────────

  describe('timeout handling', () => {
    it('should kill process group on timeout', async () => {
      const proc = createHangingProcess();
      mockSpawn.mockReturnValue(proc);

      // Mock process.kill to handle negative PID (process group kill)
      const originalProcessKill = process.kill;
      const processKillSpy = jest.fn((_pid: number, _signal?: string) => {
        // Simulate successful group kill — trigger the close event
        proc.killed = true;
        process.nextTick(() => proc.emit('close', 137));
        return true;
      });
      process.kill = processKillSpy as unknown as typeof process.kill;

      try {
        const resultPromise = service.executeInContainer(null, ['node'], {
          ...defaultOptions,
          timeoutMs: 5000,
        });

        const result = await resultPromise;

        expect(result.timedOut).toBe(true);
        expect(result.exitCode).toBe(137);
        // Should kill the process group (negative PID) not just the shell
        expect(processKillSpy).toHaveBeenCalledWith(-proc.pid, 'SIGTERM');
      } finally {
        process.kill = originalProcessKill;
      }
    }, 10000);

    it('should spawn with detached: true for process group control', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(0));

      await service.executeInContainer(null, ['node'], defaultOptions);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const spawnOptions = mockSpawn.mock.calls[0][2];
      expect(spawnOptions.detached).toBe(true);
    });
  });

  // ── Cancellation ───────────────────────────────────────────────────────

  describe('cancellation', () => {
    it('should kill process group when cancellation is detected', async () => {
      const proc = createHangingProcess();
      mockSpawn.mockReturnValue(proc);

      // Mock process.kill to handle negative PID (process group kill)
      const originalProcessKill = process.kill;
      const processKillSpy = jest.fn((_pid: number, _signal?: string) => {
        proc.killed = true;
        process.nextTick(() => proc.emit('close', 137));
        return true;
      });
      process.kill = processKillSpy as unknown as typeof process.kill;

      try {
        // After first check, return cancelled
        mockCancellationService.isCancelled
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true);

        const resultPromise = service.executeInContainer(null, ['node'], {
          ...defaultOptions,
          runId: 'run-cancel-123',
        });

        const result = await resultPromise;

        expect(result.exitCode).toBe(137);
        // Should kill the process group (negative PID)
        expect(processKillSpy).toHaveBeenCalledWith(-proc.pid, 'SIGTERM');
        expect(mockCancellationService.clearCancellationSignal).toHaveBeenCalledWith(
          'run-cancel-123',
        );
      } finally {
        process.kill = originalProcessKill;
      }
    }, 10000);
  });

  // ── Error handling ─────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should handle spawn error gracefully', async () => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        pid: number;
        killed: boolean;
        kill: jest.Mock;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.pid = 12345;
      proc.killed = false;
      proc.kill = jest.fn();
      mockSpawn.mockReturnValue(proc);

      // Emit error in next tick
      process.nextTick(() => {
        proc.emit('error', new Error('spawn ENOENT'));
      });

      const result = await service.executeInContainer(null, ['node'], defaultOptions);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('spawn ENOENT');
    });
  });

  // ── Artifact extraction ──────────────────────────────────────────────

  describe('artifact extraction', () => {
    it('should extract artifacts even when command fails', async () => {
      // Playwright exit 1 still produces reports, traces, screenshots
      mockSpawn.mockReturnValue(createMockChildProcess(1, '', 'test failed'));
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.cp as jest.Mock).mockResolvedValue(undefined);

      const result = await service.executeInContainer(null, ['npx', 'playwright', 'test'], {
        ...defaultOptions,
        extractFromContainer: '/tmp/reports',
        extractToHost: '/host/reports',
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      // Artifacts should still be copied despite failure
      expect(fs.cp).toHaveBeenCalledWith('/tmp/reports', '/host/reports', { recursive: true });
    });

    it('should extract artifacts on success', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(0, 'output', ''));
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.cp as jest.Mock).mockResolvedValue(undefined);

      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        extractFromContainer: '/tmp/reports',
        extractToHost: '/host/reports',
      });

      expect(result.success).toBe(true);
      expect(fs.cp).toHaveBeenCalledWith('/tmp/reports', '/host/reports', { recursive: true });
    });

    it('should skip extraction when source does not exist', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(1, '', 'test failed'));
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        extractFromContainer: '/tmp/reports',
        extractToHost: '/host/reports',
      });

      expect(result.success).toBe(false);
      // Should not try to copy if source doesn't exist
      expect(fs.cp).not.toHaveBeenCalled();
    });

    it('should not extract when extractFromContainer is not set', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(1, '', 'test failed'));

      await service.executeInContainer(null, ['node'], defaultOptions);

      expect(fs.cp).not.toHaveBeenCalled();
    });
  });

  // ── Path resolution ───────────────────────────────────────────────────

  describe('path resolution', () => {
    it('resolveWorkerDir should return a valid directory', async () => {
      const result = await service.resolveWorkerDir();
      // In Docker: /worker, locally: process.cwd()
      expect(['/worker', process.cwd()]).toContain(result);
    });

    it('resolveBrowsersPath should return /ms-playwright or undefined', async () => {
      const result = await service.resolveBrowsersPath();
      // In Docker or if /ms-playwright exists locally: '/ms-playwright'
      // Otherwise: undefined (Playwright uses system default)
      expect(['/ms-playwright', undefined]).toContain(result);
    });
  });

  // ── Module lifecycle ───────────────────────────────────────────────────

  describe('module lifecycle', () => {
    it('should initialize without error', async () => {
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('should destroy without error when no processes running', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
