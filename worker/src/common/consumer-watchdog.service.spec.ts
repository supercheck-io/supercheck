import type { Worker } from 'bullmq';
import * as shutdownIntake from './shutdown-intake';
import {
  ConsumerWatchdogService,
  registerConsumer,
} from './consumer-watchdog.service';

type FakeClient = {
  status: string;
  ping: jest.Mock;
  disconnect: jest.Mock;
};

function fakeWorker(
  client: Partial<FakeClient> = {},
  worker: Record<string, unknown> = {},
) {
  const redis: FakeClient = {
    status: 'ready',
    ping: jest.fn().mockResolvedValue('PONG'),
    disconnect: jest.fn(),
    ...client,
  };
  const w = {
    name: 'q',
    closing: undefined,
    isPaused: () => false,
    isRunning: () => true,
    client: Promise.resolve(redis),
    ...worker,
  };
  return { worker: w as unknown as Worker, redis };
}

describe('ConsumerWatchdogService', () => {
  const MIN = 60_000;
  let service: ConsumerWatchdogService;
  let unregister: () => void;

  const watch = (w: Worker) => {
    unregister = registerConsumer(() => [w]);
  };

  beforeEach(() => {
    service = new ConsumerWatchdogService();
  });
  afterEach(() => {
    unregister?.();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('stays healthy while the connection answers', async () => {
    const { worker, redis } = fakeWorker();
    watch(worker);
    await service.probe(0);
    expect(redis.ping).toHaveBeenCalled();
    expect(redis.disconnect).not.toHaveBeenCalled();
    expect(service.isHealthy(10 * MIN)).toBe(true);
  });

  it('forces a reconnect when a ready connection stops answering, then recovers', async () => {
    jest.useFakeTimers();
    const { worker, redis } = fakeWorker({
      ping: jest.fn().mockReturnValue(new Promise(() => undefined)),
    });
    watch(worker);
    const probing = service.probe(0);
    await jest.advanceTimersByTimeAsync(6_000);
    await probing;
    expect(redis.disconnect).toHaveBeenCalledWith(true);
    // Not dead yet, but the stall is on the clock.
    expect(service.isHealthy(4 * MIN)).toBe(true);
    expect(service.isHealthy(5 * MIN)).toBe(false);

    redis.ping.mockResolvedValue('PONG');
    await service.probe(5 * MIN);
    expect(service.isHealthy(6 * MIN)).toBe(true);
  });

  it('fails liveness for an ended connection after the grace period', async () => {
    const { worker } = fakeWorker({ status: 'end' });
    watch(worker);
    await service.probe(0);
    expect(service.isHealthy(5 * MIN)).toBe(false);
  });

  it('fails liveness when the run loop exited', async () => {
    const { worker } = fakeWorker({}, { isRunning: () => false });
    watch(worker);
    await service.probe(0);
    expect(service.isHealthy(5 * MIN)).toBe(false);
  });

  it('leaves a reconnecting connection alone', async () => {
    const { worker, redis } = fakeWorker({ status: 'reconnecting' });
    watch(worker);
    await service.probe(0);
    expect(redis.ping).not.toHaveBeenCalled();
    expect(redis.disconnect).not.toHaveBeenCalled();
    expect(service.isHealthy(10 * MIN)).toBe(true);
  });

  it('ignores paused and closing consumers', async () => {
    const paused = fakeWorker({ status: 'end' }, { isPaused: () => true });
    const closing = fakeWorker(
      { status: 'end' },
      { closing: Promise.resolve() },
    );
    unregister = registerConsumer(() => [paused.worker, closing.worker]);
    await service.probe(0);
    expect(service.isHealthy(10 * MIN)).toBe(true);
  });

  it('never fails liveness while draining, so the shutdown drain is not cut short', async () => {
    const { worker } = fakeWorker({ status: 'end' });
    watch(worker);
    await service.probe(0);
    jest.spyOn(shutdownIntake, 'isDraining').mockReturnValue(true);
    expect(service.isHealthy(10 * MIN)).toBe(true);
  });

  it('forgets a consumer that was removed', async () => {
    const { worker } = fakeWorker({ status: 'end' });
    watch(worker);
    await service.probe(0);
    unregister();
    await service.probe(MIN);
    expect(service.isHealthy(10 * MIN)).toBe(true);
  });
});
