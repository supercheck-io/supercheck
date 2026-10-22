/**
 * Queue alerting is the only thing watching queue health in production. These
 * tests pin the threshold boundaries, alert de-duplication/cooldown, resolution
 * and notification delivery that determine whether an operator is paged once,
 * repeatedly, or not at all.
 *
 * Private members are exercised directly: the thresholds are pure functions of
 * a metrics snapshot, and driving them through a real BullMQ/Redis/interval loop
 * would test the libraries instead.
 */
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QueueAlertingService } from './queue-alerting.service';
import type { QueueMetrics } from './queue-alerting.types';

jest.mock('bullmq', () => ({ Queue: jest.fn() }));

jest.mock('ioredis', () => ({
  Redis: jest.fn(),
}));

jest.mock('../common/utils/retry.util', () => ({
  // Retry semantics live in retry.util.spec.ts; here one attempt keeps the
  // failure-path assertions fast and deterministic.
  executeWithRetry: (operation: () => Promise<unknown>) => operation(),
}));

const QueueMock = Queue as unknown as jest.Mock;
const RedisMock = Redis as unknown as jest.Mock;

type Internals = Record<string, (...args: never[]) => unknown>;

const MINUTE = 60_000;

function metrics(overrides: Partial<QueueMetrics> = {}): QueueMetrics {
  return {
    name: 'playwright-global',
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    paused: 0,
    waitingChildren: 0,
    oldestJobTimestamp: null,
    averageProcessingTime: null,
    failureRate: 0,
    timestamp: new Date(),
    ...overrides,
  };
}

function createConfig(values: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('QueueAlertingService', () => {
  let queueInstances: Map<string, { name: string; close: jest.Mock }>;
  let redisClient: Record<string, jest.Mock>;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  function createService(values: Record<string, string> = {}) {
    return new QueueAlertingService(createConfig(values));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    queueInstances = new Map();
    redisClient = {
      on: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG'),
      scan: jest.fn().mockResolvedValue(['0', []]),
      quit: jest.fn().mockResolvedValue('OK'),
      duplicate: jest.fn().mockReturnValue({}),
    };
    RedisMock.mockImplementation(() => redisClient);
    QueueMock.mockImplementation((name: string) => {
      const instance = {
        name,
        getJobCounts: jest.fn().mockResolvedValue({}),
        isPaused: jest.fn().mockResolvedValue(false),
        getJobs: jest.fn().mockResolvedValue([]),
        close: jest.fn().mockResolvedValue(undefined),
      };
      queueInstances.set(name, instance);
      return instance;
    });
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  describe('configuration', () => {
    it('defaults to the documented thresholds when nothing is configured', () => {
      const service = createService();

      expect(service.getConfig()).toMatchObject({
        enabled: true,
        checkIntervalMs: MINUTE,
        queueDepthWarningThreshold: 70,
        queueDepthCriticalThreshold: 90,
        maxQueueDepth: 10_000,
        waitTimeWarningThresholdMs: 15 * MINUTE,
        waitTimeCriticalThresholdMs: 45 * MINUTE,
        failureRateWarningThreshold: 5,
        failureRateCriticalThreshold: 15,
        alertCooldownMs: 15 * MINUTE,
        alertEmails: [],
      });
    });

    it('reads every override from configuration, including parsed lists and floats', () => {
      const service = createService({
        QUEUE_ALERTING_ENABLED: 'false',
        QUEUE_ALERTING_CHECK_INTERVAL_MS: '5000',
        QUEUE_DEPTH_WARNING_THRESHOLD: '50',
        QUEUE_DEPTH_CRITICAL_THRESHOLD: '80',
        MAX_QUEUE_DEPTH: '200',
        QUEUE_WAIT_TIME_WARNING_MS: '1000',
        QUEUE_WAIT_TIME_CRITICAL_MS: '2000',
        QUEUE_FAILURE_RATE_WARNING: '2.5',
        QUEUE_FAILURE_RATE_CRITICAL: '7.5',
        QUEUE_PROCESSING_TIME_WARNING_MS: '3000',
        QUEUE_PROCESSING_TIME_CRITICAL_MS: '4000',
        QUEUE_FAILURE_RATE_WINDOW_MS: '5000',
        QUEUE_MIN_SAMPLES_FOR_FAILURE_RATE: '3',
        QUEUE_ALERT_COOLDOWN_MS: '6000',
        QUEUE_ALERT_EMAILS: 'oncall@example.test,platform@example.test',
        QUEUE_ALERT_SLACK_WEBHOOK_URL: 'https://hooks.slack.test/queue',
        QUEUE_ALERT_WEBHOOK_URL: 'https://hooks.example.test/queue',
      });

      expect(service.getConfig()).toMatchObject({
        enabled: false,
        checkIntervalMs: 5000,
        queueDepthWarningThreshold: 50,
        queueDepthCriticalThreshold: 80,
        maxQueueDepth: 200,
        failureRateWarningThreshold: 2.5,
        failureRateCriticalThreshold: 7.5,
        minSamplesForFailureRate: 3,
        alertCooldownMs: 6000,
        alertEmails: ['oncall@example.test', 'platform@example.test'],
        slackWebhookUrl: 'https://hooks.slack.test/queue',
        alertWebhookUrl: 'https://hooks.example.test/queue',
      });
    });

    it('warns when unsupported email delivery is configured', async () => {
      const service = createService({
        QUEUE_ALERT_EMAILS: 'oncall@example.test',
      });
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {});
      await service.onModuleInit();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('QUEUE_ALERT_EMAILS is not supported'),
      );
      await service.onModuleDestroy();
    });

    it('does not touch Redis or start a loop when alerting is disabled', async () => {
      const service = createService({ QUEUE_ALERTING_ENABLED: 'false' });

      await service.onModuleInit();

      expect(RedisMock).not.toHaveBeenCalled();
      expect(QueueMock).not.toHaveBeenCalled();
      expect(service['checkInterval']).toBeNull();
    });
  });

  describe('queue discovery', () => {
    beforeEach(() => {
      redisClient.scan
        .mockResolvedValueOnce([
          '42',
          [
            'bull:playwright-global:meta',
            'bull:unrelated-queue:meta',
            'bull:k6-eu-central:meta',
          ],
        ])
        .mockResolvedValueOnce([
          '0',
          ['bull:monitor-us-east:meta', 'not-a-bull-key'],
        ]);
    });

    it('keeps static queues and only dynamic queues with a monitored prefix, across SCAN pages', () => {
      const service = createService();
      service['redisClient'] = redisClient as unknown as Redis;

      const names = service['discoverQueueNames']();

      return expect(names).resolves.toEqual([
        'data-lifecycle-cleanup',
        'email-template-render',
        'job-scheduler',
        'k6-eu-central',
        'k6-global',
        'k6-job-scheduler',
        'monitor-scheduler',
        'monitor-us-east',
        'playwright-global',
      ]);
    });

    it('opens a Queue for each discovered name and closes the ones that disappeared', async () => {
      const service = createService();
      service['redisClient'] = redisClient as unknown as Redis;
      const staleClose = jest.fn().mockResolvedValue(undefined);
      service['queues'].set('removed-queue', {
        close: staleClose,
      } as unknown as Queue);
      service['state'].metricsHistory.set('removed-queue', []);

      await service['syncQueues']();

      expect(staleClose).toHaveBeenCalled();
      expect(service['queues'].has('removed-queue')).toBe(false);
      expect([...service['queues'].keys()]).toContain('playwright-global');
      expect(RedisMock).not.toHaveBeenCalled();
    });
  });

  describe('collectQueueMetrics', () => {
    it('maps BullMQ counts and derives failure rate from recent samples', async () => {
      const service = createService({
        QUEUE_MIN_SAMPLES_FOR_FAILURE_RATE: '1',
        QUEUE_FAILURE_RATE_WINDOW_MS: String(15 * MINUTE),
      });
      const oldest = Date.now() - 5 * MINUTE;
      const queue = {
        getJobCounts: jest.fn().mockResolvedValue({
          waiting: 4,
          active: 2,
          completed: 10,
          failed: 1,
          delayed: 3,
          'waiting-children': 5,
        }),
        isPaused: jest.fn().mockResolvedValue(true),
        getJobs: jest.fn().mockResolvedValue([{ timestamp: oldest }]),
      } as unknown as Queue;

      const first = await service['collectQueueMetrics'](
        'playwright-global',
        queue,
      );
      service['updateMetricsHistory']('playwright-global', first);
      const second = await service['collectQueueMetrics'](
        'playwright-global',
        queue,
      );

      expect(first).toMatchObject({
        name: 'playwright-global',
        waiting: 4,
        active: 2,
        completed: 10,
        failed: 1,
        delayed: 3,
        paused: 1,
        waitingChildren: 5,
        oldestJobTimestamp: oldest,
        failureRate: 0,
      });
      // One prior sample: 1 failure out of 11 processed.
      expect(second.failureRate).toBeCloseTo((1 / 11) * 100, 5);
    });

    it('ignores samples outside the failure-rate window and slow processing trends', async () => {
      const service = createService({
        QUEUE_MIN_SAMPLES_FOR_FAILURE_RATE: '1',
        QUEUE_FAILURE_RATE_WINDOW_MS: String(1 * MINUTE),
      });
      service['state'].metricsHistory.set('q', [
        metrics({
          completed: 5,
          failed: 5,
          timestamp: new Date(Date.now() - 10 * MINUTE),
        }),
      ]);
      const queue = {
        getJobCounts: jest.fn().mockResolvedValue({}),
        isPaused: jest.fn().mockResolvedValue(false),
        getJobs: jest.fn().mockResolvedValue([]),
      } as unknown as Queue;

      const result = await service['collectQueueMetrics']('q', queue);

      expect(result.failureRate).toBe(0);
      expect(result.averageProcessingTime).toBeNull();
    });
  });

  describe('evaluateThresholds', () => {
    const config = {
      MAX_QUEUE_DEPTH: '100',
      QUEUE_MIN_SAMPLES_FOR_FAILURE_RATE: '2',
    };

    it('emits nothing for a healthy queue', () => {
      const service = createService(config);

      expect(
        service['evaluateThresholds'](metrics({ waiting: 1, active: 1 })),
      ).toEqual([]);
    });

    it.each([
      [75, 'warning'],
      [95, 'critical'],
    ])('classifies %i%% queue depth as %s', (depth, severity) => {
      const service = createService(config);

      const alerts = service['evaluateThresholds'](
        metrics({ waiting: depth }),
      ) as Array<{
        alertType: string;
        severity: string;
      }>;

      expect(alerts).toEqual([
        expect.objectContaining({ alertType: 'QUEUE_DEPTH_HIGH', severity }),
      ]);
    });

    it.each([
      [16, 'warning'],
      [46, 'critical'],
    ])('classifies a %i minute wait as %s', (minutes, severity) => {
      const service = createService(config);

      const alerts = service['evaluateThresholds'](
        metrics({ oldestJobTimestamp: Date.now() - minutes * MINUTE }),
      ) as Array<{ alertType: string; severity: string }>;

      expect(alerts).toEqual([
        expect.objectContaining({ alertType: 'WAIT_TIME_HIGH', severity }),
      ]);
    });

    it.each([
      [6, 'warning'],
      [20, 'critical'],
    ])('classifies a %i%% failure rate as %s', (rate, severity) => {
      const service = createService(config);

      const alerts = service['evaluateThresholds'](
        metrics({ failureRate: rate }),
      ) as Array<{
        alertType: string;
        severity: string;
      }>;

      expect(alerts).toEqual([
        expect.objectContaining({ alertType: 'FAILURE_RATE_HIGH', severity }),
      ]);
    });

    it.each([
      [16, 'warning'],
      [31, 'critical'],
    ])(
      'classifies a %i minute average processing time as %s',
      (minutes, severity) => {
        const service = createService(config);

        const alerts = service['evaluateThresholds'](
          metrics({ averageProcessingTime: minutes * MINUTE }),
        ) as Array<{ alertType: string; severity: string }>;

        expect(alerts).toEqual([
          expect.objectContaining({
            alertType: 'PROCESSING_TIME_HIGH',
            severity,
          }),
        ]);
      },
    );

    it('detects a stalled queue from the last five samples', () => {
      const service = createService(config);
      for (let i = 0; i < 2; i += 1) {
        service['updateMetricsHistory'](
          'playwright-global',
          metrics({ active: 3, completed: 10, failed: 1 }),
        );
      }

      const alerts = service['evaluateThresholds'](
        metrics({ active: 3, completed: 10, failed: 1 }),
      ) as Array<{ alertType: string; severity: string }>;

      expect(alerts).toEqual([
        expect.objectContaining({
          alertType: 'QUEUE_STALLED',
          severity: 'critical',
        }),
      ]);
    });

    it('does not call a queue stalled while completed work is still advancing', () => {
      const service = createService(config);
      service['updateMetricsHistory'](
        'playwright-global',
        metrics({ active: 3, completed: 10 }),
      );
      service['updateMetricsHistory'](
        'playwright-global',
        metrics({ active: 3, completed: 12 }),
      );

      expect(
        service['evaluateThresholds'](metrics({ active: 3, completed: 13 })),
      ).toEqual([]);
    });
  });

  describe('processAlerts', () => {
    function alertFor(
      service: QueueAlertingService,
      severity: 'warning' | 'critical' = 'warning',
    ) {
      return {
        id: `alert-${severity}`,
        queueName: 'playwright-global',
        alertType: 'QUEUE_DEPTH_HIGH' as const,
        severity,
        message: 'Queue depth high',
        currentValue: 80,
        threshold: 70,
        timestamp: new Date(),
        resolved: false,
      };
    }

    it('notifies Slack and the generic webhook once for a new alert', async () => {
      const service = createService({
        QUEUE_ALERT_SLACK_WEBHOOK_URL: 'https://hooks.slack.test/queue',
        QUEUE_ALERT_WEBHOOK_URL: 'https://hooks.example.test/queue',
      });

      await service['processAlerts']([alertFor(service)]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [slackUrl, slackInit] = fetchMock.mock.calls[0] as [
        string,
        { body: string },
      ];
      const [webhookUrl, webhookInit] = fetchMock.mock.calls[1] as [
        string,
        { body: string },
      ];
      expect(slackUrl).toBe('https://hooks.slack.test/queue');
      expect(JSON.parse(slackInit.body)).toMatchObject({
        attachments: [
          expect.objectContaining({
            color: '#ffc107',
            title: 'Queue Alert: playwright-global',
            fields: expect.arrayContaining([
              { title: 'Type', value: 'QUEUE_DEPTH_HIGH', short: true },
              { title: 'Severity', value: 'WARNING', short: true },
            ]),
          }),
        ],
      });
      expect(webhookUrl).toBe('https://hooks.example.test/queue');
      expect(JSON.parse(webhookInit.body)).toMatchObject({
        type: 'queue_alert',
        alert: expect.objectContaining({ alertType: 'QUEUE_DEPTH_HIGH' }),
      });
      expect(service.getActiveAlerts()).toHaveLength(1);
    });

    it('does not re-notify while the same severity stays active', async () => {
      const service = createService({
        QUEUE_ALERT_WEBHOOK_URL: 'https://hooks.example.test/queue',
      });

      await service['processAlerts']([alertFor(service)]);
      await service['processAlerts']([alertFor(service)]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(service.getActiveAlerts()).toHaveLength(1);
    });

    it('re-notifies when an active alert escalates', async () => {
      const service = createService({
        QUEUE_ALERT_WEBHOOK_URL: 'https://hooks.example.test/queue',
      });

      await service['processAlerts']([alertFor(service, 'warning')]);
      await service['processAlerts']([alertFor(service, 'critical')]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(service.getActiveAlerts()[0].severity).toBe('critical');
    });

    it('marks an alert resolved when the condition clears', async () => {
      const service = createService({
        QUEUE_ALERT_WEBHOOK_URL: 'https://hooks.example.test/queue',
      });
      await service['processAlerts']([alertFor(service)]);

      await service['processAlerts']([]);

      expect(service.getActiveAlerts()).toHaveLength(0);
      expect(service.getAlertHistory()).toEqual([
        expect.objectContaining({
          resolved: true,
          resolvedAt: expect.any(Date),
        }),
      ]);
    });

    it('suppresses a re-alert that fires inside the cooldown window', async () => {
      const service = createService({
        QUEUE_ALERT_WEBHOOK_URL: 'https://hooks.example.test/queue',
        QUEUE_ALERT_COOLDOWN_MS: String(15 * MINUTE),
      });
      await service['processAlerts']([alertFor(service)]);
      await service['processAlerts']([]);

      await service['processAlerts']([alertFor(service)]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(service.getActiveAlerts()).toHaveLength(0);
    });

    it('alerts again once the cooldown has elapsed', async () => {
      const service = createService({
        QUEUE_ALERT_WEBHOOK_URL: 'https://hooks.example.test/queue',
        QUEUE_ALERT_COOLDOWN_MS: '0',
      });
      await service['processAlerts']([alertFor(service)]);
      await service['processAlerts']([]);

      await service['processAlerts']([alertFor(service)]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(service.getActiveAlerts()).toHaveLength(1);
    });

    it('keeps the alert loop alive when a notification channel fails', async () => {
      fetchMock.mockRejectedValue(new Error('slack is down'));
      const service = createService({
        QUEUE_ALERT_SLACK_WEBHOOK_URL: 'https://hooks.slack.test/queue',
      });

      await expect(
        service['processAlerts']([alertFor(service)]),
      ).resolves.toBeUndefined();
      expect(service.getActiveAlerts()).toHaveLength(1);
    });

    it('trims alert history to the most recent 1000 entries', async () => {
      const service = createService({
        QUEUE_ALERT_WEBHOOK_URL: 'https://hooks.example.test/queue',
      });
      service['state'].alertHistory = Array.from({ length: 1005 }, () => ({
        ...alertFor(service),
        resolved: true,
        resolvedAt: new Date(),
      }));

      await service['processAlerts']([]);

      expect(service.getAlertHistory(2000)).toHaveLength(1000);
    });
  });

  describe('lifecycle', () => {
    it('starts monitoring on init and clears it on destroy', async () => {
      jest.useFakeTimers();
      const service = createService();

      await service.onModuleInit();
      expect(RedisMock).toHaveBeenCalledTimes(1);
      expect(redisClient.ping).toHaveBeenCalled();
      expect(service['checkInterval']).not.toBeNull();

      await service.onModuleDestroy();
      expect(service['checkInterval']).toBeNull();
      expect(redisClient.quit).toHaveBeenCalled();
    });

    it('closes every monitored queue during cleanup', async () => {
      const service = createService();
      await service.onModuleInit();
      const closeCalls = [...queueInstances.values()].map(
        (queue) => queue.close,
      );

      await service.onModuleDestroy();

      for (const close of closeCalls) expect(close).toHaveBeenCalled();
      expect(service['queues'].size).toBe(0);
    });

    it('skips a tick that is already running instead of overlapping health checks', async () => {
      const service = createService();
      service['healthCheckInProgress'] = true;
      service['redisClient'] = redisClient as unknown as Redis;
      const syncSpy = jest.spyOn(service as unknown as Internals, 'syncQueues');

      await service['runHealthCheck']();

      expect(syncSpy).not.toHaveBeenCalled();
      expect(service['healthCheckInProgress']).toBe(true);
    });
  });

  describe('getters', () => {
    it('exposes metrics, active alerts and a defensive config copy', () => {
      const service = createService();
      service['updateMetricsHistory']('q', metrics({ name: 'q' }));

      expect(service.getMetrics().get('q')).toHaveLength(1);
      expect(service.getActiveAlerts()).toEqual([]);

      const config = service.getConfig();
      config.enabled = false;
      expect(service.getConfig().enabled).toBe(true);
    });
  });
});
