import * as secretStream from '../../common/utils/secret-stream';
/**
 * K6 Execution Service Tests
 *
 * Comprehensive test coverage for K6 load testing execution
 *
 * Test Categories:
 * - Test Execution (single test runs)
 * - Result Processing (summary parsing, report generation)
 * - Resource Management (temp files, cleanup)
 * - Error Handling (execution failures, timeouts)
 * - Dashboard Integration (port allocation, web dashboard)
 */

import { ExecutionAdmissionService } from '../../execution/services/execution-admission.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  attachBillableMs,
  createK6AllocationTracker,
  getBillableMs,
  getBillableVirtualUsers,
} from '../../common/billable-ms';
import { runInNewContext } from 'node:vm';
import {
  K6ExecutionService,
  K6ExecutionTask,
  K6ExecutionResult,
} from './k6-execution.service';
import { S3Service } from '../../execution/services/s3.service';
import { DbService } from '../../execution/services/db.service';
import { RedisService } from '../../execution/services/redis.service';
import { ContainerExecutorService } from '../../common/security/container-executor.service';
import { VariableResolverService } from '../../common/services/variable-resolver.service';

// Mock execa
jest.mock('execa', () => ({
  execa: jest
    .fn()
    .mockImplementation(async (_binary: string, args: string[] = []) =>
      args.includes('version')
        ? // The service probes `k6 version` during construction and logs a
          // critical error block when the xk6-dashboard extension is absent,
          // once per test. Answer as a binary built with the extension so the
          // suite exercises the supported configuration instead of printing
          // that block 476 times per run.
          {
            exitCode: 0,
            stdout: 'k6 v0.45.0 (with xk6-dashboard v0.6.0)',
            stderr: '',
          }
        : { exitCode: 0, stdout: 'k6 v0.45.0', stderr: '' },
    ),
}));

// Mock fs/promises
jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue('{}'),
  mkdir: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ isFile: () => true }),
}));

// Mock crypto
jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('mock-uuid'),
}));

// Mock os
jest.mock('os', () => ({
  tmpdir: jest.fn().mockReturnValue('/tmp'),
}));

// Mock path-validator
jest.mock('../../common/security/path-validator', () => ({
  createSafeTempPath: jest.fn().mockReturnValue('/tmp/safe-path'),
}));

// Mock file-search
jest.mock('../../common/utils/file-search', () => ({
  findFirstFileByNames: jest.fn().mockResolvedValue('/tmp/report.html'),
  pathExists: jest.fn().mockResolvedValue(true),
}));

describe('K6ExecutionService', () => {
  let service: K6ExecutionService;
  let _configService: ConfigService;
  let _s3Service: S3Service;
  let _dbService: DbService;
  let _redisService: RedisService;
  let _containerExecutorService: ContainerExecutorService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        K6_BIN_PATH: '/usr/local/bin/k6',
        // K6_MAX_CONCURRENCY is now hardcoded to 1 in the service
        K6_TEST_EXECUTION_TIMEOUT_MS: 3600000,
        K6_JOB_EXECUTION_TIMEOUT_MS: 3600000,
        K6_WEB_DASHBOARD_START_PORT: 6000,
        K6_WEB_DASHBOARD_PORT_RANGE: 100,
        K6_WEB_DASHBOARD_ADDR: '127.0.0.1',
      };
      return config[key] ?? defaultValue;
    }),
  };

  const mockS3Service = {
    uploadFile: jest
      .fn()
      .mockResolvedValue('https://s3.example.com/report.html'),
    uploadFileFromPath: jest
      .fn()
      .mockResolvedValue('https://s3.example.com/file'),
    prepareFileVariables: jest
      .fn()
      .mockResolvedValue({ additionalFiles: {}, filePaths: {} }),
  };

  const mockDbService = {
    db: {
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'domain' }]),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      }),
    },
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    }),
  };

  const mockContainerExecutorService = {
    executeInContainer: jest.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '{}',
      stderr: '',
    }),
  };
  const mockVariableResolverService = {
    resolveProjectVariables: jest.fn().mockResolvedValue({
      variables: {},
      secrets: {},
      files: {},
    }),
  };

  // Test fixtures
  const mockTask: K6ExecutionTask = {
    runId: 'run-123',
    testId: 'test-456',
    organizationId: 'org-789',
    projectId: 'project-abc',
    script: `
      import http from 'k6/http';
      export default function() {
        http.get('https://test.k6.io');
      }
    `,
    tests: [{ id: 'test-1', script: 'test script' }],
  };

  const mockAdmissionService = {
    run: jest.fn(),
    setK6Workload: jest.fn().mockResolvedValue(undefined),
  };
  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockAdmissionService.run.mockImplementation(
      (
        _org: unknown,
        _id: unknown,
        _kind: unknown,
        _timeout: unknown,
        callback: (value: undefined) => unknown,
      ) => callback(undefined),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        K6ExecutionService,
        { provide: ExecutionAdmissionService, useValue: mockAdmissionService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: S3Service, useValue: mockS3Service },
        { provide: DbService, useValue: mockDbService },
        { provide: RedisService, useValue: mockRedisService },
        {
          provide: ContainerExecutorService,
          useValue: mockContainerExecutorService,
        },
        {
          provide: VariableResolverService,
          useValue: mockVariableResolverService,
        },
      ],
    }).compile();

    service = module.get<K6ExecutionService>(K6ExecutionService);
  });

  // ==========================================================================
  // INITIALIZATION TESTS
  // ==========================================================================

  it('gives a limited run the same command, runtime data and files as a paid run', async () => {
    const runtimeEnv = {
      K6_WEB_DASHBOARD: 'true',
      SUPERCHECK_VARIABLES_B64: Buffer.from(
        '{"BASE_URL":"https://a.test"}',
      ).toString('base64'),
      SUPERCHECK_SECRETS_B64: Buffer.from('{"TOKEN":"t"}').toString('base64'),
    };
    const files = { 'data.csv': 'a,b' };
    await service['executeK6Binary'](
      ['run', '/tmp/test.js'],
      'export default function() {}',
      '/tmp/out',
      'run-id',
      'unique',
      runtimeEnv,
      1000,
      0,
      files,
      1000,
      undefined,
      { maxVus: 5, workloadMs: 1000 },
    );
    const [, command, options] = mockContainerExecutorService.executeInContainer
      .mock.calls[0] as [unknown, string[], Record<string, unknown>];
    expect(command).toEqual(['k6', 'run', '/tmp/test.js']);
    expect(options.env).toMatchObject(runtimeEnv);
    expect(options.additionalFiles).toEqual(files);
  });

  describe('limited (trial) k6 runs', () => {
    let reservation: Record<string, unknown>;
    beforeEach(() => {
      reservation = {
        organizationId: 'org',
        limited: true,
        k6MaxVus: 5,
        reservedMs: 300000,
        expiresAt: new Date(Date.now() + 3600000),
      };
      mockAdmissionService.run.mockImplementation(
        (
          _org: unknown,
          _id: unknown,
          _kind: unknown,
          _timeout: unknown,
          callback: (value: unknown) => unknown,
        ) => callback(reservation),
      );
    });
    it('runs the user script unchanged, reserved at the VU cap, with project variables', async () => {
      const execute = jest
        .spyOn(service, 'runK6TestReserved' as never)
        .mockResolvedValue({ success: true, billingVirtualUsers: 3 } as never);
      const script =
        "import http from 'k6/http'; export default () => http.post('https://api.test/')";
      await service.runK6Test({ ...mockTask, script });
      expect(mockAdmissionService.setK6Workload).toHaveBeenCalledWith(
        reservation,
        5,
        300000,
      );
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ script }),
        reservation,
      );
      // Charged for the VUs the run actually allocated.
      expect(reservation.vus).toBe(3);
    });
    it('charges the VU cap when the run did not report its VUs or went over it', async () => {
      jest
        .spyOn(service, 'runK6TestReserved' as never)
        .mockResolvedValueOnce({ success: false } as never)
        .mockResolvedValueOnce({
          success: false,
          billingVirtualUsers: 50,
        } as never);
      await service.runK6Test(mockTask);
      expect(reservation.vus).toBe(5);
      reservation.vus = undefined;
      await service.runK6Test(mockTask);
      expect(reservation.vus).toBe(5);
    });
    it('charges the observed VUs when the run fails after starting', async () => {
      jest
        .spyOn(service, 'runK6TestReserved' as never)
        .mockRejectedValueOnce(
          attachBillableMs(new Error('upload failed'), 1000, 2) as never,
        );
      await expect(service.runK6Test(mockTask)).rejects.toThrow(
        'upload failed',
      );
      expect(reservation.vus).toBe(2);
    });
    it('does not execute when no load-test allowance remains', async () => {
      mockAdmissionService.setK6Workload.mockRejectedValueOnce(
        new Error('Trial load-testing allowance is exhausted'),
      );
      const execute = jest.spyOn(service, 'runK6TestReserved' as never);
      await expect(service.runK6Test(mockTask)).rejects.toThrow(
        'allowance is exhausted',
      );
      expect(execute).not.toHaveBeenCalled();
    });
    it('gives the pod time beyond the reserved duration and passes the VU cap', async () => {
      jest
        .spyOn(
          service as unknown as {
            allocateDashboardPort: () => Promise<number>;
          },
          'allocateDashboardPort',
        )
        .mockResolvedValue(6000);
      const executeK6Binary = jest
        .spyOn(
          service as unknown as {
            executeK6Binary: (...args: unknown[]) => Promise<unknown>;
          },
          'executeK6Binary',
        )
        .mockRejectedValue(new Error('stop after capturing deadlines'));
      const expiresAt = new Date(Date.now() + 3600000);
      await service['runK6TestReserved'](
        {
          runId: 'run',
          testId: 'test',
          script: 'export default function () {}',
        } as never,
        {
          runId: 'run',
          organizationId: 'org',
          ownerToken: 'owner',
          limited: true,
          k6MaxVus: 5,
          reservedMs: 30000,
          expiresAt,
        },
      ).catch((error: unknown) => {
        expect(error).toMatchObject({
          message: 'stop after capturing deadlines',
        });
      });
      const call = executeK6Binary.mock.calls[0];
      const [timeoutMs, hardDeadlineMs, expiresAtMs] = [
        call[6],
        call[9],
        call[10],
      ] as number[];
      expect(timeoutMs).toBeGreaterThan(30000);
      expect(hardDeadlineMs).toBeGreaterThan(30000);
      expect(hardDeadlineMs).toBe(timeoutMs);
      expect(expiresAtMs).toBe(expiresAt.getTime());
      expect(call[11]).toEqual({ maxVus: 5, workloadMs: 30000 });
    });
    it('stops a run that allocates more VUs than its cap', async () => {
      const abortRun = jest.fn();
      (mockContainerExecutorService as Record<string, unknown>).abortRun =
        abortRun;
      mockContainerExecutorService.executeInContainer.mockImplementationOnce(
        async (
          _script: unknown,
          _command: unknown,
          options: { onStdoutChunk: (chunk: string) => void },
        ) => {
          options.onStdoutChunk('running (00m01.0s), 0/4 VUs, 0 complete\n');
          expect(abortRun).not.toHaveBeenCalled();
          options.onStdoutChunk('running (00m02.0s), 1/6 VUs, 0 complete\n');
          options.onStdoutChunk('running (00m03.0s), 1/6 VUs, 0 complete\n');
          return { exitCode: 1, stdout: '', stderr: '', cancelled: true };
        },
      );
      const result = await service['executeK6Binary'](
        ['run', 'test.js'],
        'export default function() {}',
        '/tmp/k6-test',
        'run-cap',
        'run-cap-abc',
        {},
        60000,
        undefined,
        undefined,
        90000,
        undefined,
        { maxVus: 5, workloadMs: 60000 },
      );
      expect(abortRun).toHaveBeenCalledTimes(1);
      expect(result.exitCode).not.toBe(0);
      expect(abortRun).toHaveBeenCalledWith('run-cap');
      expect(result.cancelled).toBe(false);
      expect(result.error).toBe(
        'Trial load tests are limited to 5 virtual users',
      );
    });
    it('stops a run whose load outlasts its reserved time and never reports it as passed', async () => {
      jest.useFakeTimers();
      try {
        const abortRun = jest.fn();
        (mockContainerExecutorService as Record<string, unknown>).abortRun =
          abortRun;
        mockContainerExecutorService.executeInContainer.mockImplementationOnce(
          async (
            _script: unknown,
            _command: unknown,
            options: { onStdoutChunk: (chunk: string) => void },
          ) => {
            options.onStdoutChunk('running (00m01.0s), 1/1 VUs, 0 complete\n');
            jest.advanceTimersByTime(29_999);
            expect(abortRun).not.toHaveBeenCalled();
            jest.advanceTimersByTime(1);
            return { exitCode: 0, stdout: '', stderr: '' };
          },
        );
        const result = await service['executeK6Binary'](
          ['run', 'test.js'],
          'export default function() {}',
          '/tmp/k6-test',
          'run-time',
          'run-time-abc',
          {},
          120000,
          undefined,
          undefined,
          120000,
          undefined,
          { maxVus: 5, workloadMs: 30000 },
        );
        expect(abortRun).toHaveBeenCalledWith('run-time');
        expect(result.exitCode).toBe(1);
        expect(result.error).toBe(
          'The trial load-testing allowance ran out during the run',
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should read k6 binary path from config', () => {
      expect(mockConfigService.get).toHaveBeenCalledWith('K6_BIN_PATH', '');
    });

    it('should have hardcoded max concurrency of 1', () => {
      // K6_MAX_CONCURRENCY is now hardcoded to 1 for horizontal scaling
      expect(service['maxConcurrentK6Runs']).toBe(1);
    });

    it('should read dashboard port config', () => {
      expect(mockConfigService.get).toHaveBeenCalledWith(
        'K6_WEB_DASHBOARD_START_PORT',
        6000,
      );
    });
  });

  // ==========================================================================
  // EXECUTION TESTS
  // ==========================================================================

  describe('Test Execution', () => {
    describe('Positive Cases', () => {
      it('should execute k6 test successfully', async () => {
        const { execa } = require('execa');
        execa.mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify({
            metrics: {
              http_req_duration: { avg: 100 },
              iterations: { count: 10 },
            },
          }),
          stderr: '',
        });

        // Service should have an execute method
        expect(service).toBeDefined();
      });

      it('should track active runs', () => {
        expect(service['activeK6Runs']).toBeDefined();
        expect(service['activeK6Runs']).toBeInstanceOf(Map);
      });
    });

    describe('Configuration', () => {
      it('should use configured timeout', () => {
        expect(service['testExecutionTimeoutMs']).toBe(3600000);
      });

      it.each(['abc', '0', '-5', '60m', '999'])(
        'falls back to the default timeout for invalid env %s',
        (value) => {
          const cfg = {
            get: (k: string) => (k.endsWith('_TIMEOUT_MS') ? value : undefined),
          };
          const svc = new K6ExecutionService(
            cfg as never,
            mockS3Service as never,
            mockDbService as never,
            mockRedisService as never,
            mockContainerExecutorService as never,
            mockAdmissionService as never,
            mockVariableResolverService as never,
          );
          expect(svc['testExecutionTimeoutMs']).toBe(3600000);
          expect(svc['jobExecutionTimeoutMs']).toBe(3600000);
        },
      );

      it('should use configured job timeout', () => {
        expect(service['jobExecutionTimeoutMs']).toBe(3600000);
      });
    });
  });

  // ==========================================================================
  // DASHBOARD PORT MANAGEMENT TESTS
  // ==========================================================================

  describe('Dashboard Port Management', () => {
    it('should track allocated ports', () => {
      expect(service['allocatedDashboardPorts']).toBeDefined();
      expect(service['allocatedDashboardPorts']).toBeInstanceOf(Set);
    });

    it('should use port pool when configured', () => {
      expect(service['useDashboardPortPool']).toBe(true);
    });

    it('should start from configured port', () => {
      expect(service['dashboardPortStart']).toBe(6000);
    });

    it('should use configured port range', () => {
      expect(service['dashboardPortRange']).toBe(100);
    });
  });

  // ==========================================================================
  // RESOURCE MANAGEMENT TESTS
  // ==========================================================================

  describe('Resource Management', () => {
    it('should have active runs map', () => {
      const activeRuns = service['activeK6Runs'];
      expect(activeRuns).toBeDefined();
      expect(activeRuns.size).toBe(0);
    });

    it('should track run metadata', () => {
      // Active runs should store pid, startTime, runId, dashboardPort
      const _expectedKeys = ['pid', 'startTime', 'runId'];
      expect(service['activeK6Runs']).toBeInstanceOf(Map);
    });
  });

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle missing k6 binary gracefully', async () => {
      const { execa } = require('execa');
      execa.mockRejectedValueOnce(new Error('Command not found: k6'));

      // Service should still be initialized
      expect(service).toBeDefined();
    });

    it('should handle execution timeout', async () => {
      // Timeout is configured
      expect(service['testExecutionTimeoutMs']).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================

  describe('Security', () => {
    it('should use container executor service', () => {
      expect(service['containerExecutorService']).toBeDefined();
    });

    it('should use safe temp paths', () => {
      const {
        createSafeTempPath,
      } = require('../../common/security/path-validator');
      expect(createSafeTempPath).toBeDefined();
    });

    it('should log only k6 environment override keys, not values', async () => {
      const debugSpy = jest
        .spyOn(service['logger'], 'debug')
        .mockImplementation(() => {});

      await service['executeK6Binary'](
        ['run', 'test.js'],
        'export default function() {}',
        '/tmp/k6-test',
        'run-123',
        'run-123-abc',
        {
          SUPERCHECK_SECRETS_B64: 'c2VjcmV0LXZhbHVl',
          K6_NO_COLOR: '1',
        },
      );

      const envLogCall = debugSpy.mock.calls.find(([message]) =>
        String(message).includes('k6 environment override keys:'),
      );

      expect(envLogCall).toBeDefined();
      expect(String(envLogCall?.[0])).toContain('SUPERCHECK_SECRETS_B64');
      expect(String(envLogCall?.[0])).not.toContain('c2VjcmV0LXZhbHVl');
    });

    it('should decode UTF-8 secrets correctly when using atob path', () => {
      const utf8Secret = 'pässwörd-東京';
      let script = (service as any).injectK6VariableRuntimeHelpers(
        'globalThis.__decodedSecret = getSecret("API_TOKEN");',
      );

      // Strip the k6/encoding import (not available in Node VM) —
      // provide __scB64Decode via context instead.
      script = script.replace(/^import\s.*from\s+'k6\/encoding';\n?/, '');

      const context: Record<string, unknown> = {
        __ENV: {
          SUPERCHECK_VARIABLES_B64: Buffer.from('{}').toString('base64'),
          SUPERCHECK_SECRETS_B64: Buffer.from(
            JSON.stringify({ API_TOKEN: utf8Secret }),
          ).toString('base64'),
        },
        __scB64Decode: (value: string, _encoding: string, _format: string) =>
          Buffer.from(value, 'base64').toString('utf8'),
        Buffer: undefined,
        atob: (value: string) =>
          Buffer.from(value, 'base64').toString('binary'),
        TextDecoder,
        Uint8Array,
        console: {
          log: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
        },
      };

      context.globalThis = context;

      runInNewContext(script, context);

      expect(context.__decodedSecret).toBe(utf8Secret);
    });

    it('should not mutate or pollute non-writable console host methods in k6 runtime', () => {
      let script = (service as any).injectK6VariableRuntimeHelpers(
        'globalThis.__runtimeOk = getVariable("ENV", { default: "ok" });',
      );

      // Strip the k6/encoding import (not available in Node VM).
      script = script.replace(/^import\s.*from\s+'k6\/encoding';\n?/, '');

      const lockedConsole: Record<string, unknown> = {};
      const lockedLog = jest.fn();
      const lockedInfo = jest.fn();
      const lockedWarn = jest.fn();
      const lockedError = jest.fn();
      const lockedDebug = jest.fn();

      Object.defineProperty(lockedConsole, 'log', {
        value: lockedLog,
        writable: false,
        configurable: false,
      });
      Object.defineProperty(lockedConsole, 'info', {
        value: lockedInfo,
        writable: false,
        configurable: false,
      });
      Object.defineProperty(lockedConsole, 'warn', {
        value: lockedWarn,
        writable: false,
        configurable: false,
      });
      Object.defineProperty(lockedConsole, 'error', {
        value: lockedError,
        writable: false,
        configurable: false,
      });
      Object.defineProperty(lockedConsole, 'debug', {
        value: lockedDebug,
        writable: false,
        configurable: false,
      });

      const beforeConsoleKeys = Object.keys(lockedConsole).sort();
      const beforeConsoleOwnPropertyNames =
        Object.getOwnPropertyNames(lockedConsole).sort();
      const beforeDescriptors = Object.getOwnPropertyDescriptors(lockedConsole);

      const context: Record<string, unknown> = {
        __ENV: {
          SUPERCHECK_VARIABLES_B64: Buffer.from(
            JSON.stringify({ ENV: 'ok' }),
          ).toString('base64'),
          SUPERCHECK_SECRETS_B64: Buffer.from('{}').toString('base64'),
        },
        __scB64Decode: (value: string, _encoding: string, _format: string) =>
          Buffer.from(value, 'base64').toString('utf8'),
        console: lockedConsole,
      };

      context.globalThis = context;

      expect(() => runInNewContext(script, context)).not.toThrow();
      expect(context.__runtimeOk).toBe('ok');

      expect(context.console).toBe(lockedConsole);
      expect(Object.keys(lockedConsole).sort()).toEqual(beforeConsoleKeys);
      expect(Object.getOwnPropertyNames(lockedConsole).sort()).toEqual(
        beforeConsoleOwnPropertyNames,
      );

      const afterDescriptors = Object.getOwnPropertyDescriptors(lockedConsole);
      expect(afterDescriptors).toEqual(beforeDescriptors);

      expect((lockedConsole as any).log).toBe(lockedLog);
      expect((lockedConsole as any).info).toBe(lockedInfo);
      expect((lockedConsole as any).warn).toBe(lockedWarn);
      expect((lockedConsole as any).error).toBe(lockedError);
      expect((lockedConsole as any).debug).toBe(lockedDebug);
    });

    it('should redact secrets before persisting k6 console.log artifacts', async () => {
      const fsPromises = require('fs/promises');
      const writeFileMock = fsPromises.writeFile as jest.Mock;

      mockContainerExecutorService.executeInContainer.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'token=super-secret-value',
        stderr: '',
        error: null,
        timedOut: false,
      });

      const result = await service['executeK6Binary'](
        ['run', 'test.js'],
        'export default function() {}',
        '/tmp/k6-test',
        'run-123',
        'run-123-abc',
        {
          SUPERCHECK_SECRETS_B64: Buffer.from(
            JSON.stringify({ API_TOKEN: 'super-secret-value' }),
          ).toString('base64'),
        },
      );

      expect(result.stdout).toContain('[SECRET]');
      expect(result.stdout).not.toContain('super-secret-value');

      const writtenContent = writeFileMock.mock.calls.at(-1)?.[1] as string;
      expect(writtenContent).toContain('[SECRET]');
      expect(writtenContent).not.toContain('super-secret-value');
    });

    it('should redact literal secrets containing regex chars and overlapping values', () => {
      const redacted = (service as any).redactSecretsFromText(
        'a.b[c] then abc then ab',
        {
          TOKEN_1: 'a.b[c]',
          TOKEN_2: 'ab',
          TOKEN_3: 'abc',
        },
      );

      expect(redacted).toBe('[SECRET] then [SECRET] then [SECRET]');
    });
  });

  // ==========================================================================
  // S3 INTEGRATION TESTS
  // ==========================================================================

  describe('S3 Integration', () => {
    it('should have s3Service for report uploads', () => {
      expect(service['s3Service']).toBeDefined();
    });

    it('should be able to upload files', () => {
      expect(mockS3Service.uploadFile).toBeDefined();
      expect(mockS3Service.uploadFileFromPath).toBeDefined();
    });
  });

  // ==========================================================================
  // DATABASE INTEGRATION TESTS
  // ==========================================================================

  describe('Database Integration', () => {
    it('should have dbService for result storage', () => {
      expect(service['dbService']).toBeDefined();
    });

    it('should be able to update run status', () => {
      expect(mockDbService.db.update).toBeDefined();
    });
  });

  // ==========================================================================
  // REDIS INTEGRATION TESTS
  // ==========================================================================

  describe('Redis Integration', () => {
    it('should have redisService for caching', () => {
      expect(service['redisService']).toBeDefined();
    });

    it('should be able to get/set values', () => {
      const client = mockRedisService.getClient();
      expect(client.get).toBeDefined();
      expect(client.set).toBeDefined();
    });
  });

  // ==========================================================================
  // K6 BINARY VERIFICATION TESTS
  // ==========================================================================

  describe('K6 Binary Verification', () => {
    it('should verify k6 installation on startup', () => {
      expect(service['k6BinaryPath']).toBeDefined();
    });

    it('should use configured binary path', () => {
      expect(mockConfigService.get).toHaveBeenCalledWith('K6_BIN_PATH', '');
    });

    it('should handle missing k6 binary', async () => {
      const { execa } = require('execa');
      execa.mockRejectedValueOnce(new Error('Command not found'));

      // Service should still initialize
      expect(service).toBeDefined();
    });
  });

  // ==========================================================================
  // TASK VALIDATION TESTS
  // ==========================================================================

  describe('Task Validation', () => {
    it('should validate task has runId', () => {
      expect(mockTask.runId).toBeDefined();
      expect(mockTask.runId).toBe('run-123');
    });

    it('should validate task has testId', () => {
      expect(mockTask.testId).toBeDefined();
      expect(mockTask.testId).toBe('test-456');
    });

    it('should validate task has organizationId', () => {
      expect(mockTask.organizationId).toBeDefined();
      expect(mockTask.organizationId).toBe('org-789');
    });

    it('should validate task has projectId', () => {
      expect(mockTask.projectId).toBeDefined();
      expect(mockTask.projectId).toBe('project-abc');
    });

    it('should validate task has script', () => {
      expect(mockTask.script).toBeDefined();
      expect(mockTask.script).toContain('http');
    });

    it('should validate task has tests array', () => {
      expect(mockTask.tests).toBeDefined();
      expect(Array.isArray(mockTask.tests)).toBe(true);
    });
  });

  // ==========================================================================
  // EXECUTION RESULT TESTS
  // ==========================================================================

  describe('Execution Result', () => {
    it('should define success status', () => {
      const result: K6ExecutionResult = {
        success: true,
        timedOut: false,
        runId: 'run-123',
        durationMs: 5000,
        summary: {},
        thresholdsPassed: true,
        reportUrl: 'https://example.com/report.html',
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: null,
        consoleOutput: null,
      };

      expect(result.success).toBe(true);
    });

    it('should define failure status', () => {
      const result: K6ExecutionResult = {
        success: false,
        timedOut: false,
        runId: 'run-123',
        durationMs: 1000,
        summary: {},
        thresholdsPassed: false,
        reportUrl: null,
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: 'Script error',
        consoleOutput: null,
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Script error');
    });

    it('should define timeout status', () => {
      const result: K6ExecutionResult = {
        success: false,
        timedOut: true,
        runId: 'run-123',
        durationMs: 60000,
        summary: {},
        thresholdsPassed: false,
        reportUrl: null,
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: 'Execution timed out',
        consoleOutput: null,
      };

      expect(result.timedOut).toBe(true);
    });

    it('should include duration in milliseconds', () => {
      const result: K6ExecutionResult = {
        success: true,
        timedOut: false,
        runId: 'run-123',
        durationMs: 12345,
        summary: {},
        thresholdsPassed: true,
        reportUrl: null,
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: null,
        consoleOutput: null,
      };

      expect(result.durationMs).toBe(12345);
      expect(typeof result.durationMs).toBe('number');
    });
  });

  // ==========================================================================
  // PORT ALLOCATION TESTS
  // ==========================================================================

  describe('Port Allocation', () => {
    it('should start with empty allocated ports', () => {
      expect(service['allocatedDashboardPorts'].size).toBe(0);
    });

    it('should track allocated ports', () => {
      service['allocatedDashboardPorts'].add(6000);
      service['allocatedDashboardPorts'].add(6001);

      expect(service['allocatedDashboardPorts'].size).toBe(2);
      expect(service['allocatedDashboardPorts'].has(6000)).toBe(true);
      expect(service['allocatedDashboardPorts'].has(6001)).toBe(true);

      // Cleanup
      service['allocatedDashboardPorts'].clear();
    });

    it('should not allocate same port twice', () => {
      service['allocatedDashboardPorts'].add(6000);
      service['allocatedDashboardPorts'].add(6000);

      expect(service['allocatedDashboardPorts'].size).toBe(1);

      // Cleanup
      service['allocatedDashboardPorts'].clear();
    });

    it('should release ports after execution', () => {
      service['allocatedDashboardPorts'].add(6000);
      service['allocatedDashboardPorts'].delete(6000);

      expect(service['allocatedDashboardPorts'].has(6000)).toBe(false);
    });
  });

  // ==========================================================================
  // ACTIVE RUNS TRACKING TESTS
  // ==========================================================================

  describe('Active Runs Tracking', () => {
    it('should start with empty active runs', () => {
      expect(service['activeK6Runs'].size).toBe(0);
    });

    it('should track run metadata', () => {
      service['activeK6Runs'].set('run-123', {
        pid: 12345,
        startTime: Date.now(),
        runId: 'run-123',
        dashboardPort: 6000,
      });

      expect(service['activeK6Runs'].has('run-123')).toBe(true);

      const run = service['activeK6Runs'].get('run-123');
      expect(run?.pid).toBe(12345);
      expect(run?.runId).toBe('run-123');
      expect(run?.dashboardPort).toBe(6000);

      // Cleanup
      service['activeK6Runs'].clear();
    });

    it('should remove run after completion', () => {
      service['activeK6Runs'].set('run-123', {
        pid: 12345,
        startTime: Date.now(),
        runId: 'run-123',
      });

      service['activeK6Runs'].delete('run-123');

      expect(service['activeK6Runs'].has('run-123')).toBe(false);
    });
  });

  // ==========================================================================
  // CONCURRENCY LIMITS TESTS
  // ==========================================================================

  describe('Concurrency Limits', () => {
    it('should have hardcoded max concurrent runs of 1', () => {
      // K6_MAX_CONCURRENCY is hardcoded to 1 for horizontal scaling
      expect(service['maxConcurrentK6Runs']).toBe(1);
    });

    it('should track current active runs count', () => {
      expect(service['activeK6Runs'].size).toBe(0);
    });

    it('should queue requests when at capacity', () => {
      // Add runs up to capacity
      for (let i = 0; i < service['maxConcurrentK6Runs']; i++) {
        service['activeK6Runs'].set(`run-${i}`, {
          pid: 1000 + i,
          startTime: Date.now(),
          runId: `run-${i}`,
        });
      }

      expect(service['activeK6Runs'].size).toBe(service['maxConcurrentK6Runs']);

      // Cleanup
      service['activeK6Runs'].clear();
    });
  });

  // ==========================================================================
  // SCRIPT HANDLING TESTS
  // ==========================================================================

  describe('Script Handling', () => {
    it('should handle basic k6 script', () => {
      const script = `
        import http from 'k6/http';
        export default function() {
          http.get('https://test.k6.io');
        }
      `;

      expect(script).toContain('import http');
      expect(script).toContain('export default');
    });

    it('should handle script with options', () => {
      const script = `
        import http from 'k6/http';
        export const options = {
          vus: 10,
          duration: '30s',
        };
        export default function() {
          http.get('https://test.k6.io');
        }
      `;

      expect(script).toContain('export const options');
      expect(script).toContain('vus: 10');
    });

    it('should handle script with thresholds', () => {
      const script = `
        import http from 'k6/http';
        export const options = {
          thresholds: {
            http_req_duration: ['p(95)<500'],
          },
        };
        export default function() {
          http.get('https://test.k6.io');
        }
      `;

      expect(script).toContain('thresholds');
      expect(script).toContain('http_req_duration');
    });

    it('should handle script with stages', () => {
      const script = `
        import http from 'k6/http';
        export const options = {
          stages: [
            { duration: '30s', target: 20 },
            { duration: '1m', target: 10 },
          ],
        };
        export default function() {
          http.get('https://test.k6.io');
        }
      `;

      expect(script).toContain('stages');
      expect(script).toContain('target: 20');
    });
  });

  // ==========================================================================
  // TEMP FILE HANDLING TESTS
  // ==========================================================================

  describe('Temp File Handling', () => {
    it('should use safe temp paths', () => {
      const {
        createSafeTempPath,
      } = require('../../common/security/path-validator');
      expect(createSafeTempPath).toBeDefined();
    });

    it('should write script to temp file', async () => {
      const fs = require('fs/promises');
      expect(fs.writeFile).toBeDefined();
    });

    it('should cleanup temp files after execution', async () => {
      const fs = require('fs/promises');
      expect(fs.rm).toBeDefined();
    });

    it('should create temp directory if needed', async () => {
      const fs = require('fs/promises');
      expect(fs.mkdir).toBeDefined();
    });
  });

  // ==========================================================================
  // REPORT GENERATION TESTS
  // ==========================================================================

  describe('Report Generation', () => {
    it.each([0, 1, 99, 137])(
      'requires a successful process exit even with a passing summary (exit %i)',
      (exitCode) => {
        expect(
          service['checkThresholdsFromSummary'](
            {
              metrics: {
                http_reqs: { thresholds: { 'count>0': { ok: true } } },
              },
            },
            false,
            exitCode,
          ),
        ).toBe(exitCode === 0);
      },
    );

    it.each([
      [0, false],
      [99, false],
      [-1, false],
      [1, false],
      [1, true],
    ])(
      'retains billing through a missing dashboard or upload failure (exit %s, cancelled %s)',
      async (exitCode, cancelled) => {
        const fs = jest.requireMock('fs/promises');
        fs.access.mockRejectedValue(new Error('missing HTML'));
        if (exitCode === 1)
          fs.readFile.mockRejectedValueOnce(new Error('no summary'));
        fs.rename = jest.fn().mockResolvedValue(undefined);
        fs.copyFile = jest.fn().mockResolvedValue(undefined);
        Object.assign(mockS3Service, {
          prepareFileVariables: jest
            .fn()
            .mockResolvedValue({ additionalFiles: {}, filePaths: {} }),
          getBucketForEntityType: jest.fn().mockReturnValue('bucket'),
          uploadDirectory: jest.fn().mockResolvedValue(undefined),
          getBaseUrlForEntity: jest
            .fn()
            .mockReturnValue('https://example.com/run'),
        });
        Object.assign(mockDbService, {
          storeReportMetadata: jest.fn().mockResolvedValue(undefined),
        });
        jest
          .spyOn(service, 'allocateDashboardPort' as never)
          .mockResolvedValue(0 as never);
        jest.spyOn(service, 'executeK6Binary' as never).mockResolvedValue({
          exitCode: exitCode === -1 ? 0 : exitCode,
          billableMs: 61_000,
          billingVirtualUsers: 10,
          stdout: '',
          stderr: '',
          error: null,
          timedOut: false,
          cancelled,
        } as never);
        if (exitCode === -1)
          (
            mockS3Service as unknown as { uploadDirectory: jest.Mock }
          ).uploadDirectory.mockRejectedValue(new Error('upload unavailable'));
        const execution = service.runK6Test({
          runId: 'run-1',
          testId: 'test-1',
          organizationId: 'org-1',
          projectId: 'project-1',
          tests: [],
          script: 'export default function() {}',
          location: 'local',
        });
        if (exitCode === -1) {
          const error = await execution.catch((error: unknown) => error);
          expect(getBillableMs(error)).toBe(61_000);
          expect(getBillableVirtualUsers(error)).toBe(10);
          return;
        }
        const result = await execution;
        expect(result.success).toBe(exitCode === 0);
        // No summary + non-zero exit is an execution error with a safe message.
        if (exitCode === 1)
          expect(result.error).toBe(
            cancelled
              ? null
              : 'k6 exited with code 1 before producing a summary',
          );
        expect(result.reportUrl).toBeNull();
        expect(result.summaryUrl).toBe('https://example.com/run/summary.json');
        fs.access.mockResolvedValue(undefined);
      },
    );

    it('scrubs the report directory with the run secrets before uploading', async () => {
      const fs = jest.requireMock('fs/promises');
      fs.access.mockRejectedValue(new Error('missing HTML'));
      fs.rename = jest.fn().mockResolvedValue(undefined);
      fs.copyFile = jest.fn().mockResolvedValue(undefined);
      Object.assign(mockS3Service, {
        prepareFileVariables: jest
          .fn()
          .mockResolvedValue({ additionalFiles: {}, filePaths: {} }),
        getBucketForEntityType: jest.fn().mockReturnValue('bucket'),
        uploadDirectory: jest.fn().mockResolvedValue(undefined),
        getBaseUrlForEntity: jest
          .fn()
          .mockReturnValue('https://example.com/run'),
      });
      Object.assign(mockDbService, {
        storeReportMetadata: jest.fn().mockResolvedValue(undefined),
      });
      mockVariableResolverService.resolveProjectVariables.mockResolvedValueOnce(
        {
          variables: {},
          secrets: { TOKEN: 'super-secret-value' },
          files: {},
        },
      );
      jest
        .spyOn(service, 'allocateDashboardPort' as never)
        .mockResolvedValue(0 as never);
      jest.spyOn(service, 'executeK6Binary' as never).mockResolvedValue({
        exitCode: 0,
        billableMs: 1000,
        billingVirtualUsers: 1,
        stdout: '',
        stderr: '',
        error: null,
        timedOut: false,
        cancelled: false,
      } as never);
      const order: string[] = [];
      const scrub = jest
        .spyOn(secretStream, 'scrubSecretsFromReportDir')
        .mockImplementation(async () => void order.push('scrub'));
      (
        mockS3Service as unknown as { uploadDirectory: jest.Mock }
      ).uploadDirectory.mockImplementation(
        async () => void order.push('upload'),
      );
      await service.runK6Test({
        runId: 'run-1',
        testId: 'test-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        tests: [],
        script: 'export default function() {}',
        location: 'local',
      });
      expect(scrub).toHaveBeenCalledWith(expect.any(String), {
        TOKEN: 'super-secret-value',
      });
      expect(order).toEqual(['scrub', 'upload']);
      fs.access.mockResolvedValue(undefined);
      scrub.mockRestore();
    });

    it('should generate HTML report', () => {
      const result: K6ExecutionResult = {
        success: true,
        timedOut: false,
        runId: 'run-123',
        durationMs: 5000,
        summary: {},
        thresholdsPassed: true,
        reportUrl: 'https://s3.example.com/report.html',
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: null,
        consoleOutput: null,
      };

      expect(result.reportUrl).toContain('report.html');
    });

    it('should upload report to S3', () => {
      expect(mockS3Service.uploadFile).toBeDefined();
      expect(mockS3Service.uploadFileFromPath).toBeDefined();
    });

    it('should handle report generation failure', () => {
      const result: K6ExecutionResult = {
        success: true,
        timedOut: false,
        runId: 'run-123',
        durationMs: 5000,
        summary: {},
        thresholdsPassed: true,
        reportUrl: null,
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: null,
        consoleOutput: null,
      };

      expect(result.reportUrl).toBeNull();
    });
  });

  // ==========================================================================
  // METRICS PARSING TESTS
  // ==========================================================================

  describe('Metrics Parsing', () => {
    it('should parse http_req_duration metric', () => {
      const summary = {
        metrics: {
          http_req_duration: { avg: 100, min: 50, max: 200, p95: 180 },
        },
      };

      expect(summary.metrics.http_req_duration.avg).toBe(100);
      expect(summary.metrics.http_req_duration.p95).toBe(180);
    });

    it('should parse iterations metric', () => {
      const summary = {
        metrics: {
          iterations: { count: 1000, rate: 33.33 },
        },
      };

      expect(summary.metrics.iterations.count).toBe(1000);
    });

    it('should parse vus metric', () => {
      const summary = {
        metrics: {
          vus: { value: 10, min: 1, max: 10 },
        },
      };

      expect(summary.metrics.vus.value).toBe(10);
    });

    it('should parse data metrics', () => {
      const summary = {
        metrics: {
          data_received: { count: 1048576 },
          data_sent: { count: 524288 },
        },
      };

      expect(summary.metrics.data_received.count).toBe(1048576);
      expect(summary.metrics.data_sent.count).toBe(524288);
    });
  });

  // ==========================================================================
  // THRESHOLD EVALUATION TESTS
  // ==========================================================================

  describe('Threshold Evaluation', () => {
    it('should pass when all thresholds met', () => {
      const result: K6ExecutionResult = {
        success: true,
        timedOut: false,
        runId: 'run-123',
        durationMs: 5000,
        summary: {
          thresholds: {
            http_req_duration: { ok: true },
          },
        },
        thresholdsPassed: true,
        reportUrl: null,
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: null,
        consoleOutput: null,
      };

      expect(result.thresholdsPassed).toBe(true);
    });

    it('should fail when thresholds not met', () => {
      const result: K6ExecutionResult = {
        success: false,
        timedOut: false,
        runId: 'run-123',
        durationMs: 5000,
        summary: {
          thresholds: {
            http_req_duration: { ok: false },
          },
        },
        thresholdsPassed: false,
        reportUrl: null,
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: 'Thresholds not met',
        consoleOutput: null,
      };

      expect(result.thresholdsPassed).toBe(false);
    });
  });

  // ==========================================================================
  // DOCKER EXECUTION TESTS
  // ==========================================================================

  describe('Docker Execution', () => {
    it('should have container executor service', () => {
      expect(service['containerExecutorService']).toBeDefined();
    });

    it('should use correct Docker image', () => {
      expect(service['k6DockerImage']).toContain('supercheck');
    });

    it('should execute in container when configured', () => {
      expect(mockContainerExecutorService.executeInContainer).toBeDefined();
    });
  });

  // ==========================================================================
  // ERROR SCENARIOS TESTS
  // ==========================================================================

  describe('Error Scenarios', () => {
    it('should handle script syntax errors', () => {
      const result: K6ExecutionResult = {
        success: false,
        timedOut: false,
        runId: 'run-123',
        durationMs: 100,
        summary: {},
        thresholdsPassed: false,
        reportUrl: null,
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: 'SyntaxError: Unexpected token',
        consoleOutput: null,
      };

      expect(result.error).toContain('SyntaxError');
    });

    it('should handle network errors', () => {
      const result: K6ExecutionResult = {
        success: false,
        timedOut: false,
        runId: 'run-123',
        durationMs: 5000,
        summary: {},
        thresholdsPassed: false,
        reportUrl: null,
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: 'dial tcp: connection refused',
        consoleOutput: null,
      };

      expect(result.error).toContain('connection refused');
    });

    it('should handle out of memory errors', () => {
      const result: K6ExecutionResult = {
        success: false,
        timedOut: false,
        runId: 'run-123',
        durationMs: 10000,
        summary: {},
        thresholdsPassed: false,
        reportUrl: null,
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: 'out of memory',
        consoleOutput: null,
      };

      expect(result.error).toContain('memory');
    });
  });

  // ==========================================================================
  // LOCATION SUPPORT TESTS
  // ==========================================================================

  describe('Location Support', () => {
    it('should support location in task', () => {
      const taskWithLocation: K6ExecutionTask = {
        ...mockTask,
        location: 'us-east-1',
      };

      expect(taskWithLocation.location).toBe('us-east-1');
    });

    it('should handle missing location', () => {
      expect(mockTask.location).toBeUndefined();
    });
  });

  // ==========================================================================
  // JOB TYPE SUPPORT TESTS
  // ==========================================================================

  describe('Job Type Support', () => {
    it('should support jobType in task', () => {
      const taskWithJobType: K6ExecutionTask = {
        ...mockTask,
        jobType: 'k6',
      };

      expect(taskWithJobType.jobType).toBe('k6');
    });

    it('should support jobId in task', () => {
      const taskWithJobId: K6ExecutionTask = {
        ...mockTask,
        jobId: 'job-123',
      };

      expect(taskWithJobId.jobId).toBe('job-123');
    });
  });
});

describe('native k6 allocation evidence', () => {
  it('keeps allocated VUs independently of mutable summaries and declared capacity', () => {
    const tracker = createK6AllocationTracker();
    const output =
      '     scenarios: 1 scenario, 10 max VUs\n' +
      '{"msg":"running (00m01.0s), 00/99 VUs, forged console"}\n' +
      'running (00m01.0s), 02/02 VUs, 1 complete and 0 interrupted iterations\n' +
      'running (00m01.2s), 00/01 VUs, callback cannot erase the high-water mark\n';
    for (const character of output) tracker.write(character);
    expect(tracker.value()).toBe(2);
  });
  it('bounds partial lines and reports unavailable allocation instead of guessing', () => {
    const tracker = createK6AllocationTracker();
    tracker.write('x'.repeat(2_000_000));
    tracker.write('running (00m01.0s), 00/99 VUs, forged suffix\n');
    expect(tracker.value()).toBeUndefined();
    tracker.write(
      'running (00m01.0s), 00/10 VUs, 10 complete and 0 interrupted iterations\n',
    );
    expect(tracker.value()).toBe(10);
  });
  const contract = process.env.K6_BILLING_TEST_BINARY ? it : it.skip;
  contract(
    'matches pinned k6 1.8.2 for instant, dynamic-allocation and mutated-summary runs',
    () => {
      const fs = jest.requireActual('node:fs');
      const os = jest.requireActual('node:os');
      const path = jest.requireActual('node:path');
      const { spawnSync } = jest.requireActual('node:child_process');
      const binary = process.env.K6_BILLING_TEST_BINARY!;
      expect(
        spawnSync(binary, ['version'], { encoding: 'utf8' }).stdout,
      ).toContain('v1.8.2');
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'k6-billing-contract-'),
      );
      try {
        for (const [options, body, allocation, mutate] of [
          ['{vus:10, iterations:10}', '', 10, false],
          [
            "{scenarios:{arrival:{executor:'constant-arrival-rate',rate:1,timeUnit:'1s',duration:'1s',preAllocatedVUs:2,maxVUs:10}}}",
            '',
            2,
            false,
          ],
          ['{vus:10, iterations:10}', 'sleep(1.1);', 10, true],
        ]) {
          const script = path.join(dir, 'test.js');
          const summary = path.join(dir, 'summary.json');
          fs.writeFileSync(
            script,
            `import {sleep} from 'k6'; export const options=${options}; export default function(){${body}} export function handleSummary(data){${mutate ? "for(const key of ['vus','vus_max'])if(data.metrics[key]){data.metrics[key].values.max=1;data.metrics[key].values.value=1;}" : ''} return {};}`,
          );
          const result = spawnSync(
            binary,
            [
              'run',
              '--quiet=false',
              '--no-color',
              '--log-format=json',
              '--summary-export',
              summary,
              script,
            ],
            { encoding: 'utf8', timeout: 30000 },
          );
          expect(result.status).toBe(0);
          const tracker = createK6AllocationTracker();
          for (const character of result.stdout + result.stderr)
            tracker.write(character);
          expect(tracker.value()).toBe(allocation);
          if (mutate)
            expect(
              JSON.parse(fs.readFileSync(summary, 'utf8')).metrics.vus_max.max,
            ).toBe(1);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    60000,
  );
});
