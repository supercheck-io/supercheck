import {
  DEAD_AFTER_MS,
  isConsumerHealthy,
  probeConsumers,
  resetConsumerWatchdogForTests,
  watchConsumer,
} from "./consumer-watchdog";

jest.mock("./logger/index", () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

type FakeClient = { status: string; connect: jest.Mock; disconnect: jest.Mock; ping: jest.Mock };
const client = (status = "ready"): FakeClient => ({
  status,
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
  ping: jest.fn().mockResolvedValue("PONG"),
});
const worker = (blocking: FakeClient, command: FakeClient, over: Record<string, unknown> = {}) =>
  ({
    name: "q",
    blockingConnection: { client: Promise.resolve(blocking) },
    client: Promise.resolve(command),
    closing: undefined,
    isPaused: () => false,
    isRunning: () => true,
    ...over,
  }) as never;

describe("consumer watchdog", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetConsumerWatchdogForTests();
  });
  afterEach(() => {
    resetConsumerWatchdogForTests();
    jest.useRealTimers();
  });

  it("revives an ended blocking client and fails liveness only after DEAD_AFTER_MS", async () => {
    const blocking = client("end");
    watchConsumer(worker(blocking, client()));
    await probeConsumers(1000);
    expect(blocking.connect).toHaveBeenCalledTimes(1);
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS - 1)).toBe(true);
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS)).toBe(false);
  });

  it("recovers once the blocking client is back", async () => {
    const blocking = client("end");
    watchConsumer(worker(blocking, client()));
    await probeConsumers(1000);
    blocking.status = "ready";
    await probeConsumers(2000);
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS)).toBe(true);
  });

  const probeHanging = async (now: number) => {
    const probing = probeConsumers(now);
    await jest.advanceTimersByTimeAsync(5000);
    await probing;
  };

  it("forces a reconnect only after 3 consecutive timed-out PINGs, and fails liveness after DEAD_AFTER_MS", async () => {
    const command = client();
    command.ping.mockReturnValue(new Promise(() => undefined));
    watchConsumer(worker(client(), command));
    await probeHanging(1000);
    await probeHanging(16000);
    expect(command.disconnect).not.toHaveBeenCalled();
    await probeHanging(31000);
    expect(command.disconnect).toHaveBeenCalledTimes(1);
    expect(command.disconnect).toHaveBeenCalledWith(true);
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS)).toBe(false);
  });

  it("a slow-but-alive Redis is never kicked: any reply resets the miss count", async () => {
    const command = client();
    watchConsumer(worker(client(), command));
    const hang = new Promise(() => undefined);
    for (let round = 0; round < 3; round++) {
      command.ping.mockReturnValue(hang);
      await probeHanging(1000 + round * 60000);
      await probeHanging(16000 + round * 60000);
      command.ping.mockResolvedValue("PONG");
      await probeConsumers(31000 + round * 60000);
    }
    expect(command.disconnect).not.toHaveBeenCalled();
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS)).toBe(true);
  });

  it("treats an error reply (LOADING, READONLY) as alive and never kicks", async () => {
    const command = client();
    command.ping.mockRejectedValue(new Error("LOADING Redis is loading the dataset in memory"));
    watchConsumer(worker(client(), command));
    for (let i = 0; i < 5; i++) await probeConsumers(1000 + i * 15000);
    expect(command.disconnect).not.toHaveBeenCalled();
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS)).toBe(true);
  });

  it("counts a client shared by several consumers once per probe", async () => {
    const command = client();
    command.ping.mockReturnValue(new Promise(() => undefined));
    watchConsumer(worker(client(), command));
    watchConsumer(worker(client(), command));
    watchConsumer(command as never);
    await probeHanging(1000);
    await probeHanging(16000);
    expect(command.ping).toHaveBeenCalledTimes(2);
    expect(command.disconnect).not.toHaveBeenCalled();
  });

  it("does not count a client that ioredis is still reconnecting", async () => {
    watchConsumer(worker(client("reconnecting"), client("reconnecting")));
    await probeConsumers(1000);
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS)).toBe(true);
  });

  it("flags a worker whose run loop stopped, but ignores paused and closing ones", async () => {
    watchConsumer(worker(client(), client(), { isRunning: () => false }));
    await probeConsumers(1000);
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS)).toBe(false);

    resetConsumerWatchdogForTests();
    watchConsumer(worker(client(), client(), { isRunning: () => false, isPaused: () => true }));
    watchConsumer(worker(client(), client(), { isRunning: () => false, closing: Promise.resolve() }));
    await probeConsumers(1000);
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS)).toBe(true);
  });

  it("revives an ended QueueEvents connection and PINGs a shared client", async () => {
    const events = client("end");
    watchConsumer({ name: "events", client: Promise.resolve(events), closing: undefined } as never);
    const shared = client();
    watchConsumer(shared as never);
    await probeConsumers(1000);
    expect(events.connect).toHaveBeenCalledTimes(1);
    expect(shared.ping).toHaveBeenCalledTimes(1);
  });

  it("never fails liveness across a long outage: end then reconnecting resets the clock", async () => {
    const blocking = client("end");
    watchConsumer(worker(blocking, client("reconnecting")));
    await probeConsumers(1000);
    blocking.status = "reconnecting";
    await probeConsumers(2000);
    expect(isConsumerHealthy(1000 + 2 * DEAD_AFTER_MS)).toBe(true);
  });

  it("does not count a client whose init promise never resolves (pod started while Redis was down)", async () => {
    const pending = new Promise(() => undefined);
    watchConsumer(worker(client(), client(), { client: pending, blockingConnection: { client: pending } }));
    const probing = probeConsumers(1000);
    await jest.advanceTimersByTimeAsync(5000);
    await probing;
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS)).toBe(true);
  });

  it("does not disconnect a client that left ready while the PING was pending", async () => {
    const command = client();
    command.ping.mockImplementation(() => {
      command.status = "reconnecting";
      return new Promise(() => undefined);
    });
    watchConsumer(worker(client(), command));
    for (let i = 0; i < 3; i++) {
      command.status = "ready";
      await probeHanging(1000 + i * 15000);
    }
    expect(command.disconnect).not.toHaveBeenCalled();
  });

  it("flags a QueueEvents whose consume loop exited", async () => {
    watchConsumer({ name: "events", client: Promise.resolve(client()), closing: undefined, running: false } as never);
    await probeConsumers(1000);
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS)).toBe(false);
  });
});
