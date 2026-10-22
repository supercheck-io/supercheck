import { ExecutionCapacityError } from '../../execution/services/execution-admission.service';
jest.mock('bullmq', () => ({
  DelayedError: jest.requireActual('bullmq').DelayedError,
  UnrecoverableError: jest.requireActual('bullmq').UnrecoverableError,
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('../monitor.service', () => ({
  MonitorService: class {},
  MonitorAggregationBusyError: class extends Error {
    readonly retryAfterMs = 60000;
  },
}));
jest.mock('../../db/db.service', () => ({ DbService: class {} }));
jest.mock('../../common/heartbeat/heartbeat.service', () => ({
  HeartbeatService: class {},
}));

import { EventEmitter } from 'events';
import { ConfigService } from '@nestjs/config';
import { Worker, Job, UnrecoverableError } from 'bullmq';
import { clearLocationCapabilityCache } from '../../common/location/location-capability';
import { resetWorkerQueuesForTests } from '../../common/worker-queues';
import { MonitorJobDataDto } from '../dto/monitor-job.dto';
import { EXECUTE_MONITOR_JOB_NAME } from '../monitor.constants';
import Redis from 'ioredis';
import { MonitorDynamicWorkerService } from './monitor-dynamic-worker.service';
import {
  MonitorService,
  MonitorAggregationBusyError,
} from '../monitor.service';
import { DbService } from '../../db/db.service';
import { HeartbeatService } from '../../common/heartbeat/heartbeat.service';

describe('MonitorDynamicWorkerService lifecycle', () => {
  it('defers a synthetic check while its organization slot is occupied', async () => {
    const { service } = setup();
    const executeMonitor = jest
      .fn()
      .mockRejectedValue(new ExecutionCapacityError('occupied'));
    const saveDistributedMonitorResult = jest.fn();
    Object.assign(service['monitorService'], {
      executeMonitor,
      saveDistributedMonitorResult,
    });
    jest
      .spyOn(service as any, 'assertBrowserCapability')
      .mockResolvedValue(undefined);
    const moveToDelayed = jest.fn().mockResolvedValue(undefined);
    const job = {
      name: EXECUTE_MONITOR_JOB_NAME,
      data: { executionLocation: 'local', type: 'synthetic_test' },
      token: 'token',
      moveToDelayed,
    };
    await expect(service['processJob'](job as never)).rejects.toBeInstanceOf(
      jest.requireActual('bullmq').DelayedError,
    );
    expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
    expect(saveDistributedMonitorResult).not.toHaveBeenCalled();
  });

  function setup(location = 'local') {
    const execute = jest.fn().mockRejectedValue(new Error('DB unavailable'));
    const subscriber = Object.assign(new EventEmitter(), {
      status: 'connecting',
      disconnect: jest.fn(),
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(0),
      quit: jest.fn().mockResolvedValue('OK'),
    });
    const heartbeat = { addQueues: jest.fn(), removeQueues: jest.fn() };
    const connection = {
      duplicate: jest.fn().mockReturnValue(subscriber),
      scan: jest.fn().mockResolvedValue(['0', []]),
      quit: jest.fn().mockResolvedValue('OK'),
    };
    const service = new MonitorDynamicWorkerService(
      {} as MonitorService,
      new ConfigService({ WORKER_LOCATION: location }),
      heartbeat as unknown as HeartbeatService,
      { db: { execute } } as unknown as DbService,
    );
    service['connection'] = connection as unknown as Redis;
    service['createRedisConnection'] = jest.fn().mockReturnValue(connection);
    return { service, connection, heartbeat, execute, subscriber };
  }

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  it('shares the owned command connection and closes it after workers drain', async () => {
    const { service, connection } = setup();
    await service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: ['eu', 'us'] }),
    );
    expect(Worker).toHaveBeenCalledTimes(2);
    for (const call of (Worker as unknown as jest.Mock).mock.calls) {
      expect(call[2].connection).toBe(connection);
    }
    expect(connection.duplicate).not.toHaveBeenCalled();
    const workers = Array.from(service['workers'].values());
    await service.onModuleDestroy();
    for (const worker of workers) {
      expect(worker.close).toHaveBeenCalledTimes(1);
      expect(
        (worker.close as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(connection.quit.mock.invocationCallOrder[0]);
    }
    expect(connection.quit).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'starts only its enabled region (enabled=%s)',
    async (enabled) => {
      const { service, heartbeat, execute, subscriber } = setup('eu-central');
      execute.mockResolvedValue(
        enabled
          ? [{ code: 'eu-central' }, { code: 'us-east' }]
          : [{ code: 'us-east' }],
      );
      await service.onModuleInit();
      expect([...service['activeQueueNames']]).toEqual(
        enabled ? ['monitor-eu-central'] : [],
      );
      subscriber.emit('ready');
      await Promise.resolve();
      await service['refreshPromise'];
      expect(subscriber.subscribe).toHaveBeenCalledWith(
        'supercheck:queue-refresh',
      );
      execute.mockResolvedValue(enabled ? [] : [{ code: 'eu-central' }]);
      subscriber.emit(
        'message',
        'supercheck:queue-refresh',
        JSON.stringify({
          locationCodes: enabled ? [] : ['eu-central', 'us-east'],
        }),
      );
      await service['refreshPromise'];
      expect([...service['activeQueueNames']]).toEqual(
        enabled ? [] : ['monitor-eu-central'],
      );
      expect(heartbeat.addQueues).toHaveBeenCalledWith(['monitor-eu-central']);
      await service.onModuleDestroy();
    },
  );

  it.each([true, false])(
    'recovers a regional startup DB outage (eventually enabled=%s)',
    async (enabled) => {
      jest.useFakeTimers();
      const { service, execute } = setup('eu-central');
      execute.mockRejectedValue(new Error('DB unavailable'));
      await service.onModuleInit();
      expect([...service['activeQueueNames']]).toEqual(['monitor-eu-central']);
      // A prolonged outage must not exhaust recovery retries.
      for (const delay of [30_000, 60_000, 120_000, 240_000]) {
        await jest.advanceTimersByTimeAsync(delay);
      }
      execute.mockResolvedValue(enabled ? [{ code: 'eu-central' }] : []);
      await jest.advanceTimersByTimeAsync(300_000);
      expect([...service['activeQueueNames']]).toEqual(
        enabled ? ['monitor-eu-central'] : [],
      );
      expect(execute).toHaveBeenCalledTimes(6);
      await service.onModuleDestroy();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('keeps an authoritative disabled set during a later DB outage', async () => {
    const { service, execute } = setup('eu-central');
    execute.mockResolvedValue([]);
    await service.onModuleInit();
    execute.mockRejectedValue(new Error('DB unavailable'));
    await service['handleQueueRefresh']();
    expect(service['workers'].size).toBe(0);
    expect(Worker).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('preserves all active local queues when DB refresh fails', async () => {
    const { service, execute } = setup();
    await service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: ['eu', 'us'] }),
    );
    execute.mockRejectedValue(new Error('DB unavailable'));
    await service['handleQueueRefresh']();
    expect([...service['activeQueueNames']]).toEqual([
      'monitor-eu',
      'monitor-us',
    ]);
    expect(Worker).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
  });

  it('uses the enabled DB set for local startup and ignores stale Redis queues', async () => {
    const { service, connection, execute } = setup();
    execute.mockResolvedValue([{ code: 'eu' }, { code: 'us' }]);
    connection.scan.mockResolvedValue(['0', ['bull:monitor-disabled:meta']]);
    await service.onModuleInit();
    expect([...service['activeQueueNames']]).toEqual([
      'monitor-eu',
      'monitor-us',
    ]);
    execute.mockResolvedValue([]);
    await service['handleQueueRefresh']();
    expect(service['workers'].size).toBe(0);
    expect(connection.scan).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it.each([true, false])(
    'recovers local startup fallback when DB returns (Redis queues=%s)',
    async (hasRedisQueues) => {
      jest.useFakeTimers();
      const { service, connection, execute } = setup();
      execute.mockRejectedValue(new Error('DB unavailable'));
      connection.scan.mockResolvedValue([
        '0',
        hasRedisQueues
          ? ['bull:monitor-eu:meta', 'bull:monitor-scheduler:meta']
          : [],
      ]);
      await service.onModuleInit();
      expect([...service['activeQueueNames']]).toEqual([
        hasRedisQueues ? 'monitor-eu' : 'monitor-local',
      ]);
      execute.mockResolvedValue([{ code: 'us' }]);
      await jest.advanceTimersByTimeAsync(30_000);
      expect([...service['activeQueueNames']]).toEqual(['monitor-us']);
      await service.onModuleDestroy();
    },
  );

  it('reconciles a missed refresh only after reconnect subscription is acknowledged', async () => {
    const { service, subscriber, execute } = setup('eu-central');
    execute.mockResolvedValue([{ code: 'eu-central' }]);
    await service.onModuleInit();
    execute.mockResolvedValue([]);
    let acknowledge!: () => void;
    subscriber.subscribe.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
    );
    subscriber.emit('ready');
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
    acknowledge();
    await Promise.resolve();
    await service['refreshPromise'];
    expect(service['workers'].size).toBe(0);
    execute.mockResolvedValue([{ code: 'eu-central' }]);
    subscriber.emit('ready');
    await Promise.resolve();
    await service['refreshPromise'];
    expect([...service['activeQueueNames']]).toEqual(['monitor-eu-central']);
    await service.onModuleDestroy();
  });

  it('serializes disable/re-enable while unregistering before the old worker drains', async () => {
    const { service, heartbeat, connection } = setup();
    await service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: ['eu'] }),
    );
    const worker = service['workers'].get('monitor-eu')!;
    let drain!: () => void;
    let closing!: () => void;
    const closeStarted = new Promise<void>((resolve) => {
      closing = resolve;
    });
    (worker.close as jest.Mock).mockImplementationOnce(() => {
      closing();
      return new Promise<void>((resolve) => {
        drain = resolve;
      });
    });
    const disable = service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: [] }),
    );
    await closeStarted;
    expect(heartbeat.removeQueues).toHaveBeenCalledWith(['monitor-eu']);
    expect(connection.quit).not.toHaveBeenCalled();
    const enable = service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: ['eu'] }),
    );
    await Promise.resolve();
    expect(Worker).toHaveBeenCalledTimes(1);
    drain();
    await Promise.all([disable, enable]);
    expect(service['workers'].get('monitor-eu')).not.toBe(worker);
    expect(Worker).toHaveBeenCalledTimes(2);
    expect(worker.close).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
  });

  it('applies a newer notification after an older slow DB discovery', async () => {
    const { service, execute } = setup();
    let discover!: (rows: { code: string }[]) => void;
    execute.mockReturnValueOnce(
      new Promise((resolve) => {
        discover = resolve;
      }),
    );
    const oldRefresh = service['handleQueueRefresh']();
    await Promise.resolve();
    const newRefresh = service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: ['us'] }),
    );
    discover([{ code: 'eu' }]);
    execute.mockResolvedValue([{ code: 'us' }]);
    await Promise.all([oldRefresh, newRefresh]);
    expect([...service['activeQueueNames']]).toEqual(['monitor-us']);
    await service.onModuleDestroy();
  });

  it('continues after a failed refresh and rejects malformed location codes', async () => {
    const { service, execute } = setup();
    execute.mockResolvedValue([{ code: 'eu' }]);
    await service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: [42] }),
    );
    expect([...service['activeQueueNames']]).toEqual(['monitor-eu']);
    execute.mockRejectedValue(new Error('DB unavailable'));
    await service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: [42] }),
    );
    expect([...service['activeQueueNames']]).toEqual(['monitor-eu']);
    (Worker as unknown as jest.Mock).mockImplementationOnce(() => {
      throw new Error('worker creation failed');
    });
    await expect(
      service['handleQueueRefresh'](JSON.stringify({ locationCodes: ['us'] })),
    ).rejects.toThrow('worker creation failed');
    await service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: ['us'] }),
    );
    expect([...service['activeQueueNames']]).toEqual(['monitor-us']);
    await service.onModuleDestroy();
  });

  it('blocks refresh work and timer rescheduling once shutdown begins', async () => {
    jest.useFakeTimers();
    const { service, execute, connection } = setup('eu-central');
    execute.mockResolvedValue([{ code: 'eu-central' }]);
    await service.onModuleInit();
    const worker = service['workers'].get('monitor-eu-central')!;
    let discover!: (rows: { code: string }[]) => void;
    execute.mockReturnValueOnce(
      new Promise((resolve) => {
        discover = resolve;
      }),
    );
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    const shutdown = service.onModuleDestroy();
    discover([{ code: 'eu-central' }]);
    await shutdown;
    await service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: ['eu-central'] }),
    );
    await jest.advanceTimersByTimeAsync(300_000);
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(Worker).toHaveBeenCalledTimes(1);
    expect(service['activeQueueNames'].size).toBe(0);
    expect(connection.quit).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits for an in-flight disable drain during shutdown without closing twice', async () => {
    const { service, connection, heartbeat } = setup();
    await service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: ['eu'] }),
    );
    const worker = service['workers'].get('monitor-eu')!;
    let drain!: () => void;
    let closing!: () => void;
    const closeStarted = new Promise<void>((resolve) => {
      closing = resolve;
    });
    (worker.close as jest.Mock).mockImplementationOnce(() => {
      closing();
      return new Promise<void>((resolve) => {
        drain = resolve;
      });
    });
    const disable = service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: [] }),
    );
    await closeStarted;
    const shutdown = service.onModuleDestroy();
    expect(heartbeat.removeQueues).toHaveBeenCalledWith(['monitor-eu']);
    expect(connection.quit).not.toHaveBeenCalled();
    drain();
    await Promise.all([disable, shutdown]);
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(connection.quit).toHaveBeenCalledTimes(1);
  });

  it('disconnects an offline subscriber without waiting for Redis commands during shutdown', async () => {
    const { service, subscriber, execute } = setup('eu-central');
    execute.mockResolvedValue([{ code: 'eu-central' }]);
    await service.onModuleInit();
    subscriber.unsubscribe.mockReturnValue(new Promise(() => {}));
    subscriber.quit.mockReturnValue(new Promise(() => {}));
    await service.onModuleDestroy();
    expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
    expect(subscriber.unsubscribe).not.toHaveBeenCalled();
    expect(subscriber.quit).not.toHaveBeenCalled();
    expect(service['workers'].size).toBe(0);
  });

  it.each(['local', 'eu-central'])(
    'ignores stale pub/sub snapshots when DB is authoritative (%s)',
    async (location) => {
      const { service, execute } = setup(location);
      execute.mockResolvedValue([{ code: 'eu-central' }]);
      await service.onModuleInit();
      execute.mockResolvedValue([]);
      await service['handleQueueRefresh'](
        JSON.stringify({ locationCodes: ['eu-central', 'us-east'] }),
      );
      expect(service['workers'].size).toBe(0);
      execute.mockResolvedValue([{ code: 'eu-central' }]);
      await service['handleQueueRefresh'](
        JSON.stringify({ locationCodes: [] }),
      );
      expect([...service['activeQueueNames']]).toEqual(['monitor-eu-central']);
      await service.onModuleDestroy();
    },
  );

  it('does not subscribe a regional worker whose location is disabled', async () => {
    const { service } = setup();
    (service as unknown as { dbService: DbService }).dbService = {
      db: {
        execute: jest.fn().mockResolvedValue([{ code: 'eu-central' }]),
      },
    } as unknown as DbService;
    await expect(service['getQueueNames']('us-east')).resolves.toEqual([]);
  });

  it('keeps a regional worker on its own location when other locations are enabled', async () => {
    const { service, heartbeat } = setup();
    service['workerLocation'] = 'eu-central';
    await service['handleQueueRefresh'](
      JSON.stringify({
        locationCodes: ['eu-central', 'us-east', 'asia-pacific'],
      }),
    );
    expect(Worker).toHaveBeenCalledTimes(1);
    expect(Worker).toHaveBeenCalledWith(
      'monitor-eu-central',
      expect.any(Function),
      expect.any(Object),
    );
    expect(heartbeat.addQueues).toHaveBeenCalledWith(['monitor-eu-central']);
    await service.onModuleDestroy();
  });

  it('drains queues when an authoritative refresh disables every location', async () => {
    const { service, heartbeat } = setup();
    await service['handleQueueRefresh'](
      JSON.stringify({ locationCodes: ['eu'] }),
    );
    const worker = Array.from(service['workers'].values())[0];
    await service['handleQueueRefresh'](JSON.stringify({ locationCodes: [] }));
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(service['workers'].size).toBe(0);
    expect(heartbeat.removeQueues).toHaveBeenCalledWith(['monitor-eu']);
    await service.onModuleDestroy();
  });
  it.each(['failed', 'delayed'])(
    'records a distributed terminal result only for state %s',
    async (state) => {
      const save = jest.fn().mockResolvedValue(undefined);
      const findFirst = jest.fn().mockResolvedValue(undefined);
      const service = new MonitorDynamicWorkerService(
        { saveDistributedMonitorResult: save } as unknown as MonitorService,
        new ConfigService(),
        {} as HeartbeatService,
        {
          db: { query: { monitorResults: { findFirst } } },
        } as unknown as DbService,
      );
      const job = {
        data: {
          monitorId: 'monitor-1',
          executionGroupId: 'group-1',
          executionLocation: 'eu',
          expectedLocations: ['eu'],
        },
        opts: { attempts: 3 },
        attemptsMade: 0,
        getState: jest.fn().mockResolvedValue(state),
      } as unknown as Job<MonitorJobDataDto>;
      await service['handleFinalJobFailure'](
        job,
        new Error('stalled recovery exhausted'),
      );
      if (state === 'failed') {
        expect(save).toHaveBeenCalledWith(
          expect.objectContaining({
            monitorId: 'monitor-1',
            location: 'eu',
            isUp: false,
          }),
          { executionGroupId: 'group-1', expectedLocations: ['eu'] },
        );
      } else {
        expect(findFirst).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
      }
    },
  );
  it('carries the cycle marker into a final failure so it records a hint, never legacy evaluation', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const service = new MonitorDynamicWorkerService(
      { saveDistributedMonitorResult: save } as unknown as MonitorService,
      new ConfigService(),
      {} as HeartbeatService,
      {
        db: {
          query: {
            monitorResults: {
              findFirst: jest.fn().mockResolvedValue(undefined),
            },
          },
        },
      } as unknown as DbService,
    );
    const job = {
      data: {
        monitorId: 'monitor-1',
        executionGroupId: 'cycle-1',
        executionLocation: 'eu',
        expectedLocations: ['eu'],
        monitorCycle: true,
      },
      opts: { attempts: 3 },
      attemptsMade: 2,
      getState: jest.fn().mockResolvedValue('failed'),
    } as unknown as Job<MonitorJobDataDto>;
    await service['handleFinalJobFailure'](job, new Error('probe crashed'));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ monitorId: 'monitor-1', isUp: false }),
      {
        executionGroupId: 'cycle-1',
        expectedLocations: ['eu'],
        monitorCycle: true,
      },
    );
  });
  it('defers aggregation contention without spending a failed attempt', async () => {
    const monitorService = {
      executeMonitor: jest.fn().mockResolvedValue({
        monitorId: 'monitor-1',
        location: 'eu',
        isUp: true,
      }),
      saveDistributedMonitorResult: jest
        .fn()
        .mockRejectedValue(new MonitorAggregationBusyError()),
    };
    const service = new MonitorDynamicWorkerService(
      monitorService as unknown as MonitorService,
      new ConfigService(),
      {} as HeartbeatService,
      {} as DbService,
    );
    const moveToDelayed = jest.fn().mockResolvedValue(undefined);
    const job = {
      name: 'executeMonitorJob',
      data: { monitorId: 'monitor-1', executionLocation: 'eu' },
      token: 'worker-token',
      attemptsMade: 0,
      moveToDelayed,
      updateData: jest.fn().mockResolvedValue(undefined),
    };
    await expect(
      service['processJob'](job as unknown as Job<MonitorJobDataDto>),
    ).rejects.toMatchObject({ name: 'DelayedError' });
    expect(moveToDelayed).toHaveBeenCalledWith(
      expect.any(Number),
      'worker-token',
    );
    expect(job.attemptsMade).toBe(0);
    expect(job.updateData).toHaveBeenCalledWith(
      expect.objectContaining({ aggregationOnly: true }),
    );
  });
  it.each([false, true])(
    'requeues final aggregation contention without another probe (existing=%s)',
    async (existing) => {
      const row = {
        id: 'result',
        monitorId: 'monitor-1',
        location: 'eu',
        status: 'error',
        isUp: false,
        checkedAt: new Date(),
        details: null,
      };
      const findFirst = jest
        .fn()
        .mockResolvedValueOnce(existing ? row : undefined)
        .mockResolvedValue(row);
      const executeMonitor = jest.fn();
      const save = jest
        .fn()
        .mockRejectedValueOnce(new MonitorAggregationBusyError())
        .mockResolvedValue(undefined);
      const service = new MonitorDynamicWorkerService(
        {
          executeMonitor,
          saveDistributedMonitorResult: save,
        } as unknown as MonitorService,
        new ConfigService(),
        {} as HeartbeatService,
        {
          db: { query: { monitorResults: { findFirst } } },
        } as unknown as DbService,
      );
      const job = {
        name: 'executeMonitorJob',
        data: {
          monitorId: 'monitor-1',
          executionGroupId: 'group-1',
          executionLocation: 'eu',
          expectedLocations: ['eu'],
        },
        attemptsMade: 3,
        getState: jest.fn().mockResolvedValue('failed'),
        updateData: jest.fn(),
        retry: jest.fn().mockResolvedValue(undefined),
      };
      job.updateData.mockImplementation(async (data: typeof job.data) => {
        job.data = data;
      });
      await service['handleFinalJobFailure'](
        job as unknown as Job<MonitorJobDataDto>,
        new Error('probe failed'),
      );
      expect(job.updateData).toHaveBeenCalledWith(
        expect.objectContaining({ aggregationOnly: true }),
      );
      expect(job.retry).toHaveBeenCalledWith('failed');
      if (existing)
        expect(save.mock.calls[0][1]).toMatchObject({ persisted: true });
      await service['processJob'](job as unknown as Job<MonitorJobDataDto>);
      expect(executeMonitor).not.toHaveBeenCalled();
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'result' }),
        expect.objectContaining({ persisted: true }),
      );
    },
  );
  it('resumes an aggregation delay from persisted evidence without rerunning the probe', async () => {
    const executeMonitor = jest.fn();
    const save = jest.fn().mockResolvedValue(undefined);
    const row = {
      monitorId: 'monitor-1',
      location: 'eu',
      status: 'up',
      isUp: true,
      checkedAt: new Date(),
      details: null,
      responseTimeMs: 1,
      testExecutionId: null,
      testReportS3Url: null,
    };
    const service = new MonitorDynamicWorkerService(
      {
        executeMonitor,
        saveDistributedMonitorResult: save,
      } as unknown as MonitorService,
      new ConfigService(),
      {} as HeartbeatService,
      {
        db: {
          query: {
            monitorResults: { findFirst: jest.fn().mockResolvedValue(row) },
          },
        },
      } as unknown as DbService,
    );
    await service['processJob']({
      name: 'executeMonitorJob',
      data: {
        monitorId: 'monitor-1',
        executionLocation: 'eu',
        executionGroupId: 'group-1',
        aggregationOnly: true,
      },
    } as unknown as Job<MonitorJobDataDto>);
    expect(executeMonitor).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ monitorId: 'monitor-1', isUp: true }),
      expect.objectContaining({ persisted: true }),
    );
  });
});

describe('MonitorDynamicWorkerService workload gating and backstops', () => {
  const originalQueues = process.env.WORKER_QUEUES;
  beforeEach(() => resetWorkerQueuesForTests());
  afterEach(() => {
    if (originalQueues === undefined) delete process.env.WORKER_QUEUES;
    else process.env.WORKER_QUEUES = originalQueues;
    clearLocationCapabilityCache();
    resetWorkerQueuesForTests();
  });

  function build(execute: jest.Mock, saved?: object) {
    const executeMonitor = jest.fn().mockResolvedValue({
      monitorId: 'monitor-1',
      location: 'us-east',
      status: 'up',
      isUp: true,
      checkedAt: new Date(),
    });
    const save = jest.fn().mockResolvedValue(undefined);
    const service = new MonitorDynamicWorkerService(
      {
        executeMonitor,
        saveDistributedMonitorResult: save,
      } as unknown as MonitorService,
      new ConfigService(),
      {} as HeartbeatService,
      {
        db: {
          execute,
          query: {
            monitorResults: { findFirst: jest.fn().mockResolvedValue(saved) },
          },
        },
      } as unknown as DbService,
    );
    return { service, executeMonitor, save };
  }

  const job = (type: string, extra: object = {}) =>
    ({
      name: 'executeMonitorJob',
      data: {
        monitorId: 'monitor-1',
        type,
        executionLocation: 'us-east',
        executionGroupId: 'group-1',
        expectedLocations: ['us-east'],
        ...extra,
      },
    }) as unknown as Job<MonitorJobDataDto>;

  it('fails a synthetic job permanently when the location lost browser capability', async () => {
    const execute = jest
      .fn()
      .mockResolvedValue([{ supports_browser: false, supports_k6: false }]);
    const { service, executeMonitor } = build(execute);
    await expect(
      service['processJob'](job('synthetic_test')),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(executeMonitor).not.toHaveBeenCalled();
  });

  it('runs a synthetic job when the location supports browser', async () => {
    const execute = jest
      .fn()
      .mockResolvedValue([{ supports_browser: true, supports_k6: false }]);
    const { service, executeMonitor } = build(execute);
    await service['processJob'](job('synthetic_test'));
    expect(executeMonitor).toHaveBeenCalledTimes(1);
  });

  it('never checks capability for HTTP monitors', async () => {
    const execute = jest.fn();
    const { service, executeMonitor } = build(execute);
    await service['processJob'](job('website'));
    expect(execute).not.toHaveBeenCalled();
    expect(executeMonitor).toHaveBeenCalledTimes(1);
  });

  it('treats a capability lookup failure as retryable, not as allowed', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('db down'));
    const { service, executeMonitor } = build(execute);
    const error = await service['processJob'](job('synthetic_test')).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(executeMonitor).not.toHaveBeenCalled();
  });

  it('lets an aggregation retry finish even after capability is revoked', async () => {
    const execute = jest
      .fn()
      .mockResolvedValue([{ supports_browser: false, supports_k6: false }]);
    const saved = {
      monitorId: 'monitor-1',
      location: 'us-east',
      status: 'up',
      isUp: true,
      checkedAt: new Date(),
      details: null,
      responseTimeMs: 1,
      testExecutionId: null,
      testReportS3Url: null,
    };
    const { service, executeMonitor, save } = build(execute, saved);
    await service['processJob'](
      job('synthetic_test', { aggregationOnly: true }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(executeMonitor).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ persisted: true }),
    );
  });

  it('starts no monitor consumers when WORKER_QUEUES excludes monitor', async () => {
    process.env.WORKER_QUEUES = 'k6';
    const execute = jest.fn();
    const { service } = build(execute);
    service['createRedisConnection'] = jest.fn();
    await service.onModuleInit();
    expect(service['createRedisConnection']).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
