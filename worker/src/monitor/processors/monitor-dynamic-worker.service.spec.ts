jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('../monitor.service', () => ({ MonitorService: class {} }));
jest.mock('../../db/db.service', () => ({ DbService: class {} }));
jest.mock('../../common/heartbeat/heartbeat.service', () => ({
  HeartbeatService: class {},
}));

import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import { MonitorJobDataDto } from '../dto/monitor-job.dto';
import Redis from 'ioredis';
import { MonitorDynamicWorkerService } from './monitor-dynamic-worker.service';
import { MonitorService } from '../monitor.service';
import { DbService } from '../../db/db.service';
import { HeartbeatService } from '../../common/heartbeat/heartbeat.service';

describe('MonitorDynamicWorkerService lifecycle', () => {
  function setup() {
    const heartbeat = { addQueues: jest.fn(), removeQueues: jest.fn() };
    const connection = {
      duplicate: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
    };
    const service = new MonitorDynamicWorkerService(
      {} as MonitorService,
      new ConfigService(),
      heartbeat as unknown as HeartbeatService,
      {} as DbService,
    );
    service['connection'] = connection as unknown as Redis;
    return { service, connection, heartbeat };
  }

  beforeEach(() => jest.clearAllMocks());

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
});
