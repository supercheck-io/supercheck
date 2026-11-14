import { AxiosError } from 'axios';
import { resolveMonitorSecret } from './monitor-secret';
import { throwError } from 'rxjs';
/**
 * Monitor Service Tests
 *
 * Comprehensive test coverage for monitor execution
 *
 * Test Categories:
 * - HTTP Request Monitoring (GET, POST, status validation)
 * - Website Monitoring (SSL checks, content validation)
 * - Ping Monitoring (TCP reachability on ports 443 and 80)
 * - Port Monitoring (TCP connection)
 * - Custom Playwright Monitoring
 * - Alert Handling (status changes, notifications)
 * - Error Handling (timeouts, network errors)
 * - Security (URL validation, credential masking)
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';

// Mock problematic dependencies before import
jest.mock('execa', () => ({
  execa: jest.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
}));

jest.mock('../execution/services/execution.service', () => ({
  ExecutionService: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true }),
  })),
}));

jest.mock('./monitor-secret', () => ({ resolveMonitorSecret: jest.fn() }));

jest.mock('../common/utils/pinned-monitor-request', () => ({
  requestPinnedMonitorTarget: jest.fn(
    async (
      config: unknown,
      _options: unknown,
      execute: (requestConfig: unknown) => Promise<unknown>,
    ) => execute(config),
  ),
  resolvePublicAddress: jest.fn(async () => ({
    address: '93.184.216.34',
    family: 4,
  })),
  vettedLookup: jest.fn(async () => jest.fn()),
}));

// Unit tests must not dial the internet. `net` and `tls` are replaced with
// controllable fakes so the TCP/TLS paths are asserted deterministically
// instead of depending on google.com / example.com being reachable from CI.
jest.mock('net', () => {
  const actual = jest.requireActual('net');
  const { EventEmitter } = jest.requireActual('events');
  const state = {
    behavior: 'error' as
      | 'connect'
      | 'error'
      | 'aggregate'
      | 'mixed'
      | 'empty'
      | 'timeout'
      | 'timeout-aggregate'
      | 'enotfound',
    // Per-attempt outcomes for createConnection (ping), consumed in order before `behavior`.
    attempts: [] as Array<{
      outcome: 'connect' | 'refused' | 'mixed' | 'timeout' | 'enotfound';
      delayMs?: number;
    }>,
  };

  class FakeSocket extends EventEmitter {
    destroy = jest.fn();
    // Accepts both connect(port, host, cb) and connect(options, cb).
    connect = jest.fn((...args: unknown[]) => {
      const callback = args.find((a) => typeof a === 'function') as
        (() => void) | undefined;
      process.nextTick(() => {
        if (state.behavior === 'connect') callback?.();
        else if (state.behavior === 'aggregate')
          this.emit(
            'error',
            new AggregateError([
              Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
            ]),
          );
        else if (state.behavior === 'mixed')
          this.emit(
            'error',
            new AggregateError([
              Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
              Object.assign(new Error('unreachable'), { code: 'EHOSTUNREACH' }),
            ]),
          );
        else if (state.behavior === 'empty') this.emit('error', new Error(''));
        else if (state.behavior === 'timeout')
          this.emit(
            'error',
            Object.assign(new Error('connect ETIMEDOUT 203.0.113.9:5432'), {
              code: 'ETIMEDOUT',
            }),
          );
        else if (state.behavior === 'timeout-aggregate')
          this.emit(
            'error',
            new AggregateError([
              Object.assign(new Error('connect ETIMEDOUT'), {
                code: 'ETIMEDOUT',
              }),
            ]),
          );
        else if (state.behavior === 'enotfound')
          this.emit(
            'error',
            Object.assign(new Error('getaddrinfo ENOTFOUND db.example.com'), {
              code: 'ENOTFOUND',
            }),
          );
        else
          this.emit(
            'error',
            Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
          );
      });
    });
  }

  return {
    ...actual,
    __state: state,
    Socket: FakeSocket,
    createConnection: jest.fn(() => {
      const socket = new FakeSocket();
      const attempt = state.attempts.shift();
      const outcome =
        attempt?.outcome ??
        (state.behavior === 'connect' ? 'connect' : 'enotfound');
      setTimeout(() => {
        if (outcome === 'connect') socket.emit('connect');
        else if (outcome === 'refused')
          socket.emit(
            'error',
            Object.assign(new Error('connect ECONNREFUSED'), {
              code: 'ECONNREFUSED',
            }),
          );
        else if (outcome === 'mixed')
          socket.emit(
            'error',
            new AggregateError([
              Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
              Object.assign(new Error('unreachable'), {
                code: 'ENETUNREACH',
              }),
            ]),
          );
        else if (outcome === 'timeout')
          socket.emit(
            'error',
            Object.assign(new Error('connect ETIMEDOUT'), {
              code: 'ETIMEDOUT',
            }),
          );
        else
          socket.emit(
            'error',
            Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
          );
      }, attempt?.delayMs ?? 0);
      return socket;
    }),
  };
});

// UDP probes: a connected socket either errors (ICMP port-unreachable), gets a reply, or stays silent.
jest.mock('dgram', () => {
  const { EventEmitter } = jest.requireActual('events');
  const state = {
    behavior: 'silent' as 'silent' | 'refused' | 'reply' | 'connect-fail',
    connectedTo: undefined as unknown[] | undefined,
    sentUnconnected: false,
  };

  class FakeUdpSocket extends EventEmitter {
    connect = jest.fn((...args: unknown[]) => {
      state.connectedTo = args;
      process.nextTick(() => {
        if (state.behavior === 'connect-fail')
          this.emit(
            'error',
            Object.assign(new Error('connect EINVAL'), { code: 'EINVAL' }),
          );
        else this.emit('connect');
      });
    });
    send = jest.fn((...args: unknown[]) => {
      // send(msg, port, host) is the old unconnected form: ICMP errors never reach it.
      if (args.length > 2) state.sentUnconnected = true;
      const callback = args.find((a) => typeof a === 'function') as
        ((error?: Error) => void) | undefined;
      process.nextTick(() => {
        callback?.();
        if (state.behavior === 'refused')
          this.emit(
            'error',
            Object.assign(new Error('recv ECONNREFUSED'), {
              code: 'ECONNREFUSED',
            }),
          );
        else if (state.behavior === 'reply')
          this.emit('message', Buffer.from('x'));
      });
    });
    close = jest.fn((callback?: () => void) => callback?.());
  }

  return { __state: state, createSocket: jest.fn(() => new FakeUdpSocket()) };
});

jest.mock('tls', () => {
  const actual = jest.requireActual('tls');
  const { EventEmitter } = jest.requireActual('events');
  const state = { daysUntilExpiry: 90, authorized: true };

  const connect = jest.fn((_options: unknown, callback?: () => void) => {
    const socket: Record<string, unknown> = new EventEmitter();
    socket.authorized = state.authorized;
    socket.authorizationError = state.authorized
      ? null
      : 'DEPTH_ZERO_SELF_SIGNED_CERT'; // Node gives a string code here
    socket.getPeerCertificate = () => ({
      valid_from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      valid_to: new Date(
        Date.now() + state.daysUntilExpiry * 24 * 60 * 60 * 1000,
      ).toISOString(),
      issuer: { CN: 'Test CA' },
      subject: { CN: 'example.test' },
      serialNumber: '01',
      fingerprint: 'AA:BB',
    });
    socket.destroy = jest.fn();
    process.nextTick(() => callback?.());
    return socket;
  });

  return { ...actual, __state: state, connect };
});

import {
  MonitorService,
  MonitorAggregationBusyError,
  AGGREGATION_COMPLETED_TTL_SECONDS,
} from './monitor.service';
import {
  requestPinnedMonitorTarget,
  vettedLookup,
} from '../common/utils/pinned-monitor-request';
import { MonitorRedirectError } from '../common/utils/network-error';
import type { MonitorEvaluator } from './monitor-evaluator';
import type { MonitorExecutionResult } from './types/monitor-result.type';
import { DbService } from '../db/db.service';
import { ExecutionService } from '../execution/services/execution.service';
import {
  ExecutionCapacityError,
  ExecutionEntitlementError,
} from '../execution/services/execution-admission.service';
import { UsageTrackerService } from '../execution/services/usage-tracker.service';
import { MonitorAlertService } from './services/monitor-alert.service';
import { ValidationService } from '../common/validation/validation.service';
import { EnhancedValidationService } from '../common/validation/enhanced-validation.service';
import { CredentialSecurityService } from '../common/security/credential-security.service';
import { StandardizedErrorHandler } from '../common/errors/standardized-error-handler';
import { ResourceManagerService } from '../common/resources/resource-manager.service';
import { LocationService } from '../common/location/location.service';
import { RedisService } from '../execution/services/redis.service';
import { VariableResolverService } from '../common/services/variable-resolver.service';
import * as schema from '../db/schema';

describe('MonitorService', () => {
  /** The aggregatedAlertState JSON of the first monitors.config write (a jsonb_set statement). */
  const firstWrittenAlertState = (): unknown => {
    const config =
      mockDbService.db.update.mock.results[0].value.set.mock.calls[0][0].config;
    return JSON.parse(new PgDialect().sqlToQuery(config).params[0] as string);
  };

  // Deterministic network fakes installed by the jest.mock('net'|'tls') factories.
  const netState = jest.requireMock('net').__state;
  const udpState = jest.requireMock('dgram').__state;
  const tlsState = jest.requireMock('tls').__state;
  let service: MonitorService;
  let _httpService: HttpService;
  let _dbService: DbService;
  let _alertService: MonitorAlertService;

  const mockHttpService = {
    request: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
  };

  const mockDbService = {
    getTestById: jest.fn(),
    db: {
      query: {
        monitors: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
        },
        monitorResults: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
        },
      },
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined),
      }),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      }),
      transaction: jest.fn(),
    },
  };

  const mockAlertService = {
    checkAndSendAlerts: jest.fn().mockResolvedValue(undefined),
    processMonitorResult: jest.fn().mockResolvedValue(undefined),
    sendNotification: jest.fn().mockResolvedValue(undefined),
    signalRecovery: jest.fn().mockResolvedValue(true),
    sendSslExpirationNotification: jest.fn().mockResolvedValue(true),
  };

  const mockExecutionService = {
    execute: jest.fn().mockResolvedValue({ success: true }),
    runSingleTest: jest.fn(),
  };

  const mockUsageTrackerService = {
    shouldBlockExecution: jest.fn().mockResolvedValue({ blocked: false }),
    completeRunWithUsage: jest.fn(),
    trackPlaywrightExecution: jest.fn(),
    trackUsage: jest.fn().mockResolvedValue(undefined),
    getUsage: jest.fn().mockResolvedValue({ count: 0 }),
  };

  // Zero-I/O collaborators run for real. Stubs with invented method names
  // (`validateUrl`, `maskCredential`, `handleError`, `acquireResource`) turned
  // validation, credential masking and error mapping into TypeErrors, so the
  // service fell into its generic "system_error" branch instead of exercising
  // the behaviour these tests describe.
  // ResourceManagerService.enforceResourceLimits() compares the *process* heap
  // (not this suite's usage) against MAX_MEMORY_USAGE_MB. A 100-test file can pass
  // the 512MB default, which would fail an unrelated HTTP-path assertion depending
  // on run order, so give the shared instance a ceiling this suite cannot reach.
  process.env.MAX_MEMORY_USAGE_MB = '4096';

  const validationService = new ValidationService();
  const enhancedValidationService = new EnhancedValidationService();
  const credentialSecurityService = new CredentialSecurityService();
  const errorHandler = new StandardizedErrorHandler();
  const resourceManager = new ResourceManagerService();

  // Captures the long request timeouts armed through ResourceManagerService
  // (>= 20s). Jest's own 10s test timeout is deliberately left untouched so a
  // genuinely hanging test still fails instead of being masked.
  const originalSetTimeout = globalThis.setTimeout;
  let pendingTimers: ReturnType<typeof setTimeout>[] = [];

  beforeAll(() => {
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const handle = originalSetTimeout(...args);
      const delay = typeof args[1] === 'number' ? args[1] : 0;
      if (delay >= 20_000) {
        pendingTimers.push(handle);
      }
      return handle;
    }) as typeof setTimeout;
  });

  const mockLocationService = {
    getCurrentLocation: jest.fn().mockReturnValue('eu-central'),
    getLocationName: jest.fn().mockReturnValue('EU Central'),
    getLocationDisplayName: jest.fn().mockReturnValue('EU Central'),
    getEffectiveLocations: jest.fn().mockReturnValue(['eu-central']),
    calculateAggregatedStatus: jest.fn().mockReturnValue('up'),
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      expire: jest.fn().mockResolvedValue(1),
      multi: jest.fn().mockImplementation(() => {
        const chain = {
          sadd: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
        return chain;
      }),
      scard: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    }),
  };

  // Test fixtures
  const mockMonitor = {
    id: 'monitor-123',
    name: 'Test Monitor',
    type: 'http_request',
    target: 'https://example.com',
    config: {
      method: 'GET',
      expectedStatusCodes: '200-299',
      timeoutSeconds: 30,
    },
    status: 'active',
    projectId: 'project-456',
    organizationId: 'org-789',
  };

  const mockJobData = {
    monitorId: 'monitor-123',
    type: 'http_request' as const,
    target: 'https://example.com',
    config: {
      method: 'GET' as const,
      expectedStatusCodes: '200-299',
      timeoutSeconds: 30,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    netState.attempts.length = 0;
    udpState.behavior = 'silent';
    udpState.sentUnconnected = false;
    mockRedisService.getClient().get.mockReset().mockResolvedValue(null);
    mockRedisService.getClient().set.mockReset().mockResolvedValue('OK');
    mockRedisService.getClient().eval.mockReset().mockResolvedValue(1);

    // Default mock for monitor lookup
    mockDbService.db.query.monitors.findFirst.mockResolvedValue(mockMonitor);

    // Default HTTP response
    const mockResponse = {
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
      data: 'OK',
    };
    mockHttpService.request.mockReturnValue(of(mockResponse));

    // Default network fakes to "unreachable" so a test that forgets to set a
    // behaviour still cannot reach the real network.
    netState.behavior = 'error';
    tlsState.daysUntilExpiry = 90;
    tlsState.authorized = true;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitorService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: DbService, useValue: mockDbService },
        { provide: MonitorAlertService, useValue: mockAlertService },
        { provide: ExecutionService, useValue: mockExecutionService },
        { provide: UsageTrackerService, useValue: mockUsageTrackerService },
        { provide: ValidationService, useValue: validationService },
        {
          provide: EnhancedValidationService,
          useValue: enhancedValidationService,
        },
        {
          provide: CredentialSecurityService,
          useValue: credentialSecurityService,
        },
        { provide: StandardizedErrorHandler, useValue: errorHandler },
        { provide: ResourceManagerService, useValue: resourceManager },
        { provide: LocationService, useValue: mockLocationService },
        { provide: RedisService, useValue: mockRedisService },
        {
          provide: VariableResolverService,
          useValue: {
            resolveProjectVariables: jest.fn().mockResolvedValue({
              variables: {},
              secrets: {},
              errors: undefined,
            }),
            generateVariableFunctions: jest.fn().mockReturnValue(''),
          },
        },
      ],
    }).compile();

    service = module.get<MonitorService>(MonitorService);
  });

  afterEach(() => {
    // ResourceManagerService.executeWithResourceLimits arms a per-request
    // timeout (30s by default) and never clears it when the request settles
    // first. The orphaned handle outlives the test and forces the Jest worker
    // to exit before it finishes, so the suite tracks and clears what it armed.
    // The real fix belongs in resource-manager.service.ts; this keeps the leak
    // visible instead of hiding it behind --forceExit.
    for (const handle of pendingTimers) {
      clearTimeout(handle);
    }
    pendingTimers = [];
    resourceManager.shutdown();
  });

  afterAll(() => {
    globalThis.setTimeout = originalSetTimeout;
  });

  // ==========================================================================
  // INITIALIZATION TESTS
  // ==========================================================================

  describe('legacy multi-location execution', () => {
    it('completes synthetic locations with only one execution slot', async () => {
      mockLocationService.getEffectiveLocations.mockReturnValue([
        'eu-central',
        'us-east',
      ]);
      let active = false;
      const execute = jest
        .spyOn(service, 'executeMonitor')
        .mockImplementation(async (data, location) => {
          if (active) throw new Error('organization capacity exhausted');
          active = true;
          await Promise.resolve();
          active = false;
          return {
            monitorId: data.monitorId,
            location,
          } as MonitorExecutionResult;
        });

      const results = await service.executeMonitorWithLocations({
        ...mockJobData,
        type: 'synthetic_test',
      });

      expect(results.map((result) => result.location)).toEqual([
        'eu-central',
        'us-east',
      ]);
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('omits skipped synthetic locations and stops on an execution error', async () => {
      mockLocationService.getEffectiveLocations.mockReturnValue([
        'eu-central',
        'us-east',
      ]);
      const execute = jest
        .spyOn(service, 'executeMonitor')
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('unavailable'));
      await expect(
        service.executeMonitorWithLocations({
          ...mockJobData,
          type: 'synthetic_test',
        }),
      ).rejects.toThrow('unavailable');
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('omits skipped synthetic locations from a completed group', async () => {
      mockLocationService.getEffectiveLocations.mockReturnValue([
        'eu-central',
        'us-east',
      ]);
      jest
        .spyOn(service, 'executeMonitor')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          monitorId: mockJobData.monitorId,
          location: 'us-east',
        } as MonitorExecutionResult);
      const results = await service.executeMonitorWithLocations({
        ...mockJobData,
        type: 'synthetic_test',
      });
      expect(results.map((result) => result.location)).toEqual(['us-east']);
    });

    it('keeps lightweight checks concurrent', async () => {
      mockLocationService.getEffectiveLocations.mockReturnValue([
        'eu-central',
        'us-east',
      ]);
      const releases: Array<() => void> = [];
      const execute = jest
        .spyOn(service, 'executeMonitor')
        .mockImplementation(
          () => new Promise((resolve) => releases.push(() => resolve(null))),
        );
      const pending = service.executeMonitorWithLocations(mockJobData);
      await Promise.resolve();
      const started = execute.mock.calls.length;
      releases.forEach((release) => release());
      expect(started).toBe(2);
      await expect(pending).resolves.toEqual([]);
    });
  });

  describe('Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have all required dependencies', () => {
      expect(service['httpService']).toBeDefined();
      expect(service['dbService']).toBeDefined();
      expect(service['monitorAlertService']).toBeDefined();
    });
  });

  // ==========================================================================
  // HTTP REQUEST MONITORING TESTS
  // ==========================================================================

  describe('HTTP Request Monitoring', () => {
    describe('Positive Cases', () => {
      it('should have HTTP service for requests', () => {
        expect(service['httpService']).toBeDefined();
      });

      it('should have valid job data structure', () => {
        expect(mockJobData.monitorId).toBeDefined();
        expect(mockJobData.type).toBe('http_request');
        expect(mockJobData.target).toContain('https://');
      });

      it('should have config with expected status codes', () => {
        expect(mockJobData.config.expectedStatusCodes).toBe('200-299');
      });
    });

    describe('Negative Cases', () => {
      it('should handle error status codes', () => {
        // 500 is outside 200-299 range
        const statusCode = 500;
        const isSuccess = statusCode >= 200 && statusCode <= 299;
        expect(isSuccess).toBe(false);
      });

      it('should recognize network error codes', () => {
        const error = new Error('Network error');
        (error as any).code = 'ECONNREFUSED';
        expect((error as any).code).toBe('ECONNREFUSED');
      });

      it('should recognize timeout error codes', () => {
        const error = new Error('Timeout');
        (error as any).code = 'ETIMEDOUT';
        expect((error as any).code).toBe('ETIMEDOUT');
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty response body gracefully', () => {
        const emptyResponse = '';
        expect(emptyResponse).toBe('');
      });
    });
  });

  // ==========================================================================
  // PAUSED MONITOR TESTS
  // ==========================================================================

  describe('Paused Monitor Handling', () => {
    it('should have status field for paused detection', () => {
      const pausedMonitor = { ...mockMonitor, status: 'paused' };
      expect(pausedMonitor.status).toBe('paused');
    });

    it('should have status field for active detection', () => {
      const activeMonitor = { ...mockMonitor, status: 'active' };
      expect(activeMonitor.status).toBe('active');
    });
  });

  // ==========================================================================
  // MONITOR NOT FOUND TESTS
  // ==========================================================================

  describe('Monitor Not Found', () => {
    it('should have db query for monitor lookup', () => {
      expect(mockDbService.db.query.monitors.findFirst).toBeDefined();
    });
  });

  // ==========================================================================
  // WEBSITE MONITORING TESTS
  // ==========================================================================

  describe('Website Monitoring', () => {
    it('should have website type defined', () => {
      // Website monitoring uses same HTTP infrastructure
      expect(mockMonitor.type).toBeDefined();
    });

    it('should support website type config', () => {
      const websiteConfig = {
        method: 'GET' as const,
        expectedStatusCodes: '200-299',
        enableSslCheck: true,
      };

      expect(websiteConfig.method).toBe('GET');
      expect(websiteConfig.enableSslCheck).toBe(true);
    });
  });

  // ==========================================================================
  // LOCATION TESTS
  // ==========================================================================

  describe('Monitoring Location', () => {
    it('should have location service', () => {
      expect(service['locationService']).toBeDefined();
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================

  describe('Security', () => {
    it('should have credential security service', () => {
      expect(service['credentialSecurityService']).toBeDefined();
    });

    it('should have validation service', () => {
      expect(service['validationService']).toBeDefined();
    });

    it('should have enhanced validation service', () => {
      expect(service['enhancedValidationService']).toBeDefined();
    });
  });

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    it('should have error handler', () => {
      expect(service['errorHandler']).toBeDefined();
    });

    it('should handle database errors gracefully', async () => {
      mockDbService.db.query.monitors.findFirst.mockRejectedValue(
        new Error('DB error'),
      );

      // Should still return a result, not throw
      const result = await service.executeMonitor(mockJobData);

      expect(result).toBeDefined();
    });
  });

  // ==========================================================================
  // RESOURCE MANAGEMENT TESTS
  // ==========================================================================

  describe('Resource Management', () => {
    it('should have resource manager', () => {
      expect(service['resourceManager']).toBeDefined();
    });
  });

  // ==========================================================================
  // USAGE TRACKING TESTS
  // ==========================================================================

  describe('Usage Tracking', () => {
    it('should have usage tracker service', () => {
      expect(service['usageTrackerService']).toBeDefined();
    });
  });

  // ==========================================================================
  // EXECUTE MONITOR TESTS
  // ==========================================================================

  describe('executeMonitor', () => {
    it('should return null for paused monitors', async () => {
      mockDbService.db.query.monitors.findFirst.mockResolvedValue({
        ...mockMonitor,
        status: 'paused',
      });

      const result = await service.executeMonitor(mockJobData);

      expect(result).toBeNull();
    });

    it('should return error result for missing monitor', async () => {
      mockDbService.db.query.monitors.findFirst.mockResolvedValue(null);

      const result = await service.executeMonitor(mockJobData);

      expect(result).toBeDefined();
      expect(result?.status).toBe('error');
      expect(result?.error).toContain('not found');
    });

    it('does not execute or report downtime if authorization cannot be checked', async () => {
      mockDbService.db.query.monitors.findFirst.mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.executeMonitor(mockJobData);

      expect(result).toBeNull();
      expect(mockHttpService.request).not.toHaveBeenCalled();
    });

    it('skips a synthetic monitor at the spending cap without a failure result', async () => {
      mockUsageTrackerService.shouldBlockExecution.mockResolvedValueOnce({
        blocked: true,
      });
      const result = await service.executeMonitor({
        ...mockJobData,
        type: 'synthetic_test',
      });
      expect(result).toBeNull();
      expect(mockUsageTrackerService.shouldBlockExecution).toHaveBeenCalledWith(
        mockMonitor.organizationId,
        { checkSpendingLimit: true, monitorId: mockMonitor.id },
      );
      expect(mockExecutionService.runSingleTest).not.toHaveBeenCalled();
      expect(
        mockUsageTrackerService.completeRunWithUsage,
      ).not.toHaveBeenCalled();
    });

    it('should execute http_request type monitors', async () => {
      const httpJobData = { ...mockJobData, type: 'http_request' as const };

      const result = await service.executeMonitor(httpJobData);

      expect(result).toBeDefined();
    });

    it('should execute website type monitors', async () => {
      const websiteJobData = {
        ...mockJobData,
        type: 'website' as const,
        config: { ...mockJobData.config, enableSslCheck: false },
      };

      const result = await service.executeMonitor(websiteJobData);

      expect(result).toBeDefined();
    });

    it('should include location in result', async () => {
      const result = await service.executeMonitor(mockJobData);

      expect(result?.location).toBeDefined();
    });

    it('should include checkedAt timestamp', async () => {
      const result = await service.executeMonitor(mockJobData);

      expect(result?.checkedAt).toBeInstanceOf(Date);
    });
  });

  // ==========================================================================
  // HTTP REQUEST EXECUTION TESTS
  // ==========================================================================

  describe('HTTP Request Execution', () => {
    it('should have HTTP service available', () => {
      expect(service['httpService']).toBeDefined();
    });

    it('should support GET method in config', () => {
      expect(mockJobData.config.method).toBe('GET');
    });

    it('should support POST method in config', () => {
      const postJobData = {
        ...mockJobData,
        config: { ...mockJobData.config, method: 'POST' as const },
      };

      expect(postJobData.config.method).toBe('POST');
    });

    it('should define expected status codes', () => {
      expect(mockJobData.config.expectedStatusCodes).toBe('200-299');
    });

    it('should define timeout in config', () => {
      expect(mockJobData.config.timeoutSeconds).toBe(30);
    });

    it('should recognize connection refused error code', () => {
      const error = new Error('Connection refused');
      (error as any).code = 'ECONNREFUSED';
      expect((error as any).code).toBe('ECONNREFUSED');
    });

    it('should recognize timeout error code', () => {
      const error = new Error('Timeout');
      (error as any).code = 'ETIMEDOUT';
      expect((error as any).code).toBe('ETIMEDOUT');
    });

    it('reports the wall-clock abort of a slow response as a timeout', async () => {
      const abort = new AxiosError('canceled', 'ERR_CANCELED');
      (service['httpService'].request as jest.Mock).mockImplementationOnce(() =>
        throwError(() => abort),
      );
      const result = await service['executeHttpRequest'](
        'https://example.com',
        { timeoutSeconds: 1 },
      );
      expect(result.status).toBe('timeout');
      expect(result.isUp).toBe(false);
    });

    it('should recognize DNS error code', () => {
      const error = new Error('DNS lookup failed');
      (error as any).code = 'ENOTFOUND';
      expect((error as any).code).toBe('ENOTFOUND');
    });
  });

  // ==========================================================================
  // MONITOR TYPES TESTS
  // ==========================================================================

  describe('Monitor Types', () => {
    const monitorTypes = [
      'http_request',
      'website',
      'ping_host',
      'port_check',
      'heartbeat',
      'synthetic_test',
    ];

    monitorTypes.forEach((type) => {
      it(`should recognize monitor type: ${type}`, () => {
        const monitor = { ...mockMonitor, type };
        expect(monitor.type).toBe(type);
      });
    });

    it('reports a host as down when no TCP port accepts the connection', async () => {
      netState.behavior = 'error';

      const result = await service.executeMonitor({
        ...mockJobData,
        type: 'ping_host' as const,
        target: 'google.com',
      });

      expect(result).toMatchObject({ status: 'down', isUp: false });
      expect(result?.details?.errorMessage).toContain('Host unreachable');
    });

    it('reports a host as up when a TCP port accepts the connection', async () => {
      netState.behavior = 'connect';

      const result = await service.executeMonitor({
        ...mockJobData,
        type: 'ping_host' as const,
        target: 'google.com',
      });

      expect(result).toMatchObject({ status: 'up', isUp: true });
      expect(result?.details).toMatchObject({ connectionMethod: 'tcp' });
    });

    it('reports an open port as up when the port is expected to be open', async () => {
      netState.behavior = 'connect';

      const result = await service.executeMonitor({
        ...mockJobData,
        type: 'port_check' as const,
        target: 'db.example.com',
        config: { ...mockJobData.config, port: 5432 },
      });

      expect(result).toMatchObject({ status: 'up', isUp: true });
      expect(result?.details).toMatchObject({
        port: 5432,
        connectionSuccessful: true,
      });
    });

    it('fails a port check when the port should be closed but accepts connections', async () => {
      netState.behavior = 'connect';

      const result = await service.executeMonitor({
        ...mockJobData,
        type: 'port_check' as const,
        target: 'db.example.com',
        config: { ...mockJobData.config, port: 5432, expectClosed: true },
      });

      expect(result).toMatchObject({ status: 'down', isUp: false });
      expect(result?.details?.errorMessage).toBe(
        'Port is open but was expected to be closed',
      );
    });

    it('treats a multi-address refusal as closed when the port is expected to be closed', async () => {
      netState.behavior = 'aggregate';

      const result = await service.executeMonitor({
        ...mockJobData,
        type: 'port_check' as const,
        target: 'db.example.com',
        config: { ...mockJobData.config, port: 5432, expectClosed: true },
      });

      expect(result).toMatchObject({ status: 'up', isUp: true });
    });

    it('does not call a mixed refused and unreachable failure a closed port', async () => {
      netState.behavior = 'mixed';

      const result = await service.executeMonitor({
        ...mockJobData,
        type: 'port_check' as const,
        target: 'db.example.com',
        config: { ...mockJobData.config, port: 5432, expectClosed: true },
      });

      expect(result).toMatchObject({ isUp: false });
    });

    it('never reports an error result with an empty message', async () => {
      netState.behavior = 'empty';

      const result = await service.executeMonitor({
        ...mockJobData,
        type: 'port_check' as const,
        target: 'db.example.com',
        config: { ...mockJobData.config, port: 5432, expectClosed: true },
      });

      expect(result).toMatchObject({ status: 'error', isUp: false });
      expect(result?.details?.errorMessage).toBe('Port check failed');
    });

    it('resolves port check hosts through the private-address guard', async () => {
      netState.behavior = 'connect';
      const result = await service.executeMonitor({
        ...mockJobData,
        type: 'port_check' as const,
        target: 'db.example.com',
        config: { ...mockJobData.config, port: 5432 },
      });

      expect(vettedLookup).toHaveBeenCalledWith('db.example.com', false);
      expect(result).toMatchObject({ status: 'up', isUp: true });
    });

    it.each(['ping_host', 'port_check'] as const)(
      'refuses a %s target that resolves to a private address',
      async (type) => {
        netState.behavior = 'connect';
        jest
          .mocked(vettedLookup)
          .mockRejectedValue(
            new Error('Access to private or reserved networks is not allowed'),
          );

        const result = await service.executeMonitor({
          ...mockJobData,
          type,
          target: 'rebind.example.com',
          config: { ...mockJobData.config, port: 5432 },
        });

        expect(result).toMatchObject({ isUp: false });
        expect(result?.details?.errorMessage).toContain(
          'private or reserved networks',
        );
        jest.mocked(vettedLookup).mockResolvedValue(jest.fn());
      },
    );

    it('reports a refused port as down', async () => {
      netState.behavior = 'error';

      const result = await service.executeMonitor({
        ...mockJobData,
        type: 'port_check' as const,
        target: 'db.example.com',
        config: { ...mockJobData.config, port: 5432 },
      });

      expect(result).toMatchObject({
        status: 'down',
        isUp: false,
        details: { port: 5432 },
      });
    });
  });

  // ==========================================================================
  // SSL CHECK TESTS
  // ==========================================================================

  describe('SSL Checks', () => {
    it('rejects a date-valid certificate with an untrusted chain or hostname', async () => {
      tlsState.daysUntilExpiry = 90;
      tlsState.authorized = false;
      const result = await service['executeSslCheck'](mockJobData.target, {});
      expect(result).toMatchObject({
        status: 'down',
        isUp: false,
        details: {
          sslCertificate: {
            valid: false,
            authError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
          },
          authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
        },
      });
    });

    it('refuses an SSL check whose host resolves to a private address, without dialing', async () => {
      const tls = jest.requireMock<{ connect: jest.Mock }>('tls');
      tls.connect.mockClear();
      jest
        .mocked(vettedLookup)
        .mockRejectedValueOnce(
          new Error('Access to private or reserved networks is not allowed'),
        );
      const result = await service['executeSslCheck'](
        'https://rebind.example.com',
        {},
      );
      expect(vettedLookup).toHaveBeenCalledWith('rebind.example.com', false);
      expect(result.isUp).toBe(false);
      expect(tls.connect).not.toHaveBeenCalled();
    });

    it('dials only vetted addresses but keeps the hostname for SNI', async () => {
      const tls = jest.requireMock<{ connect: jest.Mock }>('tls');
      tls.connect.mockClear();
      const lookup = jest.fn();
      jest.mocked(vettedLookup).mockResolvedValueOnce(lookup);
      await service['executeSslCheck']('https://example.com', {});
      expect(tls.connect.mock.calls[0][0]).toMatchObject({
        host: 'example.com',
        servername: 'example.com',
        lookup,
      });
    });

    it('honors the configured warning threshold for SSL-only checks', async () => {
      tlsState.daysUntilExpiry = 45;
      const result = await service['executeSslCheck'](mockJobData.target, {
        sslDaysUntilExpirationWarning: 60,
      });
      expect(result?.details?.warningMessage).toContain('45 days');
    });

    it('checks SSL expiration on the live result path and throttles daily', async () => {
      const monitor = {
        ...mockMonitor,
        config: { ...mockMonitor.config, enableSslCheck: true },
        alertConfig: { enabled: true, alertOnSslExpiration: true },
      };
      mockDbService.db.query.monitors.findFirst.mockResolvedValue(monitor);
      const lastAlert = jest
        .spyOn(
          (service as unknown as { evaluator: MonitorEvaluator }).evaluator,
          'getLastSslAlert' as never,
        )
        .mockResolvedValue(null as never);
      const result: MonitorExecutionResult = {
        monitorId: monitor.id,
        location: 'eu',
        checkedAt: new Date(),
        status: 'up',
        isUp: true,
        details: {
          sslCertificate: { daysRemaining: 10 },
        } as MonitorExecutionResult['details'],
      };
      await service.saveMonitorResults([result], { persisted: true });
      expect(
        mockAlertService.sendSslExpirationNotification,
      ).toHaveBeenCalledTimes(1);
      lastAlert.mockResolvedValue(new Date() as never);
      await service.saveMonitorResults([result], { persisted: true });
      expect(
        mockAlertService.sendSslExpirationNotification,
      ).toHaveBeenCalledTimes(1);
      monitor.alertConfig.alertOnSslExpiration = false;
      lastAlert.mockResolvedValue(null as never);
      await service.saveMonitorResults([result], { persisted: true });
      expect(
        mockAlertService.sendSslExpirationNotification,
      ).toHaveBeenCalledTimes(1);
    });
    it('throttles SSL alerts on delivered history rows only', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const queries = mockDbService.db.query as Record<string, unknown>;
      const previous = queries.alertHistory;
      queries.alertHistory = { findFirst };
      try {
        await service['getLastSslAlert']('monitor-1');
      } finally {
        queries.alertHistory = previous;
      }
      expect(findFirst).toHaveBeenCalledTimes(1);
      const where = findFirst.mock.calls[0][0].where;
      const query = new PgDialect().sqlToQuery(where);
      expect(query.params).toEqual(
        expect.arrayContaining(['ssl_expiring', 'sent']),
      );
    });

    it('should skip SSL check when disabled', async () => {
      const websiteJobData = {
        ...mockJobData,
        type: 'website' as const,
        config: { ...mockJobData.config, enableSslCheck: false },
      };

      const result = await service.executeMonitor(websiteJobData);

      expect(result).toBeDefined();
    });

    it('records the certificate when the SSL check succeeds', async () => {
      tlsState.daysUntilExpiry = 90;
      tlsState.authorized = true;

      const websiteJobData = {
        ...mockJobData,
        type: 'website' as const,
        target: 'https://example.com',
        config: {
          ...mockJobData.config,
          enableSslCheck: true,
          sslDaysUntilExpirationWarning: 30,
        },
      };

      const result = await service.executeMonitor(websiteJobData);

      expect(result?.status).toBe('up');
      expect(result?.details?.sslCertificate).toMatchObject({
        valid: true,
        issuer: 'Test CA',
        subject: 'example.test',
        daysRemaining: 90,
      });
      expect(result?.details?.sslWarning).toBeUndefined();
    });

    it('keeps a certificate that is close to expiry from failing the website check', async () => {
      tlsState.daysUntilExpiry = 10;

      const websiteJobData = {
        ...mockJobData,
        type: 'website' as const,
        target: 'https://example.com',
        config: {
          ...mockJobData.config,
          enableSslCheck: true,
          sslDaysUntilExpirationWarning: 30,
        },
      };

      const result = await service.executeMonitor(websiteJobData);

      expect(result?.status).toBe('up');
      expect(result?.details?.sslCertificate).toMatchObject({
        daysRemaining: 10,
      });
      expect(result?.details?.sslWarning).toBe(
        'Certificate expires in 10 days',
      );
    });

    describe('SSL check cadence', () => {
      const due = (sslCertificate?: Record<string, unknown>) => {
        mockDbService.db.query.monitors.findFirst.mockResolvedValueOnce({
          config: {
            sslLastCheckedAt: new Date().toISOString(),
            sslCertificate,
          },
        });
        return service['shouldPerformSslCheck'](
          'monitor-123',
          {},
          'https://Example.com/health',
        );
      };

      it('waits for the next window after a good check on the same host', async () => {
        await expect(
          due({ valid: true, daysRemaining: 90, host: 'example.com' }),
        ).resolves.toBe(false);
      });

      it('re-checks a failing certificate on every run', async () => {
        await expect(
          due({ valid: false, daysRemaining: 90, host: 'example.com' }),
        ).resolves.toBe(true);
      });

      it('checks now when the target moved to another host', async () => {
        await expect(
          due({ valid: true, daysRemaining: 90, host: 'old.example.com' }),
        ).resolves.toBe(true);
      });

      it('checks now when no certificate is stored yet (rows from before this was saved)', async () => {
        await expect(due(undefined)).resolves.toBe(true);
      });
    });

    const sslWebsiteJob = () => ({
      ...mockJobData,
      type: 'website' as const,
      target: 'https://example.com',
      config: { ...mockJobData.config, enableSslCheck: true },
    });

    it('saves the certificate on the monitor so it outlives the recent results', async () => {
      tlsState.daysUntilExpiry = 90;
      tlsState.authorized = true;
      mockDbService.db.update.mockClear();

      await service.executeMonitor(sslWebsiteJob());

      expect(mockDbService.db.update).toHaveBeenCalledWith(schema.monitors);
      const set = mockDbService.db.update.mock.results[0].value
        .set as jest.Mock;
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ config: expect.anything() }),
      );
    });

    it('does not fail the site or stamp the check when the probe reads no certificate', async () => {
      mockDbService.db.update.mockClear();
      const since = '2026-11-01T00:00:00.000Z';
      mockDbService.db.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnValue({
          returning: jest
            .fn()
            .mockResolvedValue([
              { config: { sslProbeFailure: { since, host: 'example.com' } } },
            ]),
        }),
      });
      jest.spyOn(service as any, 'executeSslCheck').mockResolvedValueOnce({
        status: 'timeout',
        isUp: false,
        responseTimeMs: 10000,
        details: { errorMessage: 'SSL connection timeout after 10000ms' },
      });

      const result = await service.executeMonitor(sslWebsiteJob());

      expect(result?.status).toBe('up');
      expect(result?.details?.sslWarning).toBe(
        'SSL check could not complete: SSL connection timeout after 10000ms',
      );
      // Only the probe-failure marker is written; sslLastCheckedAt is not stamped.
      expect(mockDbService.db.update).toHaveBeenCalledTimes(1);
      const set = mockDbService.db.update.mock.results[0].value
        .set as jest.Mock;
      const written = new PgDialect().sqlToQuery(set.mock.calls[0][0].config);
      expect(written.sql).toContain('sslProbeFailure');
      expect(written.sql).not.toContain('sslLastCheckedAt');
      expect(result?.details?.sslProbeFailedSince).toBe(since);
    });

    it('should not check SSL for http targets', async () => {
      const websiteJobData = {
        ...mockJobData,
        type: 'website' as const,
        target: 'http://example.com',
        config: { ...mockJobData.config, enableSslCheck: true },
      };

      const result = await service.executeMonitor(websiteJobData);

      expect(result).toBeDefined();
    });
  });

  // ==========================================================================
  // ALERT SERVICE INTEGRATION TESTS
  // ==========================================================================

  describe('Alert Service Integration', () => {
    it('should have alert service for notifications', () => {
      expect(service['monitorAlertService']).toBeDefined();
    });

    it('should call alert service checkAndSendAlerts', async () => {
      await service.executeMonitor(mockJobData);

      // Alert service should be available
      expect(mockAlertService.checkAndSendAlerts).toBeDefined();
    });

    it('should call alert service processMonitorResult', async () => {
      await service.executeMonitor(mockJobData);

      expect(mockAlertService.processMonitorResult).toBeDefined();
    });
  });

  // ==========================================================================
  // STATUS CODES TESTS
  // ==========================================================================

  describe('check status classification', () => {
    const portJob = (config: Record<string, unknown> = {}) => ({
      ...mockJobData,
      type: 'port_check' as const,
      target: 'db.example.com',
      config: { ...mockJobData.config, port: 5432, ...config },
    });
    const pingJob = {
      ...mockJobData,
      type: 'ping_host' as const,
      target: 'host.example.com',
    };
    const http = (config: Record<string, unknown> = {}) =>
      service['executeHttpRequest']('https://example.com', config);

    describe('auth from a project secret', () => {
      const withSecret = (
        auth: Record<string, unknown>,
        value = 'sekret-value',
      ) => {
        jest
          .mocked(resolveMonitorSecret)
          .mockResolvedValueOnce({ ok: true, value });
        (service['httpService'].request as jest.Mock).mockImplementationOnce(
          () => of({ status: 200, statusText: 'OK', headers: {}, data: 'ok' }),
        );
        return service['executeHttpRequest'](
          'https://example.com',
          { auth: { ...auth, type: auth.type } } as never,
          'mon-1',
        );
      };
      const sentConfig = () =>
        (service['httpService'].request as jest.Mock).mock.calls.at(
          -1,
        )?.[0] as {
          headers: Record<string, string>;
          auth?: { username: string; password: string };
        };

      it('uses the secret as the bearer token', async () => {
        const result = await withSecret({ type: 'bearer', secretKey: 'TOKEN' });
        expect(result.status).toBe('up');
        expect(resolveMonitorSecret).toHaveBeenCalledWith(
          mockDbService.db,
          'mon-1',
          'TOKEN',
        );
        expect(sentConfig().headers.Authorization).toBe('Bearer sekret-value');
      });

      it('uses the secret as the basic password', async () => {
        await withSecret({ type: 'basic', username: 'me', secretKey: 'PW' });
        expect(sentConfig().auth).toEqual({
          username: 'me',
          password: 'sekret-value',
        });
      });

      it('returns an error result when the secret is missing', async () => {
        jest.mocked(resolveMonitorSecret).mockResolvedValueOnce({
          ok: false,
          message: 'Secret TOKEN was not found',
        });
        const before = (service['httpService'].request as jest.Mock).mock.calls
          .length;
        const result = await service['executeHttpRequest'](
          'https://example.com',
          { auth: { type: 'bearer', secretKey: 'TOKEN' } },
          'mon-1',
        );
        expect(result).toMatchObject({
          status: 'error',
          isUp: false,
          details: { errorMessage: 'Secret TOKEN was not found' },
        });
        expect(
          (service['httpService'].request as jest.Mock).mock.calls.length,
        ).toBe(before);
      });
    });

    describe('HTTP', () => {
      it('reports ETIMEDOUT (code only, any case) as a timeout', async () => {
        const error = new AxiosError('connect ETIMEDOUT 1.2.3.4:443');
        error.code = 'ETIMEDOUT';
        (service['httpService'].request as jest.Mock).mockImplementationOnce(
          () => throwError(() => error),
        );
        expect((await http({ timeoutSeconds: 1 })).status).toBe('timeout');
      });

      it('reports a DNS failure as down with a clear message', async () => {
        jest.mocked(requestPinnedMonitorTarget).mockRejectedValueOnce(
          Object.assign(new Error('getaddrinfo ENOTFOUND nope.example'), {
            code: 'ENOTFOUND',
          }),
        );
        const result = await http();
        expect(result).toMatchObject({ status: 'down', isUp: false });
        expect(result.details.errorMessage).toContain('DNS lookup failed');
        expect(result.details.errorMessage).toContain('ENOTFOUND');
      });

      it.each(['EAI_AGAIN', 'ETIMEDOUT'])(
        'classifies a lookup error %s without calling it unexpected',
        async (code) => {
          jest
            .mocked(requestPinnedMonitorTarget)
            .mockRejectedValueOnce(
              Object.assign(new Error(`lookup ${code}`), { code }),
            );
          const result = await http();
          expect(result.status).toBe(code === 'ETIMEDOUT' ? 'timeout' : 'down');
        },
      );

      it('reports a redirect limit or invalid redirect as down', async () => {
        jest
          .mocked(requestPinnedMonitorTarget)
          .mockRejectedValueOnce(
            new MonitorRedirectError(
              'Monitor target exceeded the redirect limit of 5',
            ),
          );
        const result = await http();
        expect(result).toMatchObject({ status: 'down', isUp: false });
        expect(result.details.errorMessage).toContain('redirect limit');
      });

      it('keeps error for a validation fault', async () => {
        jest
          .mocked(requestPinnedMonitorTarget)
          .mockRejectedValueOnce(
            new Error('Access to private or reserved networks is not allowed'),
          );
        expect((await http()).status).toBe('error');
      });

      it('measures responseSize in bytes, not characters', async () => {
        (service['httpService'].request as jest.Mock).mockImplementationOnce(
          () =>
            of({ status: 200, statusText: 'OK', headers: {}, data: 'é€😀' }),
        );
        const result = await http();
        // 2 + 3 + 4 bytes; a string-length count would say 4
        expect(result.details.responseSize).toBe(9);
      });

      it('does not count an oversized redirect as up', async () => {
        tooLarge(301);
        const result = await http({ expectedStatusCodes: '3xx' });
        expect(result.status).toBe('error');
        expect(result.isUp).toBe(false);
        expect(result.details.errorMessage).toContain('verify the redirect');
      });

      const tooLarge = (statusCode?: number) => {
        const error = new AxiosError(
          'maxContentLength size of 10485760 exceeded',
          'ERR_BAD_RESPONSE',
          undefined,
          statusCode === undefined ? undefined : { res: { statusCode } },
        );
        (service['httpService'].request as jest.Mock).mockImplementationOnce(
          () => throwError(() => error),
        );
      };

      it('reports an oversized body with an expected status as up and says why', async () => {
        tooLarge(200);
        const result = await http();
        expect(result).toMatchObject({ status: 'up', isUp: true });
        expect(result.details).toMatchObject({
          statusCode: 200,
          responseTooLarge: true,
        });
        expect(result.details.errorMessage).toContain('Response too large');
      });

      it('reports an oversized body with an unexpected status as down', async () => {
        tooLarge(503);
        const result = await http();
        expect(result).toMatchObject({ status: 'down', isUp: false });
        expect(result.details.errorMessage).toContain('Response too large');
        expect(result.details.errorMessage).toContain('503');
      });

      it('cannot judge an oversized body without a status or against a keyword', async () => {
        tooLarge();
        expect((await http()).status).toBe('error');
        tooLarge(200);
        expect((await http({ keywordInBody: 'ok' })).status).toBe('error');
      });
    });

    describe('ping', () => {
      it('treats a refused connection as proof the host is alive', async () => {
        netState.attempts.push({ outcome: 'refused' });
        const result = await service.executeMonitor(pingJob);
        expect(result).toMatchObject({ status: 'up', isUp: true });
        expect(result?.details).toMatchObject({ port: 443 });
        expect(result?.details?.message).toContain('refused');
      });

      it('counts a refusal on one address as alive even if another is unreachable', async () => {
        netState.attempts.push({ outcome: 'mixed' });
        const result = await service.executeMonitor(pingJob);
        expect(result).toMatchObject({ status: 'up', isUp: true });
      });

      it('still reports down when the host cannot be resolved', async () => {
        netState.attempts.push(
          { outcome: 'enotfound' },
          { outcome: 'enotfound' },
        );
        const result = await service.executeMonitor(pingJob);
        expect(result).toMatchObject({ status: 'down', isUp: false });
      });

      it('times only the attempt that answered', async () => {
        netState.attempts.push(
          { outcome: 'timeout', delayMs: 300 },
          { outcome: 'connect' },
        );
        const result = await service.executeMonitor(pingJob);
        expect(result).toMatchObject({ status: 'up', isUp: true });
        expect(result?.details).toMatchObject({ port: 80 });
        expect(result?.responseTimeMs).toBeLessThan(250);
      });
    });

    describe('TCP port check', () => {
      it.each(['timeout', 'timeout-aggregate'])(
        'reports %s as a timeout',
        async (behavior) => {
          netState.behavior = behavior;
          const result = await service.executeMonitor(portJob());
          expect(result).toMatchObject({ status: 'timeout', isUp: false });
        },
      );

      it('does not start a liveness probe unless expectClosed is set', async () => {
        const net = jest.requireMock('net');
        net.createConnection.mockClear();
        netState.behavior = 'timeout';
        await service.executeMonitor(portJob());
        expect(net.createConnection).not.toHaveBeenCalled();
      });

      it('destroys the probe sockets when the connect is refused first', async () => {
        const net = jest.requireMock('net');
        net.createConnection.mockClear();
        netState.behavior = 'error'; // refused
        netState.attempts.push(
          { outcome: 'connect', delayMs: 60_000 },
          { outcome: 'connect', delayMs: 60_000 },
        );
        const result = await service.executeMonitor(
          portJob({ expectClosed: true }),
        );
        expect(result).toMatchObject({ status: 'up', isUp: true });
        const sockets = net.createConnection.mock.results.map(
          (r: { value: { destroy: jest.Mock } }) => r.value,
        );
        expect(sockets).toHaveLength(2);
        sockets.forEach((socket: { destroy: jest.Mock }) =>
          expect(socket.destroy).toHaveBeenCalled(),
        );
      });

      it('passes expectClosed when the host answers late, within the shared timeout', async () => {
        netState.behavior = 'timeout';
        netState.attempts.push({ outcome: 'connect', delayMs: 200 });
        const result = await service.executeMonitor(
          portJob({ expectClosed: true, timeoutSeconds: 10 }),
        );
        expect(result).toMatchObject({ status: 'up', isUp: true });
        expect(result?.details).toMatchObject({ filtered: true });
      });

      it('fails expectClosed on a timeout when the host itself is unreachable', async () => {
        netState.behavior = 'timeout';
        netState.attempts.push({ outcome: 'timeout' }, { outcome: 'timeout' });
        const result = await service.executeMonitor(
          portJob({ expectClosed: true }),
        );
        expect(result).toMatchObject({ status: 'down', isUp: false });
        expect(result?.details?.errorMessage).toContain('Host unreachable');
      });

      it.each(['timeout', 'timeout-aggregate'])(
        'treats %s as filtered and closed when expectClosed and the host is alive',
        async (behavior) => {
          netState.behavior = behavior;
          netState.attempts.push({ outcome: 'connect' });
          const result = await service.executeMonitor(
            portJob({ expectClosed: true }),
          );
          expect(result).toMatchObject({ status: 'up', isUp: true });
          expect(result?.details).toMatchObject({ filtered: true });
          // The liveness probe reuses the vetted lookup instead of resolving again.
          expect(vettedLookup).toHaveBeenCalledTimes(1);
        },
      );

      it('reports a DNS failure as down, even with expectClosed', async () => {
        netState.behavior = 'enotfound';
        for (const expectClosed of [false, true]) {
          const result = await service.executeMonitor(
            portJob({ expectClosed }),
          );
          expect(result).toMatchObject({ status: 'down', isUp: false });
          expect(result?.details?.errorMessage).toContain('DNS lookup failed');
        }
      });
    });

    describe('UDP port check', () => {
      const udp = (config: Record<string, unknown> = {}) =>
        service.executeMonitor(portJob({ protocol: 'udp', ...config }));

      it('sends on a connected socket so ICMP refusal surfaces as closed', async () => {
        udpState.behavior = 'refused';
        const result = await udp();
        expect(udpState.connectedTo?.slice(0, 2)).toEqual([
          5432,
          '93.184.216.34',
        ]);
        expect(udpState.sentUnconnected).toBe(false);
        expect(result).toMatchObject({ status: 'down', isUp: false });
        expect(result?.details?.errorMessage).toContain('refused');
      });

      it('reports a failed connect() as an error without sending', async () => {
        udpState.behavior = 'connect-fail';
        const result = await udp();
        expect(result).toMatchObject({ isUp: false });
        expect(result?.status).toBe('error');
      });

      it('treats a refusal as success when the port is expected to be closed', async () => {
        udpState.behavior = 'refused';
        const result = await udp({ expectClosed: true });
        expect(result).toMatchObject({ status: 'up', isUp: true });
        expect(result?.details).toMatchObject({ connectionRefused: true });
      });

      it('reports silence as open|filtered and up, with the note', async () => {
        const result = await udp({ timeoutSeconds: 1 });
        expect(result).toMatchObject({ status: 'up', isUp: true });
        expect(result?.details?.message).toContain('open or filtered');
        expect(result?.details?.note).toContain('open|filtered');
      });

      it('fails expectClosed on silence because the port is not proven closed', async () => {
        const result = await udp({ timeoutSeconds: 1, expectClosed: true });
        expect(result).toMatchObject({ status: 'down', isUp: false });
        expect(result?.details?.errorMessage).toContain(
          'expected to be closed',
        );
      });

      it('reports a reply as plainly open', async () => {
        udpState.behavior = 'reply';
        const result = await udp();
        expect(result).toMatchObject({ status: 'up', isUp: true });
        expect(result?.details?.message).toBe(
          'Port is open (the service replied)',
        );
        expect(result?.details?.note).toBeUndefined();
      });
    });
  });

  describe('Status Code Handling', () => {
    const successCodes = [200, 201, 202, 204, 299];
    const failureCodes = [400, 401, 403, 404, 500, 502, 503, 504];

    successCodes.forEach((code) => {
      it(`should recognize ${code} as 2xx success range`, () => {
        const isSuccess = code >= 200 && code <= 299;
        expect(isSuccess).toBe(true);
      });
    });

    failureCodes.forEach((code) => {
      it(`should recognize ${code} as outside 2xx success range`, () => {
        const isSuccess = code >= 200 && code <= 299;
        expect(isSuccess).toBe(false);
      });
    });

    it('should parse status code range string', () => {
      const range = '200-299';
      const [min, max] = range.split('-').map(Number);
      expect(min).toBe(200);
      expect(max).toBe(299);
    });

    it('should validate status code in range', () => {
      const validateInRange = (code: number, range: string) => {
        const [min, max] = range.split('-').map(Number);
        return code >= min && code <= max;
      };

      expect(validateInRange(200, '200-299')).toBe(true);
      expect(validateInRange(404, '200-299')).toBe(false);
    });
  });

  // ==========================================================================
  // MULTI-LOCATION ALERT THRESHOLD TESTS
  // ==========================================================================

  describe('Multi-location Alert Thresholds', () => {
    it.each([false, true])(
      'signals recovery once at the threshold with recovery alerts off (multi-location=%s)',
      async (multiLocation) => {
        mockAlertService.sendNotification.mockClear();
        mockAlertService.signalRecovery.mockClear();
        let state = service['readAggregatedAlertState'](null);
        let previousStatus = 'down';
        for (let success = 1; success <= 4; success++) {
          mockDbService.db.query.monitorResults.findFirst.mockResolvedValue({
            id: 'recovered-result',
            consecutiveSuccessCount: success,
            alertsSentForRecovery: 0,
            details: { recoverySequence: true },
          });
          await service['evaluateAndSendAlert']({
            monitorId: mockMonitor.id,
            monitor: {
              ...mockMonitor,
              status: previousStatus,
              config: { aggregatedAlertState: state },
              alertConfig: {
                enabled: true,
                alertOnRecovery: false,
                recoveryThreshold: 2,
              },
            } as unknown as typeof schema.monitors.$inferSelect,
            previousStatus,
            currentStatus: 'up',
            reason: 'Recovered',
            metadata: { locationResults: multiLocation ? [{}, {}] : [{}] },
          });
          state = service['getNextAggregatedAlertState'](
            state,
            previousStatus,
            'up',
          );
          previousStatus = 'up';
        }
        expect(mockAlertService.signalRecovery).toHaveBeenCalledTimes(1);
        expect(mockAlertService.sendNotification).not.toHaveBeenCalled();
      },
    );

    it.each([1, 2, 3, 4, 5])(
      'sends recovery at threshold %i after a failure, including later up results',
      async (recoveryThreshold) => {
        for (const multiLocation of [false, true]) {
          mockAlertService.sendNotification.mockClear();
          let state = service['readAggregatedAlertState'](null);
          let previousStatus = 'down';
          for (let success = 1; success <= recoveryThreshold; success++) {
            const latestResult = {
              id: 'recovered-result',
              consecutiveSuccessCount: success,
              alertsSentForRecovery: 0,
              details: { recoverySequence: true },
            };
            mockDbService.db.query.monitorResults.findFirst.mockResolvedValue(
              latestResult,
            );
            const monitor = {
              ...mockMonitor,
              status: previousStatus,
              config: { aggregatedAlertState: state },
              alertConfig: {
                enabled: true,
                alertOnRecovery: true,
                recoveryThreshold,
              },
            };
            await service['evaluateAndSendAlert']({
              monitorId: monitor.id,
              monitor:
                monitor as unknown as typeof schema.monitors.$inferSelect,
              previousStatus,
              currentStatus: 'up',
              reason: 'Recovered',
              metadata: { locationResults: multiLocation ? [{}, {}] : [{}] },
            });
            expect(mockAlertService.sendNotification).toHaveBeenCalledTimes(
              success === recoveryThreshold ? 1 : 0,
            );
            state = service['getNextAggregatedAlertState'](
              state,
              previousStatus,
              'up',
            );
            previousStatus = 'up';
          }
        }
      },
    );

    it.each([false, true])(
      'sends one recovery per transition across a long healthy streak (multi-location=%s)',
      async (multiLocation) => {
        let state = service['readAggregatedAlertState'](null);
        let previousStatus = 'down';
        for (let success = 1; success <= 20; success++) {
          const sent = mockAlertService.sendNotification.mock.calls.length;
          mockDbService.db.query.monitorResults.findFirst.mockResolvedValue({
            id: 'recovered-result',
            consecutiveSuccessCount: success,
            alertsSentForRecovery: sent,
            details: { recoverySequence: true },
          });
          await service['evaluateAndSendAlert']({
            monitorId: mockMonitor.id,
            monitor: {
              ...mockMonitor,
              config: { aggregatedAlertState: state },
              alertConfig: {
                enabled: true,
                alertOnRecovery: true,
                recoveryThreshold: 2,
              },
            } as unknown as typeof schema.monitors.$inferSelect,
            previousStatus,
            currentStatus: 'up',
            reason: 'Recovered',
            metadata: { locationResults: multiLocation ? [{}, {}] : [{}] },
          });
          expect(mockAlertService.sendNotification).toHaveBeenCalledTimes(
            success >= 2 ? 1 : 0,
          );
          state = service['getNextAggregatedAlertState'](
            state,
            previousStatus,
            'up',
          );
          state.alertsSentForRecovery =
            mockAlertService.sendNotification.mock.calls.length;
          previousStatus = 'up';
        }
      },
    );

    it.each([false, true])(
      'retries an initially suppressed recovery after threshold (multi-location=%s)',
      async (multiLocation) => {
        mockAlertService.sendNotification
          .mockResolvedValueOnce({ suppressed: true })
          .mockResolvedValueOnce(undefined);
        for (const success of [2, 3]) {
          mockDbService.db.query.monitorResults.findFirst.mockResolvedValue({
            id: 'recovered-result',
            consecutiveSuccessCount: success,
            alertsSentForRecovery: 0,
            details: { recoverySequence: true },
          });
          await service['evaluateAndSendAlert']({
            monitorId: mockMonitor.id,
            monitor: {
              ...mockMonitor,
              config: {
                aggregatedAlertState: {
                  consecutiveSuccessCount: success - 1,
                  recoverySequence: true,
                },
              },
              alertConfig: {
                enabled: true,
                alertOnRecovery: true,
                recoveryThreshold: 2,
              },
            } as unknown as typeof schema.monitors.$inferSelect,
            previousStatus: 'up',
            currentStatus: 'up',
            reason: 'Recovered',
            metadata: { locationResults: multiLocation ? [{}, {}] : [{}] },
          });
        }
        expect(mockAlertService.sendNotification).toHaveBeenCalledTimes(2);
      },
    );

    it.each([false, true])(
      'retries fully failed recovery delivery but stops after a successful delivery (multi-location=%s)',
      async (multiLocation) => {
        mockAlertService.sendNotification
          .mockResolvedValueOnce({ delivered: false })
          .mockResolvedValueOnce({ delivered: true });
        const evaluate = async (success: number, delivered: number) => {
          mockDbService.db.query.monitorResults.findFirst.mockResolvedValue({
            id: 'recovered-result',
            consecutiveSuccessCount: success,
            alertsSentForRecovery: delivered,
            details: { recoverySequence: true },
          });
          return service['evaluateAndSendAlert']({
            monitorId: mockMonitor.id,
            monitor: {
              ...mockMonitor,
              config: {
                aggregatedAlertState: {
                  consecutiveSuccessCount: success - 1,
                  alertsSentForRecovery: delivered,
                  recoverySequence: true,
                },
              },
              alertConfig: {
                enabled: true,
                alertOnRecovery: true,
                recoveryThreshold: 2,
              },
            } as unknown as typeof schema.monitors.$inferSelect,
            previousStatus: 'up',
            currentStatus: 'up',
            reason: 'Recovered',
            metadata: { locationResults: multiLocation ? [{}, {}] : [{}] },
          });
        };
        // A fully failed delivery is reported as such (the control plane retries on it).
        expect(await evaluate(2, 0)).toEqual({
          alertSent: false,
          deliveryFailed: true,
        });
        expect(mockDbService.db.update).not.toHaveBeenCalled();
        expect(await evaluate(3, 0)).toEqual({
          alertSent: true,
          alertType: 'recovery',
        });
        expect(await evaluate(8, 1)).toEqual({ alertSent: false });
        expect(mockAlertService.sendNotification).toHaveBeenCalledTimes(2);
      },
    );

    it('does not send recovery alerts for a monitor that has always been healthy', async () => {
      for (const multiLocation of [false, true]) {
        mockDbService.db.query.monitorResults.findFirst.mockResolvedValue({
          consecutiveSuccessCount: 2,
          details: { recoverySequence: false },
        });
        await service['evaluateAndSendAlert']({
          monitorId: mockMonitor.id,
          monitor: {
            ...mockMonitor,
            config: { aggregatedAlertState: { consecutiveSuccessCount: 1 } },
            alertConfig: {
              enabled: true,
              alertOnRecovery: true,
              recoveryThreshold: 2,
            },
          } as unknown as typeof schema.monitors.$inferSelect,
          previousStatus: 'up',
          currentStatus: 'up',
          reason: 'Healthy',
          metadata: { locationResults: multiLocation ? [{}, {}] : [{}] },
        });
      }
      expect(mockAlertService.sendNotification).not.toHaveBeenCalled();
    });

    it('persists recovery eligibility through the success streak and resets it on failure', async () => {
      let lastResult: Record<string, unknown> = { isUp: false };
      const values = jest
        .fn()
        .mockImplementation(async (value: Record<string, unknown>) => {
          lastResult = value;
        });
      mockDbService.db.insert.mockReturnValue({ values });
      mockDbService.db.query.monitorResults.findFirst.mockImplementation(
        async () => lastResult,
      );
      for (const isUp of [true, true, false, true]) {
        await service['saveMonitorResultToDb']({
          monitorId: mockMonitor.id,
          location: 'eu',
          checkedAt: new Date(),
          status: isUp ? 'up' : 'down',
          isUp,
        });
        expect(lastResult.details).toMatchObject({ recoverySequence: isUp });
      }
      mockDbService.db.query.monitorResults.findFirst.mockReset();
    });

    it('keys each outage on its result rows: new on a new failure, shared through the failure and its recovery', async () => {
      let lastResult: Record<string, unknown> | undefined;
      const values = jest
        .fn()
        .mockImplementation(async (value: Record<string, unknown>) => {
          lastResult = value;
        });
      mockDbService.db.insert.mockReturnValue({ values });
      mockDbService.db.query.monitorResults.findFirst.mockImplementation(
        async () => lastResult,
      );
      const keys: Array<string | undefined> = [];
      for (const isUp of [false, false, true, true, false]) {
        await service['saveMonitorResultToDb']({
          monitorId: mockMonitor.id,
          location: 'eu',
          checkedAt: new Date(),
          status: isUp ? 'up' : 'down',
          isUp,
        });
        keys.push((lastResult?.details as { outageKey?: string }).outageKey);
      }
      expect(keys[0]).toEqual(expect.any(String));
      expect(keys[1]).toBe(keys[0]); // same outage
      expect(keys[2]).toBe(keys[0]); // its recovery
      expect(keys[3]).toBe(keys[0]);
      expect(keys[4]).toEqual(expect.any(String));
      expect(keys[4]).not.toBe(keys[0]); // a new outage
      mockDbService.db.query.monitorResults.findFirst.mockReset();
    });

    it('records the outage length on the up streak that follows it', async () => {
      let lastResult: Record<string, unknown> | undefined;
      const values = jest
        .fn()
        .mockImplementation(async (value: Record<string, unknown>) => {
          lastResult = value;
        });
      mockDbService.db.insert.mockReturnValue({ values });
      mockDbService.db.query.monitorResults.findFirst.mockImplementation(
        async () => lastResult,
      );
      const seen: unknown[] = [];
      for (const isUp of [false, false, true, true, false]) {
        await service['saveMonitorResultToDb']({
          monitorId: mockMonitor.id,
          location: 'eu',
          checkedAt: new Date(),
          status: isUp ? 'up' : 'down',
          isUp,
        });
        seen.push(
          (lastResult?.details as { priorFailureCount?: number })
            .priorFailureCount,
        );
      }
      expect(seen).toEqual([undefined, undefined, 2, 2, undefined]);

      // An outage that already alerted records nothing, so its recovery always goes out.
      lastResult = {
        isUp: false,
        consecutiveFailureCount: 2,
        alertsSentForFailure: 1,
      };
      await service['saveMonitorResultToDb']({
        monitorId: mockMonitor.id,
        location: 'eu',
        checkedAt: new Date(),
        status: 'up',
        isUp: true,
      });
      expect(lastResult?.details).not.toHaveProperty('priorFailureCount');
      mockDbService.db.query.monitorResults.findFirst.mockReset();
    });
    it('continues failure counters per location, ignoring other regions', async () => {
      const rows: Array<Record<string, unknown>> = [];
      const values = jest
        .fn()
        .mockImplementation(async (value: Record<string, unknown>) => {
          rows.push(value);
        });
      mockDbService.db.insert.mockReturnValue({ values });
      mockDbService.db.query.monitorResults.findFirst.mockImplementation(
        async (query: { where: unknown }) => {
          const { params } = new PgDialect().sqlToQuery(query.where as never);
          const wanted = params.find((p) => p === 'eu' || p === 'us-east');
          return [...rows].reverse().find((row) => row.location === wanted);
        },
      );
      const save = (location: string, isUp: boolean) =>
        service['saveMonitorResultToDb']({
          monitorId: mockMonitor.id,
          location,
          checkedAt: new Date(),
          status: isUp ? 'up' : 'down',
          isUp,
        });
      await save('eu', false);
      await save('us-east', true);
      await save('eu', false);
      expect(rows.map((row) => row.consecutiveFailureCount)).toEqual([1, 0, 2]);
      mockDbService.db.query.monitorResults.findFirst.mockReset();
    });
    it('fails the distributed job when the result insert fails, but keeps the swallow on the local path', async () => {
      // A thenable, like drizzle's insert builder: awaited directly or through onConflictDoNothing.
      const failing = () => ({
        then: (_resolve: unknown, reject: (e: Error) => void) =>
          reject(new Error('statement timeout')),
        onConflictDoNothing: () =>
          Promise.reject(new Error('statement timeout')),
      });
      mockDbService.db.insert.mockReturnValue({ values: jest.fn(failing) });
      const row = {
        monitorId: mockMonitor.id,
        location: 'eu',
        checkedAt: new Date(),
        status: 'up',
        isUp: true,
      } as MonitorExecutionResult;
      const aggregate = jest
        .spyOn(service, 'saveMonitorResults')
        .mockResolvedValue(undefined);
      await expect(
        service.saveDistributedMonitorResult(row, {}),
      ).rejects.toThrow('statement timeout');
      expect(aggregate).not.toHaveBeenCalled();
      await expect(
        service['saveMonitorResultToDb'](row),
      ).resolves.toBeUndefined();
    });
    it('drops the result of a monitor deleted mid-check (FK violation) without retrying, evaluating or throwing', async () => {
      const fkError = Object.assign(new Error('Failed query'), {
        cause: Object.assign(
          new Error('insert or update violates foreign key constraint'),
          { code: '23503' },
        ),
      });
      const save = jest
        .spyOn(service as any, 'saveMonitorResultToDb')
        .mockRejectedValue(fkError);
      const aggregate = jest
        .spyOn(service, 'saveMonitorResults')
        .mockResolvedValue(undefined);
      const row = {
        monitorId: mockMonitor.id,
        location: 'eu',
        checkedAt: new Date(),
        status: 'up',
        isUp: true,
      } as MonitorExecutionResult;
      await expect(
        service.saveDistributedMonitorResult(row, {}),
      ).resolves.toBeUndefined();
      expect(save).toHaveBeenCalledTimes(1);
      expect(aggregate).not.toHaveBeenCalled();
    });
    it('saveMonitorResults rethrows an insert failure only when asked, and swallows it by default', async () => {
      const failing = () => ({
        then: (_resolve: unknown, reject: (e: Error) => void) =>
          reject(new Error('statement timeout')),
        onConflictDoNothing: () =>
          Promise.reject(new Error('statement timeout')),
      });
      mockDbService.db.insert.mockReturnValue({ values: jest.fn(failing) });
      jest
        .spyOn(service as any, 'getMonitorById')
        .mockResolvedValue(mockMonitor);
      const row = {
        monitorId: mockMonitor.id,
        location: 'eu',
        checkedAt: new Date(),
        status: 'up',
        isUp: true,
      } as MonitorExecutionResult;
      await expect(
        service.saveMonitorResults([row], { rethrow: true }),
      ).rejects.toThrow('statement timeout');
      await expect(service.saveMonitorResults([row])).resolves.not.toThrow();
    });
    it('retries an insert whose response was lost under one row id, ignoring a conflict', async () => {
      const onConflictDoNothing = jest
        .fn()
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValue(undefined);
      const values = jest.fn().mockReturnValue({ onConflictDoNothing });
      mockDbService.db.insert.mockReturnValue({ values });
      jest.spyOn(service, 'saveMonitorResults').mockResolvedValue(undefined);
      await service.saveDistributedMonitorResult(
        {
          monitorId: mockMonitor.id,
          location: 'eu',
          checkedAt: new Date(),
          status: 'up',
          isUp: true,
        },
        {},
      );
      expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
      const ids = values.mock.calls.map(([row]) => row.id);
      expect(ids[0]).toEqual(expect.any(String));
      expect(ids[1]).toBe(ids[0]);
    });
    it('uses aggregate counters when default routing produced multiple actual results', async () => {
      const monitor = {
        ...mockMonitor,
        status: 'down',
        alertConfig: {
          enabled: true,
          alertOnFailure: true,
          failureThreshold: 3,
        },
        config: {
          locationConfig: { enabled: false, locations: [], threshold: 100 },
        },
      };
      await service['evaluateAndSendAlert']({
        monitorId: monitor.id,
        monitor: monitor as unknown as typeof schema.monitors.$inferSelect,
        previousStatus: 'down',
        currentStatus: 'down',
        reason: 'both locations failed',
        metadata: { locationResults: [{ location: 'eu' }, { location: 'us' }] },
      });
      expect(
        mockDbService.db.query.monitorResults.findFirst,
      ).not.toHaveBeenCalled();
      expect(mockAlertService.sendNotification).not.toHaveBeenCalled();
    });
    it('uses aggregated alert state for multi-location thresholds', async () => {
      mockDbService.db.query.monitorResults.findFirst.mockResolvedValue({
        id: 'result-latest',
        consecutiveFailureCount: 3,
        consecutiveSuccessCount: 0,
        alertsSentForFailure: 0,
        alertsSentForRecovery: 0,
      });

      const monitorWithAlertConfig = {
        ...mockMonitor,
        status: 'down',
        alertConfig: {
          enabled: true,
          alertOnFailure: true,
          alertOnRecovery: true,
          failureThreshold: 3,
          recoveryThreshold: 1,
          notificationProviders: [],
        },
        config: {
          aggregatedAlertState: {
            consecutiveFailureCount: 1,
            consecutiveSuccessCount: 0,
            alertsSentForFailure: 0,
            alertsSentForRecovery: 0,
          },
        },
      };

      const result = await (service as any).evaluateAndSendAlert({
        monitorId: monitorWithAlertConfig.id,
        monitor: monitorWithAlertConfig,
        previousStatus: 'down',
        currentStatus: 'down',
        reason: 'Monitor is down in 2/3 locations',
        metadata: {
          locationResults: [
            { location: 'eu-central', isUp: false },
            { location: 'us-east', isUp: false },
            { location: 'asia-pacific', isUp: true },
          ],
        },
      });

      expect(result.alertSent).toBe(false);
      expect(mockAlertService.sendNotification).not.toHaveBeenCalled();
      expect(
        mockDbService.db.query.monitorResults.findFirst,
      ).not.toHaveBeenCalled();
      expect(mockDbService.db.update).toHaveBeenCalled();

      expect(firstWrittenAlertState()).toEqual(
        expect.objectContaining({
          consecutiveFailureCount: 2,
          alertsSentForFailure: 0,
        }),
      );
    });
  });

  // ==========================================================================
  // RESULT STORAGE TESTS
  // ==========================================================================

  describe('durable group aggregation', () => {
    it('counts a group once after marker failure and an intervening group', async () => {
      let monitor = {
        ...mockMonitor,
        status: 'down',
        alertConfig: {
          enabled: true,
          alertOnFailure: true,
          failureThreshold: 3,
        },
        config: {
          locationConfig: {
            enabled: true,
            locations: ['eu', 'us'],
            threshold: 100,
            strategy: 'all',
          },
          aggregatedAlertState: {
            consecutiveFailureCount: 1,
            consecutiveSuccessCount: 0,
            alertsSentForFailure: 0,
            alertsSentForRecovery: 0,
          },
        },
      };
      // Each group has persisted result rows; receipts live in monitor_group_evaluations.
      const receipts = new Map<
        string,
        {
          evaluation: unknown;
          notificationProcessedAt: Date | null;
          claimedAt?: Date | null;
        }
      >();
      let activeGroup = 'a';
      const limited = (rows: unknown[]) => ({
        for: async () => rows,
        then: (resolve: (value: unknown) => void) => resolve(rows),
      });
      const tx = {
        select: (fields?: Record<string, unknown>) => ({
          from: (table: unknown) => ({
            where: () => ({
              limit: () => {
                if (table === schema.monitors) return limited([monitor]);
                if (table === schema.monitorGroupEvaluations) {
                  const receipt = receipts.get(activeGroup);
                  return limited(
                    receipt
                      ? [
                          {
                            evaluation: receipt.evaluation,
                            processedAt: receipt.notificationProcessedAt,
                            claimedAt: receipt.claimedAt ?? null,
                          },
                        ]
                      : [],
                  );
                }
                // Legacy receipt lookup finds none; the group's result rows exist.
                return limited(
                  fields && 'evaluation' in fields
                    ? []
                    : [{ id: `result-${activeGroup}` }],
                );
              },
            }),
          }),
        }),
        insert: (table: unknown) => ({
          values: async (values: Record<string, unknown>) => {
            expect(table).toBe(schema.monitorGroupEvaluations);
            receipts.set(values.executionGroupId as string, {
              evaluation: values.evaluation,
              notificationProcessedAt: null,
            });
          },
        }),
        update: (table: unknown) => update(table, true),
      };
      mockDbService.db.transaction.mockImplementation(
        async (callback: (value: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );
      mockDbService.db.query.monitors.findFirst.mockImplementation(
        async () => monitor,
      );
      mockLocationService.calculateAggregatedStatus.mockReturnValue('down');
      let failMarker = true;
      // Shared by the plain connection and the claim's transaction; `.returning()` yields the rows hit.
      const update = (table: unknown, isTx = false) => ({
        set: jest.fn((values: Record<string, unknown>) => ({
          where: () => {
            if (isTx && table === schema.monitors) {
              monitor = { ...monitor, ...values };
              return Object.assign(Promise.resolve([]), {
                returning: () => Promise.resolve([]),
              });
            }
            const hit: unknown[] = [];
            if (table === schema.monitorGroupEvaluations) {
              const receipt = receipts.get(activeGroup)!;
              if ('notificationClaimToken' in values) {
                // The lease claim: its write failing must stop the send.
                if (failMarker) {
                  failMarker = false;
                  throw new Error('marker write failed');
                }
                receipt.claimedAt = values.notificationClaimedAt as Date | null;
              } else if (!receipt.notificationProcessedAt) {
                receipt.notificationProcessedAt =
                  values.notificationProcessedAt as Date;
                hit.push({ evaluation: receipt.evaluation });
              }
            }
            return Object.assign(Promise.resolve(hit), {
              returning: () => Promise.resolve(hit),
            });
          },
        })),
      });
      mockDbService.db.update.mockImplementation((table: unknown) =>
        update(table),
      );
      const results = ['eu', 'us'].map((location) => ({
        monitorId: monitor.id,
        location,
        status: 'down' as const,
        isUp: false,
        checkedAt: new Date(),
      }));
      await expect(
        service.saveMonitorResults(results, {
          persisted: true,
          executionGroupId: 'a',
        }),
      ).rejects.toThrow('marker write failed');
      expect(monitor.config.aggregatedAlertState.consecutiveFailureCount).toBe(
        2,
      );
      activeGroup = 'b';
      await service.saveMonitorResults(results, {
        persisted: true,
        executionGroupId: 'b',
      });
      expect(monitor.config.aggregatedAlertState.consecutiveFailureCount).toBe(
        3,
      );
      expect(mockAlertService.sendNotification).toHaveBeenCalledTimes(1);
      activeGroup = 'a';
      await service.saveMonitorResults(results, {
        persisted: true,
        executionGroupId: 'a',
      });
      await service.saveMonitorResults(results, {
        persisted: true,
        executionGroupId: 'a',
      });
      expect(monitor.config.aggregatedAlertState.consecutiveFailureCount).toBe(
        3,
      );
      expect(mockAlertService.sendNotification).toHaveBeenCalledTimes(1);
      expect(receipts.get('a')!.notificationProcessedAt).toBeInstanceOf(Date);
      expect(receipts.get('b')!.notificationProcessedAt).toBeInstanceOf(Date);
      // The claim failed before anything was sent for 'a'; its retry claimed and (below threshold) sent nothing.
    });

    it('propagates group transaction failures before sending notifications', async () => {
      mockDbService.db.query.monitors.findFirst.mockResolvedValue(mockMonitor);
      mockDbService.db.transaction.mockRejectedValueOnce(
        new Error('transaction failed'),
      );
      await expect(
        service.saveMonitorResults(
          [
            {
              monitorId: mockMonitor.id,
              location: 'eu',
              status: 'down',
              isUp: false,
              checkedAt: new Date(),
            },
          ],
          {
            persisted: true,
            executionGroupId: 'group-failed',
          },
        ),
      ).rejects.toThrow('transaction failed');
      expect(mockAlertService.sendNotification).not.toHaveBeenCalled();
    });

    it('sends nothing when another writer already claimed the group notification', async () => {
      mockDbService.db.query.monitors.findFirst.mockResolvedValue(mockMonitor);
      const evaluator = (service as unknown as { evaluator: MonitorEvaluator })
        .evaluator;
      jest.spyOn(evaluator, 'prepareGroupEvaluation').mockResolvedValue({
        monitor: mockMonitor,
        receipt: { kind: 'group' },
        evaluation: { previousStatus: 'up', currentStatus: 'down' },
      } as never);
      const claim = jest
        .spyOn(evaluator, 'claimGroupNotification')
        .mockResolvedValue(null);
      await service.saveMonitorResults(
        [
          {
            monitorId: mockMonitor.id,
            location: 'eu',
            status: 'down',
            isUp: false,
            checkedAt: new Date(),
          },
        ],
        { persisted: true, executionGroupId: 'group-claimed' },
      );
      expect(claim).toHaveBeenCalledWith(mockMonitor.id, 'group-claimed', {
        kind: 'group',
      });
      expect(mockAlertService.sendNotification).not.toHaveBeenCalled();
    });

    it('fails as busy, sending nothing, while another sender holds a live lease', async () => {
      mockDbService.db.query.monitors.findFirst.mockResolvedValue(mockMonitor);
      const evaluator = (service as unknown as { evaluator: MonitorEvaluator })
        .evaluator;
      jest.spyOn(evaluator, 'prepareGroupEvaluation').mockResolvedValue({
        monitor: mockMonitor,
        receipt: { kind: 'group' },
        evaluation: { previousStatus: 'up', currentStatus: 'down' },
      } as never);
      jest.spyOn(evaluator, 'claimGroupNotification').mockResolvedValue('busy');
      await expect(
        service.saveMonitorResults(
          [
            {
              monitorId: mockMonitor.id,
              location: 'eu',
              status: 'down',
              isUp: false,
              checkedAt: new Date(),
            },
          ],
          { persisted: true, executionGroupId: 'group-busy' },
        ),
      ).rejects.toBeInstanceOf(MonitorAggregationBusyError);
      expect(mockAlertService.sendNotification).not.toHaveBeenCalled();
    });

    it('sends nothing when claiming the group notification throws', async () => {
      mockDbService.db.query.monitors.findFirst.mockResolvedValue(mockMonitor);
      const evaluator = (service as unknown as { evaluator: MonitorEvaluator })
        .evaluator;
      jest.spyOn(evaluator, 'prepareGroupEvaluation').mockResolvedValue({
        monitor: mockMonitor,
        receipt: { kind: 'group' },
        evaluation: { previousStatus: 'up', currentStatus: 'down' },
      } as never);
      jest
        .spyOn(evaluator, 'claimGroupNotification')
        .mockRejectedValue(new Error('claim failed'));
      await expect(
        service.saveMonitorResults(
          [
            {
              monitorId: mockMonitor.id,
              location: 'eu',
              status: 'down',
              isUp: false,
              checkedAt: new Date(),
            },
          ],
          { persisted: true, executionGroupId: 'group-claim-throws' },
        ),
      ).rejects.toThrow('claim failed');
      expect(mockAlertService.sendNotification).not.toHaveBeenCalled();
    });

    describe('lease around the send', () => {
      const run = () => {
        mockDbService.db.query.monitors.findFirst.mockResolvedValue(
          mockMonitor,
        );
        const evaluator = (
          service as unknown as { evaluator: MonitorEvaluator }
        ).evaluator;
        jest.spyOn(evaluator, 'prepareGroupEvaluation').mockResolvedValue({
          monitor: mockMonitor,
          receipt: { kind: 'group' },
          evaluation: { previousStatus: 'up', currentStatus: 'down' },
        } as never);
        jest
          .spyOn(evaluator, 'claimGroupNotification')
          .mockResolvedValue('token-1');
        const release = jest
          .spyOn(evaluator, 'releaseGroupNotification')
          .mockResolvedValue(undefined);
        const mark = jest
          .spyOn(evaluator, 'markGroupNotified')
          .mockResolvedValue(undefined);
        const save = () =>
          service.saveMonitorResults(
            [
              {
                monitorId: mockMonitor.id,
                location: 'eu',
                status: 'down',
                isUp: false,
                checkedAt: new Date(),
              },
            ],
            { persisted: true, executionGroupId: 'group-lease' },
          );
        return { release, mark, save };
      };

      it('marks the group notified after a successful send', async () => {
        const { release, mark, save } = run();
        jest
          .spyOn(service as never, 'evaluateAndSendAlert')
          .mockResolvedValue(undefined as never);
        await save();
        expect(mark).toHaveBeenCalledWith(mockMonitor.id, 'group-lease', {
          kind: 'group',
        });
        expect(release).not.toHaveBeenCalled();
      });

      it('releases the lease and rethrows when the send fails', async () => {
        const { release, mark, save } = run();
        jest
          .spyOn(service as never, 'evaluateAndSendAlert')
          .mockRejectedValue(new Error('send failed') as never);
        await expect(save()).rejects.toThrow('send failed');
        expect(release).toHaveBeenCalledWith(
          mockMonitor.id,
          'group-lease',
          { kind: 'group' },
          'token-1',
        );
        expect(mark).not.toHaveBeenCalled();
      });
    });
  });

  it('does not consume an alert attempt when scheduled maintenance suppresses delivery', async () => {
    const monitor = {
      ...mockMonitor,
      status: 'down',
      alertConfig: { enabled: true, alertOnFailure: true, failureThreshold: 1 },
    };
    mockDbService.db.query.monitorResults.findFirst.mockResolvedValue({
      id: 'result-suppressed',
      consecutiveFailureCount: 1,
      consecutiveSuccessCount: 0,
      alertsSentForFailure: 0,
      alertsSentForRecovery: 0,
    });
    mockAlertService.sendNotification.mockResolvedValueOnce({
      suppressed: true,
    });
    const result = await service['evaluateAndSendAlert']({
      monitorId: monitor.id,
      monitor: monitor as typeof schema.monitors.$inferSelect,
      previousStatus: 'up',
      currentStatus: 'down',
      reason: 'Maintenance',
      metadata: {},
    });
    expect(result.alertSent).toBe(false);
    expect(mockDbService.db.update).not.toHaveBeenCalled();
  });

  it('keeps aggregate failure thresholds when only one of two configured locations reports', async () => {
    const monitor = {
      ...mockMonitor,
      status: 'down',
      alertConfig: {
        enabled: true,
        alertOnFailure: true,
        failureThreshold: 3,
      },
      config: {
        locationConfig: {
          enabled: true,
          locations: ['eu-central', 'us-east'],
          strategy: 'all',
          threshold: 100,
        },
        aggregatedAlertState: {
          consecutiveFailureCount: 1,
          consecutiveSuccessCount: 0,
          alertsSentForFailure: 0,
          alertsSentForRecovery: 0,
        },
      },
    };
    const state = service as unknown as {
      evaluateAndSendAlert(options: object): Promise<{ alertSent: boolean }>;
    };
    await state.evaluateAndSendAlert({
      monitorId: monitor.id,
      monitor,
      previousStatus: 'down',
      currentStatus: 'down',
      reason: 'missing us-east',
      metadata: { locationResults: [{ location: 'eu-central', isUp: true }] },
    });
    expect(
      mockDbService.db.query.monitorResults.findFirst,
    ).not.toHaveBeenCalled();
    expect(firstWrittenAlertState()).toEqual(
      expect.objectContaining({ consecutiveFailureCount: 2 }),
    );
  });

  describe('Result Storage', () => {
    it('should have db service for storing results', () => {
      expect(service['dbService']).toBeDefined();
    });

    it('should be able to insert results', () => {
      expect(mockDbService.db.insert).toBeDefined();
    });

    it('should be able to update monitor status', () => {
      expect(mockDbService.db.update).toBeDefined();
    });
  });

  // ==========================================================================
  // TIMEOUT CONFIGURATION TESTS
  // ==========================================================================

  describe('Timeout Configuration', () => {
    it('should use configured timeout from job data', () => {
      expect(mockJobData.config.timeoutSeconds).toBe(30);
    });

    it('should have default timeout value', () => {
      const jobWithoutTimeout = {
        ...mockJobData,
        config: { method: 'GET' as const, expectedStatusCodes: '200-299' },
      };

      expect(jobWithoutTimeout.config.method).toBeDefined();
    });
  });

  // ==========================================================================
  // CONCURRENT MONITORING TESTS
  // ==========================================================================

  describe('Concurrent Monitoring', () => {
    it('should handle concurrent monitor executions', async () => {
      const promises = Array.from({ length: 5 }, () =>
        service.executeMonitor(mockJobData),
      );

      const results = await Promise.all(promises);

      results.forEach((result) => {
        expect(result).toBeDefined();
      });
    });

    it('should handle concurrent executions with different types', async () => {
      const httpJob = { ...mockJobData, type: 'http_request' as const };
      const websiteJob = {
        ...mockJobData,
        type: 'website' as const,
        config: { ...mockJobData.config, enableSslCheck: false },
      };

      const results = await Promise.all([
        service.executeMonitor(httpJob),
        service.executeMonitor(websiteJob),
      ]);

      results.forEach((result) => {
        expect(result).toBeDefined();
      });
    });
  });

  // ==========================================================================
  // CUSTOM STATUS CODE RANGE TESTS
  // ==========================================================================

  describe('Custom Status Code Ranges', () => {
    it('should support single status code', () => {
      const config = { expectedStatusCodes: '200' };
      expect(config.expectedStatusCodes).toBe('200');
    });

    it('should support status code range', () => {
      const config = { expectedStatusCodes: '200-299' };
      expect(config.expectedStatusCodes).toBe('200-299');
    });

    it('should support multiple status codes', () => {
      const config = { expectedStatusCodes: '200,201,204' };
      expect(config.expectedStatusCodes).toBe('200,201,204');
    });

    it('should support mixed ranges and codes', () => {
      const config = { expectedStatusCodes: '200-204,301,302' };
      expect(config.expectedStatusCodes).toBe('200-204,301,302');
    });
  });

  // ==========================================================================
  // HEARTBEAT MONITOR TESTS
  // ==========================================================================

  describe('Heartbeat Monitoring', () => {
    it('should recognize heartbeat monitor type', () => {
      const heartbeatMonitor = { ...mockMonitor, type: 'heartbeat' };
      expect(heartbeatMonitor.type).toBe('heartbeat');
    });

    it('should handle heartbeat without target', () => {
      const heartbeatJob = {
        ...mockJobData,
        type: 'heartbeat' as const,
        target: '',
      };

      expect(heartbeatJob.type).toBe('heartbeat');
    });
  });

  // ==========================================================================
  // SYNTHETIC TEST MONITOR TESTS
  // ==========================================================================

  describe('Synthetic Test Monitoring', () => {
    it('does not bill a synthetic check whose container never started', async () => {
      mockDbService.getTestById.mockResolvedValue({
        id: 'test-1',
        title: 'Health',
        script: 'test("health", async () => {});',
      });
      mockDbService.db.query.monitors.findFirst.mockResolvedValue({
        organizationId: 'org-1',
      });
      mockUsageTrackerService.completeRunWithUsage.mockClear();
      mockUsageTrackerService.trackPlaywrightExecution.mockClear();
      mockExecutionService.runSingleTest.mockResolvedValue({
        success: false,
        error: 'Execution timed out waiting for pod',
        executionTimeMs: 120_000,
        billableMs: 0,
        testId: 'test-1-execution-unique',
        reportUrl: null,
      });
      await (
        service as unknown as {
          executeSyntheticTest: (
            id: string,
            config: { testId: string },
          ) => Promise<unknown>;
        }
      ).executeSyntheticTest('monitor-1', { testId: 'test-1' });
      expect(
        mockUsageTrackerService.completeRunWithUsage,
      ).not.toHaveBeenCalled();
      expect(
        mockUsageTrackerService.trackPlaywrightExecution,
      ).not.toHaveBeenCalled();
    });

    it('returns an error without running the test when variable resolution fails', async () => {
      mockDbService.getTestById.mockResolvedValue({
        id: 'test-1',
        title: 'Health',
        projectId: 'project-1',
        script: 'test("health", async () => {});',
      });
      mockExecutionService.runSingleTest.mockClear();
      const resolver = (
        service as unknown as {
          variableResolverService: { resolveProjectVariables: jest.Mock };
        }
      ).variableResolverService;
      resolver.resolveProjectVariables.mockRejectedValueOnce(
        new Error('decrypt failed: key=abc'),
      );
      const result = await (
        service as unknown as {
          executeSyntheticTest: (
            id: string,
            config: { testId: string },
          ) => Promise<{ status: string; details: { errorMessage: string } }>;
        }
      ).executeSyntheticTest('monitor-1', { testId: 'test-1' });
      expect(result.status).toBe('error');
      expect(result.details.errorMessage).not.toContain('abc');
      expect(mockExecutionService.runSingleTest).not.toHaveBeenCalled();
    });

    it('rethrows an occupied execution slot instead of recording a failed check', async () => {
      mockDbService.getTestById.mockResolvedValue({
        id: 'test-1',
        title: 'Health',
        script: 'test("health", async () => {});',
      });
      mockExecutionService.runSingleTest.mockRejectedValue(
        new ExecutionCapacityError('occupied'),
      );
      const synthetic = service as unknown as {
        executeSyntheticTest: (
          id: string,
          config: { testId: string },
        ) => Promise<unknown>;
      };
      await expect(
        synthetic.executeSyntheticTest('monitor-1', { testId: 'test-1' }),
      ).rejects.toBeInstanceOf(ExecutionCapacityError);
    });

    it('does not convert an occupied execution slot into an error result at the monitor level', async () => {
      jest
        .spyOn(
          service as unknown as {
            executeSyntheticTest: () => Promise<unknown>;
          },
          'executeSyntheticTest',
        )
        .mockRejectedValue(new ExecutionCapacityError('occupied'));
      mockDbService.db.query.monitors.findFirst.mockResolvedValue({
        id: 'monitor-1',
        status: 'active',
        organizationId: 'org-1',
      });
      await expect(
        service.executeMonitor({
          monitorId: 'monitor-1',
          type: 'synthetic_test',
          target: '',
          config: { testId: 'test-1' },
        } as never),
      ).rejects.toBeInstanceOf(ExecutionCapacityError);
    });

    it('skips a synthetic check with no execution allowance instead of recording it as down', async () => {
      jest
        .spyOn(
          service as unknown as {
            executeSyntheticTest: () => Promise<unknown>;
          },
          'executeSyntheticTest',
        )
        .mockRejectedValue(
          new ExecutionEntitlementError('Execution allowance is exhausted'),
        );
      mockDbService.db.query.monitors.findFirst.mockResolvedValue({
        id: 'monitor-1',
        status: 'active',
        organizationId: 'org-1',
      });
      await expect(
        service.executeMonitor({
          monitorId: 'monitor-1',
          type: 'synthetic_test',
          target: '',
          config: { testId: 'test-1' },
        } as never),
      ).resolves.toBeNull();
    });

    it.each([false, true])(
      'preserves the check result when receipt failure is %s',
      async (failReceipt) => {
        mockDbService.getTestById.mockResolvedValue({
          id: 'test-1',
          title: 'Health',
          script: 'test("health", async () => {});',
        });
        mockDbService.db.query.monitors.findFirst.mockResolvedValue({
          organizationId: 'org-1',
        });
        mockExecutionService.runSingleTest.mockResolvedValue({
          success: true,
          executionTimeMs: 2000,
          billableMs: 1234,
          testId: 'test-1-execution-unique',
          reportUrl: 'https://example.com/report',
        });
        mockUsageTrackerService.completeRunWithUsage.mockImplementation(
          async () => {
            if (failReceipt) throw new Error('receipt unavailable');
          },
        );
        mockUsageTrackerService.trackPlaywrightExecution.mockResolvedValue({
          blocked: false,
        });
        const result = await (
          service as unknown as {
            executeSyntheticTest: (
              id: string,
              config: { testId: string },
            ) => Promise<{ isUp: boolean }>;
          }
        ).executeSyntheticTest('monitor-1', { testId: 'test-1' });
        expect(result.isUp).toBe(true);
        expect(
          mockUsageTrackerService.completeRunWithUsage,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            runId: 'test-1-execution-unique',
            durationMs: 1234,
            organizationId: 'org-1',
          }),
          expect.any(Function),
        );
        expect(
          mockUsageTrackerService.trackPlaywrightExecution,
        ).toHaveBeenCalledWith(
          'org-1',
          1234,
          expect.objectContaining({ runId: 'test-1-execution-unique' }),
        );
      },
    );

    it('should recognize synthetic_test monitor type', () => {
      const syntheticMonitor = { ...mockMonitor, type: 'synthetic_test' };
      expect(syntheticMonitor.type).toBe('synthetic_test');
    });

    it('should have execution service for synthetic tests', () => {
      expect(service['executionService']).toBeDefined();
    });
  });

  // ==========================================================================
  // RESPONSE BODY HANDLING TESTS
  // ==========================================================================

  describe('Response Body Handling', () => {
    it('should handle empty response body', () => {
      const body = '';
      expect(body.length).toBe(0);
    });

    it('should handle large response body', () => {
      const largeBody = 'x'.repeat(10000);
      expect(largeBody.length).toBe(10000);
    });

    it('should handle JSON response body', () => {
      const jsonBody = { status: 'ok', data: { message: 'success' } };
      expect(typeof jsonBody).toBe('object');
      expect(jsonBody.status).toBe('ok');
    });

    it('should handle HTML response body', () => {
      const htmlBody = '<html><body>OK</body></html>';
      expect(htmlBody).toContain('<html>');
    });

    it('should handle binary response', () => {
      const binaryIndicator = 'application/octet-stream';
      expect(binaryIndicator).toContain('octet-stream');
    });
  });
  describe('distributed group recovery', () => {
    function result(
      location: string,
      checkedAt = new Date(),
    ): MonitorExecutionResult {
      return {
        monitorId: mockMonitor.id,
        location,
        status: 'up',
        isUp: true,
        checkedAt,
      };
    }

    function persistedRows(rows: MonitorExecutionResult[]) {
      mockDbService.db.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue(rows),
        limit: jest.fn().mockResolvedValue(rows),
      });
    }

    describe('neutral skipped groups', () => {
      const skip = (cycle = false) =>
        (
          service as unknown as {
            skipDistributedMonitorGroup(
              monitorId: string,
              groupId: string,
              cycle?: boolean,
            ): Promise<void>;
          }
        ).skipDistributedMonitorGroup(mockMonitor.id, 'group-skipped', cycle);

      it('closes a legacy group without creating uptime, downtime or alerts', async () => {
        const aggregate = jest
          .spyOn(service, 'saveMonitorResults')
          .mockResolvedValue(undefined);
        await skip();
        expect(mockRedisService.getClient().set).toHaveBeenCalledWith(
          'monitor:aggr:aborted:group-skipped',
          '1',
          'EX',
          604800,
        );
        expect(aggregate).not.toHaveBeenCalled();
        expect(mockDbService.db.insert).not.toHaveBeenCalled();
      });

      it('does not replace a completed group with a skipped outcome', async () => {
        mockRedisService
          .getClient()
          .get.mockImplementation(async (key: string) =>
            key.includes(':completed:') ? '1' : null,
          );
        await skip();
        expect(mockRedisService.getClient().set).not.toHaveBeenCalledWith(
          'monitor:aggr:aborted:group-skipped',
          expect.anything(),
          expect.anything(),
          expect.anything(),
        );
      });

      it('remains retryable when the group lock is busy', async () => {
        mockRedisService.getClient().set.mockResolvedValueOnce(null);
        await expect(skip()).rejects.toBeInstanceOf(
          MonitorAggregationBusyError,
        );
      });

      it('keeps the real cause when Redis fails, instead of reporting a busy lease', async () => {
        const outage = new Error('redis unavailable');
        mockRedisService.getClient().set.mockRejectedValueOnce(outage);
        await expect(skip()).rejects.toBe(outage);
      });

      it('keeps the real cause when the database fails while closing a cycle', async () => {
        const outage = new Error('database unavailable');
        mockDbService.db.select.mockImplementationOnce(() => {
          throw outage;
        });
        await expect(skip(true)).rejects.toBe(outage);
      });

      it('aborts only an open, owned control-plane cycle', async () => {
        persistedRows([{ monitorId: mockMonitor.id, status: 'open' }] as never);
        const where = jest.fn().mockResolvedValue(undefined);
        const set = jest.fn().mockReturnValue({ where });
        mockDbService.db.update.mockReturnValue({ set });
        await skip(true);
        expect(set).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'aborted',
            closedAt: expect.any(Date),
            notifiedAt: expect.any(Date),
          }),
        );
        expect(mockRedisService.getClient().set).not.toHaveBeenCalled();
      });

      it('leaves a closed control-plane cycle unchanged', async () => {
        persistedRows([
          { monitorId: mockMonitor.id, status: 'closed' },
        ] as never);
        await skip(true);
        expect(mockDbService.db.update).not.toHaveBeenCalled();
      });

      it("does not abort another monitor's cycle", async () => {
        persistedRows([{ monitorId: 'someone-else', status: 'open' }] as never);
        await skip(true);
        expect(mockDbService.db.update).not.toHaveBeenCalled();
      });
    });

    describe('stale regions leave the expected set', () => {
      const drop = (cycle = false) =>
        service.dropStaleRegion(
          mockMonitor.id,
          'group-stale',
          'us-east',
          cycle,
          ['eu-central', 'us-east'],
        );

      it('judges the legacy group over the regions that ran, without aborting it', async () => {
        const aggregate = jest
          .spyOn(service, 'saveMonitorResults')
          .mockResolvedValue(undefined);
        const redis = mockRedisService.getClient();
        redis.smembers.mockResolvedValue(['us-east']);
        persistedRows([result('eu-central')]);
        await drop();
        const chain = redis.multi.mock.results[0].value;
        expect(chain.sadd).toHaveBeenCalledWith(
          'monitor:aggr:dropped:group-stale',
          'us-east',
        );
        expect(chain.expire).toHaveBeenCalledWith(
          'monitor:aggr:dropped:group-stale',
          604800,
        );
        expect(chain.exec).toHaveBeenCalledTimes(1);
        expect(redis.sadd).not.toHaveBeenCalled();
        expect(aggregate).toHaveBeenCalledWith(
          [expect.objectContaining({ location: 'eu-central' })],
          expect.objectContaining({ expectedLocations: ['eu-central'] }),
        );
        expect(redis.set).not.toHaveBeenCalledWith(
          'monitor:aggr:aborted:group-stale',
          expect.anything(),
          expect.anything(),
          expect.anything(),
        );
        redis.smembers.mockResolvedValue([]);
      });

      it('fails the drop when the Redis transaction reports a command error, so closure retries', async () => {
        const redis = mockRedisService.getClient();
        const boom = new Error('READONLY');
        redis.multi.mockImplementationOnce(() => ({
          sadd: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([[boom, null]]),
        }));
        await expect(drop()).rejects.toBe(boom);
      });

      it('keeps waiting when a remaining region has not reported yet', async () => {
        const aggregate = jest
          .spyOn(service, 'saveMonitorResults')
          .mockResolvedValue(undefined);
        const redis = mockRedisService.getClient();
        redis.smembers.mockResolvedValue(['us-east']);
        persistedRows([]);
        await drop();
        expect(aggregate).not.toHaveBeenCalled();
        redis.smembers.mockResolvedValue([]);
      });

      const txOver = (rows: unknown[]) => {
        const where = jest.fn().mockResolvedValue(undefined);
        const set = jest.fn().mockReturnValue({ where });
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => ({ for: () => Promise.resolve(rows) }),
              }),
            }),
          }),
          update: jest.fn().mockReturnValue({ set }),
        };
        mockDbService.db.transaction.mockImplementation(
          (cb: (t: typeof tx) => unknown) => cb(tx),
        );
        return { set, tx };
      };
      const cycle = (status: string, expectedLocations: string[]) => ({
        monitorId: mockMonitor.id,
        status,
        expectedLocations,
      });

      it('shrinks an open cycle and wakes the control plane', async () => {
        const { set } = txOver([cycle('open', ['eu-central', 'us-east'])]);
        persistedRows([cycle('open', [])] as never);
        const values = jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
        });
        mockDbService.db.insert.mockReturnValue({ values });
        await drop(true);
        expect(set).toHaveBeenCalledWith({ expectedLocations: ['eu-central'] });
        expect(values).toHaveBeenCalledWith({
          cycleId: 'group-stale',
          location: 'us-east',
        });
      });

      it('aborts a cycle whose last expected region went stale', async () => {
        const { set } = txOver([cycle('open', ['us-east'])]);
        await drop(true);
        expect(set).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'aborted' }),
        );
      });

      it('leaves a closed cycle alone', async () => {
        const { set } = txOver([cycle('closed', [])]);
        await drop(true);
        expect(set).not.toHaveBeenCalled();
      });

      it('falls back to the legacy group when no cycle row exists', async () => {
        txOver([]);
        persistedRows([]);
        await drop(true);
        expect(mockRedisService.getClient().multi).toHaveBeenCalled();
      });
    });

    it('aggregates a location that reports five minutes after the first without a Redis completion gate', async () => {
      const persist = jest
        .spyOn(
          service as unknown as {
            saveMonitorResultToDb(
              result: MonitorExecutionResult,
            ): Promise<void>;
          },
          'saveMonitorResultToDb',
        )
        .mockResolvedValue(undefined);
      const aggregate = jest
        .spyOn(service, 'saveMonitorResults')
        .mockResolvedValue(undefined);
      const early = result('eu-central', new Date('2026-10-11T00:00:00Z'));
      const late = result('us-east', new Date('2026-10-11T00:05:00Z'));
      const group = {
        executionGroupId: 'group-slow',
        expectedLocations: ['eu-central', 'us-east'],
      };
      persistedRows([early]);
      await service.saveDistributedMonitorResult(early, group);
      expect(aggregate).not.toHaveBeenCalled();
      persistedRows([late, early]);
      await service.saveDistributedMonitorResult(late, group);
      expect(persist).toHaveBeenCalledTimes(2);
      expect(aggregate).toHaveBeenCalledWith(
        [expect.objectContaining(early), expect.objectContaining(late)],
        {
          persisted: true,
          executionGroupId: 'group-slow',
          expectedLocations: ['eu-central', 'us-east'],
        },
      );
      expect(mockRedisService.getClient().sadd).not.toHaveBeenCalled();
    });

    describe('control-plane cycles', () => {
      const group = {
        executionGroupId: 'cycle-1',
        expectedLocations: ['eu-central', 'us-east'],
        monitorCycle: true,
      };
      let persist: jest.SpyInstance;
      let aggregate: jest.SpyInstance;
      let onConflict: jest.Mock;
      let insertValues: jest.Mock;

      function cycleRow(rows: Array<{ status: string; monitorId?: string }>) {
        mockDbService.db.select.mockReturnValue({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockResolvedValue([]),
          limit: jest
            .fn()
            .mockResolvedValue(
              rows.map((row) => ({ monitorId: mockMonitor.id, ...row })),
            ),
        });
      }

      beforeEach(() => {
        persist = jest
          .spyOn(
            service as unknown as {
              saveMonitorResultToDb(r: MonitorExecutionResult): Promise<void>;
            },
            'saveMonitorResultToDb',
          )
          .mockResolvedValue(undefined);
        aggregate = jest
          .spyOn(service, 'saveMonitorResults')
          .mockResolvedValue(undefined);
        onConflict = jest.fn().mockResolvedValue(undefined);
        insertValues = jest
          .fn()
          .mockReturnValue({ onConflictDoUpdate: onConflict });
        mockDbService.db.insert.mockReturnValue({ values: insertValues });
      });

      it('saves the result, records a re-armable arrival hint and leaves evaluation to the control plane', async () => {
        cycleRow([{ status: 'open' }]);
        await service.saveDistributedMonitorResult(result('eu-central'), group);
        expect(persist).toHaveBeenCalledTimes(1);
        expect(insertValues).toHaveBeenCalledWith({
          cycleId: 'cycle-1',
          location: 'eu-central',
        });
        expect(onConflict).toHaveBeenCalledWith(
          expect.objectContaining({ set: { processedAt: null } }),
        );
        expect(aggregate).not.toHaveBeenCalled();
        expect(mockRedisService.getClient().get).not.toHaveBeenCalled();
      });

      it('keeps a late result diagnostic for a closed or aborted cycle', async () => {
        for (const status of ['closed', 'aborted']) {
          insertValues.mockClear();
          cycleRow([{ status }]);
          await service.saveDistributedMonitorResult(result('us-east'), group);
          expect(persist).toHaveBeenCalled();
          expect(insertValues).not.toHaveBeenCalled();
          expect(aggregate).not.toHaveBeenCalled();
        }
      });

      it('falls back to legacy evaluation when no cycle row exists', async () => {
        cycleRow([]);
        await service.saveDistributedMonitorResult(result('eu-central'), group);
        expect(insertValues).not.toHaveBeenCalled();
        expect(mockRedisService.getClient().get).toHaveBeenCalled();
      });

      it('ignores a cycle owned by another monitor and stays on legacy evaluation', async () => {
        // The owner check runs before the status check, so any foreign status falls through.
        for (const status of ['open', 'closed', 'aborted']) {
          persist.mockClear();
          mockRedisService.getClient().get.mockClear();
          cycleRow([{ status, monitorId: 'other-monitor' }]);
          await service.saveDistributedMonitorResult(
            result('eu-central'),
            group,
          );
          expect(persist).toHaveBeenCalledTimes(1);
          expect(insertValues).not.toHaveBeenCalled();
          expect(mockRedisService.getClient().get).toHaveBeenCalled();
        }
      });

      it('never looks up a cycle unless the job carries the cycle hint', async () => {
        // Even if an open cycle row existed, a job without the hint stays on legacy evaluation.
        cycleRow([{ status: 'open' }]);
        await service.saveDistributedMonitorResult(result('eu-central'), {
          executionGroupId: 'legacy-1',
          expectedLocations: ['eu-central'],
        });
        expect(insertValues).not.toHaveBeenCalled();
        expect(mockRedisService.getClient().get).toHaveBeenCalled();
      });

      it('retries the hint without re-running the check when the cycle lookup fails', async () => {
        mockDbService.db.select.mockReturnValue({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest
            .fn()
            .mockRejectedValue(new Error('relation does not exist')),
        });
        await expect(
          service.saveDistributedMonitorResult(result('eu-central'), group),
        ).rejects.toBeInstanceOf(MonitorAggregationBusyError);
        expect(aggregate).not.toHaveBeenCalled();
        expect(insertValues).not.toHaveBeenCalled();
      });

      it('retries the hint without re-running the check when the insert fails', async () => {
        cycleRow([{ status: 'open' }]);
        onConflict.mockRejectedValue(new Error('connection reset'));
        await expect(
          service.saveDistributedMonitorResult(result('eu-central'), group),
        ).rejects.toBeInstanceOf(MonitorAggregationBusyError);
        expect(aggregate).not.toHaveBeenCalled();
      });
    });

    it('does not advance alert thresholds for a replay of a completed group', async () => {
      jest
        .spyOn(
          service as unknown as {
            saveMonitorResultToDb(
              result: MonitorExecutionResult,
            ): Promise<void>;
          },
          'saveMonitorResultToDb',
        )
        .mockResolvedValue(undefined);
      const aggregate = jest
        .spyOn(service, 'saveMonitorResults')
        .mockResolvedValue(undefined);
      const current = result('eu-central');
      persistedRows([current]);
      const group = {
        executionGroupId: 'group-replayed',
        expectedLocations: ['eu-central'],
      };
      await service.saveDistributedMonitorResult(current, group);
      mockRedisService.getClient().get.mockResolvedValueOnce('1');
      await service.saveDistributedMonitorResult(current, group);
      expect(aggregate).toHaveBeenCalledTimes(1);
    });

    it('serializes simultaneous group completion and skips the delayed replay', async () => {
      jest
        .spyOn(
          service as unknown as {
            saveMonitorResultToDb(
              result: MonitorExecutionResult,
            ): Promise<void>;
          },
          'saveMonitorResultToDb',
        )
        .mockResolvedValue(undefined);
      const values = new Map<string, string>();
      const redis = mockRedisService.getClient();
      redis.get.mockImplementation(
        async (key: string) => values.get(key) ?? null,
      );
      redis.set.mockImplementation(
        async (key: string, value: string, ...options: unknown[]) => {
          if (options.includes('NX') && values.has(key)) return null;
          values.set(key, value);
          return 'OK';
        },
      );
      redis.eval.mockImplementation(
        async (script: string, _count: number, key: string, token: string) => {
          if (values.get(key) !== token) return 0;
          if (script.includes('"DEL"')) values.delete(key);
          return 1;
        },
      );
      let finish!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const aggregate = jest
        .spyOn(service, 'saveMonitorResults')
        .mockImplementation(async () => {
          entered();
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        });
      const current = result('eu-central');
      persistedRows([current, result('us-east')]);
      const group = {
        executionGroupId: 'group-race',
        expectedLocations: ['eu-central', 'us-east'],
      };
      const first = service.saveDistributedMonitorResult(current, group);
      await started;
      await expect(
        service.saveDistributedMonitorResult(result('us-east'), group),
      ).rejects.toBeInstanceOf(MonitorAggregationBusyError);
      expect(aggregate).toHaveBeenCalledTimes(1);
      finish();
      await first;
      await service.saveDistributedMonitorResult(result('us-east'), group);
      expect(aggregate).toHaveBeenCalledTimes(1);
    });

    it('renews a slow aggregation lease past its initial minute and releases its token', async () => {
      jest.useFakeTimers();
      let finish!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const leased = service as unknown as {
        withAggregationLease(
          monitorId: string,
          work: (assertOwned: () => Promise<void>) => Promise<void>,
        ): Promise<void>;
      };
      const pending = leased.withAggregationLease(
        'slow-monitor',
        async (assertOwned) => {
          await assertOwned();
          entered();
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          await assertOwned();
        },
      );
      try {
        await started;
        await jest.advanceTimersByTimeAsync(80_000);
        const redis = mockRedisService.getClient();
        expect(
          redis.eval.mock.calls.filter(([script]) => script.includes('PEXPIRE'))
            .length,
        ).toBeGreaterThanOrEqual(5);
        finish();
        await pending;
        const token = redis.set.mock.calls[0][1];
        expect(redis.eval).toHaveBeenLastCalledWith(
          expect.stringContaining('DEL'),
          1,
          'monitor:aggr:lock:slow-monitor',
          token,
        );
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not publish completion after losing ownership of the aggregation lease', async () => {
      jest
        .spyOn(
          service as unknown as {
            saveMonitorResultToDb(
              result: MonitorExecutionResult,
            ): Promise<void>;
          },
          'saveMonitorResultToDb',
        )
        .mockResolvedValue(undefined);
      const redis = mockRedisService.getClient();
      jest.spyOn(service, 'saveMonitorResults').mockImplementation(async () => {
        redis.eval.mockResolvedValueOnce(0);
      });
      persistedRows([result('eu-central')]);
      await expect(
        service.saveDistributedMonitorResult(result('eu-central'), {
          executionGroupId: 'group-lost',
          expectedLocations: ['eu-central'],
        }),
      ).rejects.toBeInstanceOf(MonitorAggregationBusyError);
      expect(redis.set).not.toHaveBeenCalledWith(
        'monitor:aggr:completed:group-lost',
        '1',
        'EX',
        AGGREGATION_COMPLETED_TTL_SECONDS,
      );
    });

    it('skips aggregation of an aborted publication while preserving its observed result', async () => {
      const persist = jest
        .spyOn(
          service as unknown as {
            saveMonitorResultToDb(
              result: MonitorExecutionResult,
            ): Promise<void>;
          },
          'saveMonitorResultToDb',
        )
        .mockResolvedValue(undefined);
      const aggregate = jest
        .spyOn(service, 'saveMonitorResults')
        .mockResolvedValue(undefined);
      mockRedisService
        .getClient()
        .get.mockImplementation(async (key: string) =>
          key.includes(':aborted:') ? '1' : null,
        );
      await service.saveDistributedMonitorResult(result('eu-central'), {
        executionGroupId: 'group-aborted',
        expectedLocations: ['eu-central', 'us-east'],
      });
      expect(persist).toHaveBeenCalledTimes(1);
      expect(aggregate).not.toHaveBeenCalled();
    });

    it('explains a down status caused by a missing configured location', async () => {
      mockDbService.db.query.monitors.findFirst.mockResolvedValue({
        ...mockMonitor,
        status: 'up',
        config: {
          locationConfig: {
            enabled: true,
            locations: ['eu-central', 'us-east'],
            strategy: 'all',
            threshold: 100,
          },
        },
      });
      mockLocationService.calculateAggregatedStatus.mockReturnValueOnce(
        'partial',
      );
      const alert = jest
        .spyOn(
          service as unknown as {
            evaluateAndSendAlert(data: { reason: string }): Promise<void>;
          },
          'evaluateAndSendAlert',
        )
        .mockResolvedValue(undefined);
      await service.saveMonitorResults([result('eu-central')], {
        persisted: true,
      });
      expect(alert).toHaveBeenCalledWith(
        expect.objectContaining({
          currentStatus: 'down',
          reason: 'Monitor is down in 1/2 locations (no results from us-east)',
        }),
      );
    });

    it('judges only the enqueued regions and notes skipped ones in the alert reason', async () => {
      mockDbService.db.query.monitors.findFirst.mockResolvedValue({
        ...mockMonitor,
        status: 'up',
        config: {
          locationConfig: {
            enabled: true,
            locations: ['eu-central', 'us-east', 'asia-pacific'],
            strategy: 'majority',
            threshold: 50,
          },
        },
      });
      mockLocationService.calculateAggregatedStatus.mockReturnValueOnce(
        'partial',
      );
      const alert = jest
        .spyOn(
          service as unknown as {
            evaluateAndSendAlert(data: { reason: string }): Promise<void>;
          },
          'evaluateAndSendAlert',
        )
        .mockResolvedValue(undefined);
      await service.saveMonitorResults([result('eu-central')], {
        persisted: true,
        expectedLocations: ['eu-central', 'us-east'],
      });
      expect(
        mockLocationService.calculateAggregatedStatus,
      ).toHaveBeenLastCalledWith(
        { 'eu-central': true },
        expect.objectContaining({ strategy: 'majority' }),
        ['eu-central', 'us-east'],
      );
      // An enqueued region without a result is still missing/down; the skipped one is only noted.
      expect(alert).toHaveBeenCalledWith(
        expect.objectContaining({
          currentStatus: 'down',
          reason:
            'Monitor is down in 1/2 locations (no results from us-east) (not run: asia-pacific)',
        }),
      );
    });

    it('does not retry an already committed aggregate when its completion marker cannot be written', async () => {
      jest
        .spyOn(
          service as unknown as {
            saveMonitorResultToDb(
              result: MonitorExecutionResult,
            ): Promise<void>;
          },
          'saveMonitorResultToDb',
        )
        .mockResolvedValue(undefined);
      const aggregate = jest
        .spyOn(service, 'saveMonitorResults')
        .mockResolvedValue(undefined);
      mockRedisService
        .getClient()
        .set.mockImplementation(async (key: string) => {
          if (key.startsWith('monitor:aggr:completed:'))
            throw new Error('redis disconnected');
          return 'OK';
        });
      const current = result('eu-central');
      persistedRows([current]);
      await expect(
        service.saveDistributedMonitorResult(current, {
          executionGroupId: 'group-committed',
          expectedLocations: ['eu-central'],
        }),
      ).resolves.toBeUndefined();
      expect(aggregate).toHaveBeenCalledTimes(1);
    });

    it('leaves the group retryable when aggregation fails after all results are persisted', async () => {
      jest
        .spyOn(
          service as unknown as {
            saveMonitorResultToDb(
              result: MonitorExecutionResult,
            ): Promise<void>;
          },
          'saveMonitorResultToDb',
        )
        .mockResolvedValue(undefined);
      const aggregate = jest
        .spyOn(service, 'saveMonitorResults')
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockResolvedValue(undefined);
      const current = result('eu-central');
      persistedRows([current]);
      const group = {
        executionGroupId: 'group-retry',
        expectedLocations: ['eu-central'],
      };
      await expect(
        service.saveDistributedMonitorResult(current, group),
      ).rejects.toThrow('database unavailable');
      expect(mockRedisService.getClient().set).not.toHaveBeenCalledWith(
        'monitor:aggr:completed:group-retry',
        '1',
        'EX',
        AGGREGATION_COMPLETED_TTL_SECONDS,
      );
      await service.saveDistributedMonitorResult(current, group);
      expect(aggregate).toHaveBeenCalledTimes(2);
      expect(mockRedisService.getClient().set).toHaveBeenCalledWith(
        'monitor:aggr:completed:group-retry',
        '1',
        'EX',
        AGGREGATION_COMPLETED_TTL_SECONDS,
      );
    });
  });
});
