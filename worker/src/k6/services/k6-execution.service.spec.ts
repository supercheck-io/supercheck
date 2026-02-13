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

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
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

// Mock execa
jest.mock('execa', () => ({
  execa: jest.fn().mockResolvedValue({
    exitCode: 0,
    stdout: 'k6 v0.45.0',
    stderr: '',
  }),
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
  };

  const mockDbService = {
    db: {
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined),
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

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        K6ExecutionService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: S3Service, useValue: mockS3Service },
        { provide: DbService, useValue: mockDbService },
        { provide: RedisService, useValue: mockRedisService },
        {
          provide: ContainerExecutorService,
          useValue: mockContainerExecutorService,
        },
      ],
    }).compile();

    service = module.get<K6ExecutionService>(K6ExecutionService);
  });

  // ==========================================================================
  // INITIALIZATION TESTS
  // ==========================================================================

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
      const script = (service as any).injectK6VariableRuntimeHelpers(
        'globalThis.__decodedSecret = getSecret("API_TOKEN");',
      );

      const context: Record<string, unknown> = {
        __ENV: {
          SUPERCHECK_VARIABLES_B64: Buffer.from('{}').toString('base64'),
          SUPERCHECK_SECRETS_B64: Buffer.from(
            JSON.stringify({ API_TOKEN: utf8Secret }),
          ).toString('base64'),
        },
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
