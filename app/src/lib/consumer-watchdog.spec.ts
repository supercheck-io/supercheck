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

  it("forces a reconnect when a ready command client stops answering", async () => {
    const command = client();
    command.ping.mockReturnValue(new Promise(() => undefined));
    watchConsumer(worker(client(), command));
    const probing = probeConsumers(1000);
    await jest.advanceTimersByTimeAsync(5000);
    await probing;
    expect(command.disconnect).toHaveBeenCalledWith(true);
    expect(isConsumerHealthy(1000 + DEAD_AFTER_MS)).toBe(false);
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
});
