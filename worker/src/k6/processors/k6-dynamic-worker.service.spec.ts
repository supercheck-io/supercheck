jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('./k6-execution.processor', () => ({
  K6ExecutionProcessor: class {},
}));
jest.mock('../../db/db.service', () => ({ DbService: class {} }));
jest.mock('../../common/heartbeat/heartbeat.service', () => ({
  HeartbeatService: class {},
}));

import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { K6DynamicWorkerService } from './k6-dynamic-worker.service';
import { K6ExecutionProcessor } from './k6-execution.processor';
import { DbService } from '../../db/db.service';
import { HeartbeatService } from '../../common/heartbeat/heartbeat.service';

describe('K6DynamicWorkerService lifecycle', () => {
  function setup() {
    const heartbeat = { addQueues: jest.fn(), removeQueues: jest.fn() };
    const connection = {
      duplicate: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
    };
    const service = new K6DynamicWorkerService(
      {} as K6ExecutionProcessor,
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
    expect(heartbeat.removeQueues).toHaveBeenCalledWith(['k6-eu']);
    await service.onModuleDestroy();
  });
});
