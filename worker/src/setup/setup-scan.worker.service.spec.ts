const workerCtor = jest.fn();
const pause = jest.fn();
const close = jest.fn().mockResolvedValue(undefined);
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((...args: unknown[]) => {
    workerCtor(...args);
    return { on: jest.fn(), pause, close };
  }),
}));
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    quit: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('../common/redis/redis-options', () => ({
  buildRedisOptions: () => ({}),
}));
jest.mock('../common/worker-queues', () => ({
  consumesWorkerQueue: jest.fn(),
}));
jest.mock('./setup-scan.processor', () => ({
  SETUP_SCAN_QUEUE: 'setup-scan',
  processSetupScan: jest.fn().mockResolvedValue({ ok: true }),
}));

import { ConfigService } from '@nestjs/config';
import { consumesWorkerQueue } from '../common/worker-queues';
import { SetupScanWorkerService } from './setup-scan.worker.service';

describe('SetupScanWorkerService', () => {
  beforeEach(() => workerCtor.mockClear());

  it('does not consume setup-scan when WORKER_QUEUES excludes monitor', async () => {
    (consumesWorkerQueue as jest.Mock).mockReturnValue(false);
    const svc = new SetupScanWorkerService(new ConfigService());
    svc.onModuleInit();
    expect(consumesWorkerQueue).toHaveBeenCalledWith('monitor');
    expect(workerCtor).not.toHaveBeenCalled();
    await svc.onApplicationShutdown();
  });

  it('starts a concurrency-2 worker on the setup-scan queue and closes it', async () => {
    (consumesWorkerQueue as jest.Mock).mockReturnValue(true);
    const svc = new SetupScanWorkerService(new ConfigService());
    svc.onModuleInit();
    expect(workerCtor.mock.calls[0][0]).toBe('setup-scan');
    expect(workerCtor.mock.calls[0][2]).toMatchObject({ concurrency: 2 });
    const processor = workerCtor.mock.calls[0][1];
    await expect(processor({ data: { url: 'http://x' } })).resolves.toEqual({
      ok: true,
    });
    await svc.onApplicationShutdown();
    expect(close).toHaveBeenCalled();
  });
});
