import type { Worker } from 'bullmq';
import * as shutdownIntake from './shutdown-intake';
import {
  ConsumerWatchdogService,
  registerConsumer,
} from './consumer-watchdog.service';

type FakeClient = {
  status: string;
  connect: jest.Mock;
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
    connect: jest.fn().mockResolvedValue(undefined),
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

  // One probe whose PING never answers: init (5 s) then PING (5 s) timeouts can chain.
  const probeHung = async (now: number) => {
    const probing = service.probe(now);
    await jest.advanceTimersByTimeAsync(12_000);
    await probing;
  };

  it('forces a reconnect only after 3 timed-out PINGs in a row, then recovers', async () => {
    jest.useFakeTimers();
    const { worker, redis } = fakeWorker({
      ping: jest.fn().mockReturnValue(new Promise(() => undefined)),
    });
    watch(worker);
    await probeHung(0);
    await probeHung(15_000);
    expect(redis.disconnect).not.toHaveBeenCalled();
    await probeHung(30_000);
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
    expect(redis.disconnect).toHaveBeenCalledWith(true);
    // Not dead yet, but the stall is on the clock.
    expect(service.isHealthy(4 * MIN)).toBe(true);
    expect(service.isHealthy(5 * MIN)).toBe(false);

    redis.ping.mockResolvedValue('PONG');
    await service.probe(5 * MIN);
    expect(service.isHealthy(6 * MIN)).toBe(true);
  });

  it('never kicks a slow but alive Redis: a reply resets the miss count', async () => {
    jest.useFakeTimers();
    const hang = new Promise(() => undefined);
    const { worker, redis } = fakeWorker({ ping: jest.fn() });
    watch(worker);
    for (let round = 0; round < 3; round++) {
      const base = round * 60_000;
      redis.ping.mockReturnValue(hang);
      await probeHung(base);
      await probeHung(base + 15_000);
      redis.ping.mockResolvedValue('PONG');
      await service.probe(base + 30_000);
    }
    expect(redis.disconnect).not.toHaveBeenCalled();
    expect(service.isHealthy(10 * MIN)).toBe(true);
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

  const hung = () => jest.fn().mockReturnValue(new Promise(() => undefined));

  it('resets the stall clock while ioredis reconnects, so a long Redis outage alone never restarts the pod', async () => {
    jest.useFakeTimers();
    const { worker, redis } = fakeWorker({ ping: hung() });
    watch(worker);
    const first = service.probe(0);
    await jest.advanceTimersByTimeAsync(6_000);
    await first;
    redis.status = 'reconnecting';
    await service.probe(2 * MIN);
    expect(service.isHealthy(10 * MIN)).toBe(true);
  });

  it('does not kick a client that started connecting while its PING was pending', async () => {
    jest.useFakeTimers();
    const { worker, redis } = fakeWorker({ ping: hung() });
    watch(worker);
    const probing = service.probe(0);
    redis.status = 'connecting';
    await jest.advanceTimersByTimeAsync(6_000);
    await probing;
    expect(redis.disconnect).not.toHaveBeenCalled();
  });

  it('kicks a dead connection while paused or draining, but does not count it', async () => {
    jest.useFakeTimers();
    const { worker, redis } = fakeWorker(
      { ping: hung() },
      { isPaused: () => true },
    );
    watch(worker);
    jest.spyOn(shutdownIntake, 'isDraining').mockReturnValue(true);
    for (let i = 0; i < 3; i++) await probeHung(i * 15_000);
    expect(redis.disconnect).toHaveBeenCalledWith(true);
    expect(service.isHealthy(10 * MIN)).toBe(true);
  });

  it('pings and kicks a client shared by several workers once per probe', async () => {
    jest.useFakeTimers();
    const a = fakeWorker({ ping: hung() });
    const b = fakeWorker({}, { client: a.worker.client });
    unregister = registerConsumer(() => [a.worker, b.worker]);
    for (let i = 0; i < 3; i++) await probeHung(i * 15_000);
    expect(a.redis.ping).toHaveBeenCalledTimes(3);
    expect(a.redis.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect on a Redis reply error: the socket answered', async () => {
    const { worker, redis } = fakeWorker({
      ping: jest.fn().mockRejectedValue(new Error('LOADING')),
    });
    watch(worker);
    await service.probe(0);
    expect(redis.disconnect).not.toHaveBeenCalled();
    expect(service.isHealthy(10 * MIN)).toBe(true);
  });

  it('never kicks across repeated error replies (LOADING, READONLY)', async () => {
    const { worker, redis } = fakeWorker({
      ping: jest.fn().mockRejectedValue(new Error('READONLY')),
    });
    watch(worker);
    for (let i = 0; i < 5; i++) await service.probe(i * 15_000);
    expect(redis.disconnect).not.toHaveBeenCalled();
    expect(service.isHealthy(10 * MIN)).toBe(true);
  });

  it('one consumer whose client never initialises does not block checking the others', async () => {
    jest.useFakeTimers();
    const stuck = fakeWorker({}, { client: new Promise(() => undefined) });
    const dead = fakeWorker({ ping: hung() });
    unregister = registerConsumer(() => [stuck.worker, dead.worker]);
    for (let i = 0; i < 3; i++) await probeHung(i * 15_000);
    expect(dead.redis.disconnect).toHaveBeenCalledWith(true);
    expect(service.isHealthy(5 * MIN)).toBe(false);
  });

  it('treats a client or blocking client still connecting (pod started while Redis is down) as reconnecting, never broken', async () => {
    jest.useFakeTimers();
    const pending = new Promise<never>(() => undefined);
    const noClient = fakeWorker({}, { client: pending });
    const noBlocking = fakeWorker(
      { ping: jest.fn().mockResolvedValue('PONG') },
      { blockingConnection: { client: pending } },
    );
    unregister = registerConsumer(() => [noClient.worker, noBlocking.worker]);
    for (let i = 0; i < 25; i++) await probeHung(i * 15_000);
    expect(service.isHealthy(10 * MIN)).toBe(true);
    expect(noBlocking.redis.disconnect).not.toHaveBeenCalled();
  });

  it('still fails liveness when the client promise rejects outright', async () => {
    const { worker } = fakeWorker(
      {},
      { client: Promise.reject(new Error('boom')) },
    );
    watch(worker);
    await service.probe(0);
    expect(service.isHealthy(5 * MIN)).toBe(false);
  });

  const blockingOf = (status: string) => ({
    status,
    ping: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  });

  it('revives an ended blocking connection, the silent stall after a Sentinel outage, and counts it', async () => {
    const blocking = blockingOf('end');
    const { worker } = fakeWorker(
      {},
      { blockingConnection: { client: Promise.resolve(blocking) } },
    );
    watch(worker);
    await service.probe(0);
    expect(blocking.connect).toHaveBeenCalledTimes(1);
    expect(service.isHealthy(5 * MIN)).toBe(false);

    blocking.status = 'ready';
    await service.probe(MIN);
    expect(service.isHealthy(10 * MIN)).toBe(true);
  });

  it('never pings a ready blocking connection: the PING would queue behind BZPOPMIN', async () => {
    const blocking = blockingOf('ready');
    const { worker } = fakeWorker(
      {},
      { blockingConnection: { client: Promise.resolve(blocking) } },
    );
    watch(worker);
    await service.probe(0);
    expect(blocking.ping).not.toHaveBeenCalled();
    expect(blocking.connect).not.toHaveBeenCalled();
  });

  it('revives an ended command connection', async () => {
    const { worker, redis } = fakeWorker({ status: 'end' });
    watch(worker);
    await service.probe(0);
    expect(redis.connect).toHaveBeenCalledTimes(1);
  });

  it('leaves the ended connections of a closing worker alone', async () => {
    const blocking = blockingOf('end');
    const { worker, redis } = fakeWorker(
      { status: 'end' },
      {
        closing: Promise.resolve(),
        blockingConnection: { client: Promise.resolve(blocking) },
      },
    );
    watch(worker);
    await service.probe(0);
    expect(blocking.connect).not.toHaveBeenCalled();
    expect(redis.connect).not.toHaveBeenCalled();
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
