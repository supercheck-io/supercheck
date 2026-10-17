/**
 * Queue status listeners are the worker's only visibility into BullMQ job
 * transitions. These tests pin the listener wiring, the failure log level and
 * the teardown path that decides whether a redeploy leaks a Redis connection.
 */
import { Queue, QueueEvents } from 'bullmq';
import { QueueStatusService } from './queue-status.service';

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  QueueEvents: jest.fn(),
}));

const QueueEventsMock = QueueEvents as unknown as jest.Mock;

type Listener = (...args: unknown[]) => void;

async function createService(options: { clientRejects?: boolean } = {}) {
  const connection = {
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
  };
  const client = {
    duplicate: jest.fn().mockReturnValue(connection),
  };
  const queue = {
    client: options.clientRejects
      ? Promise.reject(new Error('redis unavailable'))
      : Promise.resolve(client),
  };

  const listeners = new Map<string, Listener>();
  const queueEvents = {
    on: jest.fn((event: string, listener: Listener) => {
      listeners.set(event, listener);
      return queueEvents;
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  QueueEventsMock.mockImplementation(() => queueEvents);

  const service = new QueueStatusService(queue as unknown as Queue);
  // The constructor kicks off async initialisation without awaiting it.
  await new Promise((resolve) => setImmediate(resolve));

  return { service, queueEvents, connection, listeners };
}

describe('QueueStatusService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('duplicates the queue connection for QueueEvents instead of sharing it', async () => {
    const { queueEvents, connection } = await createService();

    expect(connection.connect).toHaveBeenCalledTimes(1);
    expect(QueueEventsMock).toHaveBeenCalledWith('playwright-global', {
      connection,
    });
    expect(queueEvents.on).toHaveBeenCalledWith(
      'waiting',
      expect.any(Function),
    );
    expect(queueEvents.on).toHaveBeenCalledWith('active', expect.any(Function));
    expect(queueEvents.on).toHaveBeenCalledWith(
      'completed',
      expect.any(Function),
    );
    expect(queueEvents.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('logs job failures at error level and progress at debug level', async () => {
    const { service, listeners } = await createService();
    const debug = jest.spyOn(service['logger'], 'debug');
    const error = jest.spyOn(service['logger'], 'error');

    listeners.get('failed')?.({
      jobId: 'job-1',
      failedReason: 'container exited',
    });
    listeners.get('completed')?.({ jobId: 'job-1' });

    expect(error).toHaveBeenCalledWith('Job job-1 failed: container exited');
    expect(debug).toHaveBeenCalledWith('Job job-1 completed');
  });

  it('closes QueueEvents and quits the duplicated connection on destroy', async () => {
    const { service, queueEvents, connection } = await createService();

    await service.onModuleDestroy();

    expect(queueEvents.close).toHaveBeenCalledTimes(1);
    expect(connection.quit).toHaveBeenCalledTimes(1);
    expect(connection.disconnect).not.toHaveBeenCalled();
  });

  it('forces a disconnect when quitting the connection fails', async () => {
    const { service, connection } = await createService();
    connection.quit.mockRejectedValueOnce(new Error('socket already closed'));

    await service.onModuleDestroy();

    expect(connection.disconnect).toHaveBeenCalledTimes(1);
  });

  it('survives a failed initialisation and makes destroy a no-op', async () => {
    const { Logger } = await import('@nestjs/common');
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const queue = { client: Promise.reject(new Error('redis unavailable')) };

    const service = new QueueStatusService(queue as unknown as Queue);
    await new Promise((resolve) => setImmediate(resolve));

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      'Failed to initialize queue status listeners:',
      expect.any(Error),
    );
    error.mockRestore();
  });
});
