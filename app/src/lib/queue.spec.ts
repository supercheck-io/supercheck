/** @jest-environment node */
import { EventEmitter } from "node:events";

describe("queue location refresh", () => {
  let enabledCodes: string[];
  let databaseError: boolean;
  let queueModule: typeof import("./queue");
  let subscribers: EventEmitter[];
  let subscriptionError: boolean;
  let jobCounts: Map<string, Record<string, number>>;
  const scan = jest.fn();
  const publish = jest.fn().mockResolvedValue(0);
  const setupCapacityManagement = jest.fn().mockResolvedValue(undefined);
  const invalidateQueueEventHub = jest.fn().mockResolvedValue(undefined);
  const invalidateBullBoard = jest.fn();

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(process, "once").mockReturnValue(process);
    Reflect.deleteProperty(globalThis, "__SUPERCHECK_QUEUE_SINGLETON__");
    enabledCodes = ["eu-central"];
    databaseError = false;
    subscribers = [];
    subscriptionError = false;
    jobCounts = new Map();
    scan.mockResolvedValue(["0", []]);
    jest.doMock("ioredis", () => ({
      __esModule: true,
      default: class extends EventEmitter {
        status = "ready";
        constructor() {
          super();
          Promise.resolve().then(() => this.emit("ready"));
        }
        duplicate() {
          const subscriber = new EventEmitter();
          Object.assign(subscriber, {
            subscribe: jest.fn(async () => {
              if (subscriptionError) throw new Error("subscription unavailable");
              return 1;
            }),
            status: "ready",
            unsubscribe: jest.fn().mockResolvedValue(0),
            quit: jest.fn().mockResolvedValue("OK"),
            disconnect: jest.fn(),
          });
          subscribers.push(subscriber);
          return subscriber;
        }
        scan = scan;
        publish = publish;
        quit = jest.fn().mockResolvedValue("OK");
      },
    }));
    jest.doMock("bullmq", () => ({
      Queue: class extends EventEmitter {
        constructor(public name: string, public opts: object) { super(); }
        close = jest.fn().mockResolvedValue(undefined);
        clean = jest.fn().mockResolvedValue([]);
        trimEvents = jest.fn().mockResolvedValue(0);
        getJobCounts = jest.fn(async () => jobCounts.get(this.name) ?? { active: 0, waiting: 0, delayed: 0 });
      },
      QueueEvents: class extends EventEmitter {
        constructor(public name: string) { super(); }
        close = jest.fn().mockResolvedValue(undefined);
      },
    }));
    jest.doMock("./location-registry", () => ({
      getAllEnabledLocationCodes: jest.fn(async () => {
        if (databaseError) throw new Error("database unavailable");
        return [...enabledCodes];
      }),
      invalidateLocationCache: jest.fn(),
    }));
    jest.doMock("./logger/index", () => ({ createLogger: () => ({
      debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    }) }));
    jest.doMock("./capacity-manager", () => ({
      setupCapacityManagement,
      reconcileCapacityCounters: jest.fn().mockResolvedValue(undefined),
      resetCapacityManager: jest.fn(),
    }));
    jest.doMock("./scheduler", () => ({
      initializeSchedulerWorkers: jest.fn().mockResolvedValue(undefined),
      shutdownSchedulerWorkers: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock("./queue-event-hub", () => ({ invalidateQueueEventHub }));
    jest.doMock("./bull-board/state", () => ({ invalidateBullBoard }));
    jest.doMock("./monitor-location-routing", () => ({}));
    queueModule = await import("./queue");
  });

  afterEach(async () => {
    await queueModule.closeQueue();
    jest.useRealTimers();
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "__SUPERCHECK_QUEUE_SINGLETON__");
  });

  it("adds locations while preserving global, scheduler, and existing regional clients", async () => {
    const original = await queueModule.getQueues();
    const euQueue = original.k6Queues["eu-central"];
    enabledCodes.push("us-east", "asia-pacific");
    await queueModule.invalidateQueueMaps();
    const current = await queueModule.getQueues();
    expect(Object.keys(current.monitorExecutionQueue).sort()).toEqual(enabledCodes.slice().sort());
    expect(current.playwrightQueues.global).toBe(original.playwrightQueues.global);
    expect(current.jobSchedulerQueue).toBe(original.jobSchedulerQueue);
    expect(current.k6Queues["eu-central"]).toBe(euQueue);
    expect(euQueue.close).not.toHaveBeenCalled();
    expect(setupCapacityManagement.mock.calls[1][1].playwrightEvents).toEqual({});
    expect(Object.keys(setupCapacityManagement.mock.calls[1][1].k6Events)).toEqual(["us-east", "asia-pacific"]);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("waits for overlapping refreshes before returning queue clients", async () => {
    const original = await queueModule.getQueues();
    const removed = original.monitorExecutionQueue["eu-central"];
    let finishClose!: () => void;
    jest.mocked(removed.close).mockImplementation(() => new Promise<void>((resolve) => { finishClose = resolve; }));
    enabledCodes = ["us-east"];
    const refresh = queueModule.invalidateQueueMaps({ publish: false });
    const secondRefresh = queueModule.invalidateQueueMaps({ publish: false });
    let returned = false;
    const request = queueModule.getQueues().then((queues) => { returned = true; return queues; });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(returned).toBe(false);
    finishClose();
    await Promise.all([refresh, secondRefresh]);
    const current = await request;
    expect(Object.keys(current.monitorExecutionQueue)).toEqual(["us-east"]);
    expect(removed.close).toHaveBeenCalledTimes(1);
  });

  it("retains disabled k6 jobs for capacity tracking and reuses their clients on re-enable", async () => {
    const original = await queueModule.getQueues();
    const euQueue = original.k6Queues["eu-central"];
    jest.mocked(euQueue.getJobCounts).mockResolvedValue({ active: 1, waiting: 1, delayed: 1 });
    enabledCodes = [];
    await queueModule.invalidateQueueMaps({ publish: false });
    expect((await queueModule.getQueues()).k6Queues["eu-central"]).toBeUndefined();
    expect((await queueModule.getCapacityQueues()).k6Queues["eu-central"]).toBe(euQueue);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(euQueue.close).not.toHaveBeenCalled();
    enabledCodes = ["eu-central"];
    await queueModule.invalidateQueueMaps({ publish: false });
    expect((await queueModule.getQueues()).k6Queues["eu-central"]).toBe(euQueue);
    expect(setupCapacityManagement).toHaveBeenCalledTimes(1);
  });

  it("closes retired capacity clients once admitted work is drained", async () => {
    const euQueue = (await queueModule.getQueues()).k6Queues["eu-central"];
    enabledCodes = [];
    await queueModule.invalidateQueueMaps({ publish: false });
    expect(euQueue.close).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(euQueue.close).toHaveBeenCalledTimes(1);
    expect((await queueModule.getCapacityQueues()).k6Queues["eu-central"]).toBeUndefined();
  });

  it("restores disabled-region admitted work for capacity accounting after an app restart", async () => {
    enabledCodes = ["us-east"];
    scan.mockResolvedValue(["0", ["bull:k6-eu-central:wait"]]);
    jobCounts.set("k6-eu-central", { active: 1, waiting: 1, delayed: 1 });
    const queues = await queueModule.getQueues();
    expect(queues.k6Queues["eu-central"]).toBeUndefined();
    const retained = (await queueModule.getCapacityQueues()).k6Queues["eu-central"];
    expect(retained).toBeDefined();
    expect(setupCapacityManagement.mock.calls[0][0].k6Queues["eu-central"]).toBe(retained);
    expect(setupCapacityManagement.mock.calls[0][1].k6Events["eu-central"]).toBeDefined();
  });

  it("applies a remote notification without publishing it again", async () => {
    await queueModule.getQueues();
    await Promise.resolve();
    enabledCodes.push("us-east");
    const subscriber = subscribers.find((candidate) => candidate.listenerCount("message"));
    expect(subscriber).toBeDefined();
    subscriber!.emit("message", queueModule.QUEUE_REFRESH_CHANNEL, JSON.stringify({ origin: "another-replica" }));
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(Object.keys((await queueModule.getQueues()).monitorExecutionQueue)).toEqual(enabledCodes);
    expect(invalidateQueueEventHub).toHaveBeenCalled();
    expect(invalidateBullBoard).toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("retains healthy execution clients when a concurrent refresh cannot read the database", async () => {
    const original = await queueModule.getQueues();
    databaseError = true;
    const refresh = queueModule.invalidateQueueMaps({ publish: false });
    const request = queueModule.getQueues();
    await expect(refresh).rejects.toThrow("database unavailable");
    const current = await request;
    expect(current.playwrightQueues.global).toBe(original.playwrightQueues.global);
    expect(current.k6Queues["eu-central"]).toBe(original.k6Queues["eu-central"]);
    expect(current.playwrightQueues.global.close).not.toHaveBeenCalled();
  });

  it("reconciles a missed enable message after every location was disabled", async () => {
    enabledCodes = [];
    await queueModule.getQueues();
    enabledCodes = ["us-east"];
    await jest.advanceTimersByTimeAsync(15_000);
    expect(Object.keys((await queueModule.getQueues()).monitorExecutionQueue)).toEqual(["us-east"]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("closes a failed subscriber and retries without disabling reconciliation", async () => {
    subscriptionError = true;
    await queueModule.getQueues();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect((subscribers[0] as EventEmitter & { disconnect: jest.Mock }).disconnect).toHaveBeenCalled();
    subscriptionError = false;
    enabledCodes = ["us-east"];
    await jest.advanceTimersByTimeAsync(15_000);
    expect(subscribers).toHaveLength(2);
    expect(Object.keys((await queueModule.getQueues()).monitorExecutionQueue)).toEqual(["us-east"]);
  });

  it("replaces a permanently ended subscription on the next reconciliation tick", async () => {
    await queueModule.getQueues();
    Object.assign(subscribers[0], { status: "end" });
    await jest.advanceTimersByTimeAsync(15_000);
    expect(subscribers).toHaveLength(2);
    expect(subscribers[1].listenerCount("message")).toBe(1);
  });

  it("disconnects an offline refresh subscriber without waiting on Redis commands at shutdown", async () => {
    await queueModule.getQueues();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const subscriber = subscribers[0] as EventEmitter & {
      unsubscribe: jest.Mock; quit: jest.Mock; disconnect: jest.Mock;
    };
    subscriber.unsubscribe.mockReturnValue(new Promise(() => {}));
    subscriber.quit.mockReturnValue(new Promise(() => {}));
    await queueModule.closeQueue();
    expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
    expect(subscriber.unsubscribe).not.toHaveBeenCalled();
    expect(subscriber.quit).not.toHaveBeenCalled();
  });

  it("recovers from a startup database outage without exhausting a retry budget", async () => {
    databaseError = true;
    await queueModule.getQueues();
    await jest.advanceTimersByTimeAsync(600_000);
    databaseError = false;
    await jest.advanceTimersByTimeAsync(15_000);
    expect(Object.keys((await queueModule.getQueues()).monitorExecutionQueue)).toEqual(["eu-central"]);
  });

  it("shares queue clients across separately loaded server modules", async () => {
    const first = await queueModule.getQueues();
    jest.resetModules();
    queueModule = await import("./queue");
    const second = await queueModule.getQueues();
    expect(second.playwrightQueues.global).toBe(first.playwrightQueues.global);
    expect(second.redisConnection).toBe(first.redisConnection);
  });
});
