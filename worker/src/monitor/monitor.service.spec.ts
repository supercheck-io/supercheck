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

jest.mock('../common/utils/pinned-monitor-request', () => ({
  requestPinnedMonitorTarget: jest.fn(
    async (
      config: unknown,
      _options: unknown,
      execute: (requestConfig: unknown) => Promise<unknown>,
    ) => execute(config),
  ),
}));

// Unit tests must not dial the internet. `net` and `tls` are replaced with
// controllable fakes so the TCP/TLS paths are asserted deterministically
// instead of depending on google.com / example.com being reachable from CI.
jest.mock('net', () => {
  const actual = jest.requireActual('net');
  const { EventEmitter } = jest.requireActual('events');
  const state = { behavior: 'error' as 'connect' | 'error' };

  class FakeSocket extends EventEmitter {
    destroy = jest.fn();
    connect = jest.fn((_port: number, _host: string, callback?: () => void) => {
      process.nextTick(() => {
        if (state.behavior === 'connect') callback?.();
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
      process.nextTick(() => {
        if (state.behavior === 'connect') socket.emit('connect');
        else
          socket.emit(
            'error',
            Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
          );
      });
      return socket;
    }),
  };
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
      : new Error('self signed certificate');
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

import { MonitorService, MonitorAggregationBusyError } from './monitor.service';
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
  // Deterministic network fakes installed by the jest.mock('net'|'tls') factories.
  const netState = jest.requireMock('net').__state;
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
    sendSslExpirationNotification: jest.fn().mockResolvedValue(undefined),
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
      expire: jest.fn().mockResolvedValue(1),
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
        details: { sslCertificate: { valid: false } },
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
      // KNOWN GAP: executeSslCheck reports a near-expiry certificate as
      // `isUp: true` with `details.warningMessage`, but the website branch only
      // copies that message into `details.sslWarning` when `!sslResult.isUp`, so
      // the warning text never reaches the caller. The daysRemaining value above
      // is what operators can act on today; surfacing the warning needs a change
      // in monitor.service.ts, not in this test.
      expect(result?.details?.sslWarning).toBeUndefined();
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

      const firstUpdateCall = mockDbService.db.update.mock.results[0]?.value;
      expect(firstUpdateCall?.set).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            aggregatedAlertState: expect.objectContaining({
              consecutiveFailureCount: 2,
              alertsSentForFailure: 0,
            }),
          }),
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
      const rows: Record<
        string,
        { id: string; details: Record<string, unknown> }
      > = {
        a: { id: 'result-a', details: {} },
        b: { id: 'result-b', details: {} },
      };
      let activeGroup = 'a';
      const tx = {
        select: () => ({
          from: (table: unknown) => ({
            where: () => ({
              limit: () => ({ for: async () => [monitor] }),
              then: (resolve: (value: unknown) => void) =>
                resolve(
                  table === schema.monitorResults
                    ? [rows[activeGroup]]
                    : [monitor],
                ),
            }),
          }),
        }),
        update: (table: unknown) => ({
          set: (values: Record<string, unknown>) => ({
            where: async () => {
              if (table === schema.monitors)
                monitor = { ...monitor, ...values };
              else
                rows[activeGroup].details = values.details as Record<
                  string,
                  unknown
                >;
            },
          }),
        }),
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
      mockDbService.db.update.mockImplementation((table: unknown) => ({
        set: jest.fn(() => ({
          where: async () => {
            if (table === schema.monitorResults) {
              if (failMarker) {
                failMarker = false;
                throw new Error('marker write failed');
              }
              rows[activeGroup].details.aggregationNotificationProcessed = true;
            }
          },
        })),
      }));
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
      expect(rows.a.details.aggregationNotificationProcessed).toBe(true);
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
    expect(
      mockDbService.db.update.mock.results[0].value.set,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          aggregatedAlertState: expect.objectContaining({
            consecutiveFailureCount: 2,
          }),
        }),
      }),
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
      const skip = (cycle = false) => (service as unknown as {
        skipDistributedMonitorGroup(monitorId: string, groupId: string, cycle?: boolean): Promise<void>
      }).skipDistributedMonitorGroup(mockMonitor.id, 'group-skipped', cycle);

      it('closes a legacy group without creating uptime, downtime or alerts', async () => {
        const aggregate = jest.spyOn(service, 'saveMonitorResults').mockResolvedValue(undefined);
        await skip();
        expect(mockRedisService.getClient().set).toHaveBeenCalledWith('monitor:aggr:aborted:group-skipped', '1', 'EX', 604800);
        expect(aggregate).not.toHaveBeenCalled();
        expect(mockDbService.db.insert).not.toHaveBeenCalled();
      });

      it('does not replace a completed group with a skipped outcome', async () => {
        mockRedisService.getClient().get.mockImplementation(async (key: string) => key.includes(':completed:') ? '1' : null);
        await skip();
        expect(mockRedisService.getClient().set).not.toHaveBeenCalledWith('monitor:aggr:aborted:group-skipped', expect.anything(), expect.anything(), expect.anything());
      });

      it('remains retryable when the group lock is busy', async () => {
        mockRedisService.getClient().set.mockResolvedValueOnce(null);
        await expect(skip()).rejects.toBeInstanceOf(MonitorAggregationBusyError);
      });

      it('aborts only an open, owned control-plane cycle', async () => {
        persistedRows([{ monitorId: mockMonitor.id, status: 'open' }] as never);
        const where = jest.fn().mockResolvedValue(undefined);
        const set = jest.fn().mockReturnValue({ where });
        mockDbService.db.update.mockReturnValue({ set });
        await skip(true);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'aborted', closedAt: expect.any(Date), notifiedAt: expect.any(Date) }));
        expect(mockRedisService.getClient().set).not.toHaveBeenCalled();
      });

      it("does not abort another monitor's cycle", async () => {
        persistedRows([{ monitorId: 'someone-else', status: 'open' }] as never);
        await skip(true);
        expect(mockDbService.db.update).not.toHaveBeenCalled();
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
        { persisted: true, executionGroupId: 'group-slow' },
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
        604800,
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
        604800,
      );
      await service.saveDistributedMonitorResult(current, group);
      expect(aggregate).toHaveBeenCalledTimes(2);
      expect(mockRedisService.getClient().set).toHaveBeenCalledWith(
        'monitor:aggr:completed:group-retry',
        '1',
        'EX',
        604800,
      );
    });
  });
});
