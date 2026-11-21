/** @jest-environment node */
const makeQueue = (name: string) => ({
  name,
  getRepeatableJobs: jest.fn(),
  removeRepeatableByKey: jest.fn(),
  removeJobScheduler: jest.fn(),
  upsertJobScheduler: jest.fn(),
  add: jest.fn(),
  close: jest.fn(),
});
const queue = makeQueue("data-lifecycle-cleanup");
const urgentQueue = makeQueue("data-lifecycle-urgent");
type Processor = (job: { data: Record<string, unknown> }) => Promise<unknown>;
const processors = new Map<string, Processor>();
const makeWorker = () => ({ on: jest.fn(), close: jest.fn() });
const worker = makeWorker();
const urgentWorker = makeWorker();
const events = { waitUntilReady: jest.fn(), close: jest.fn(), on: jest.fn() };
const QueueEventsCtor = jest.fn((..._args: unknown[]) => events);

jest.mock("bullmq", () => ({
  Queue: jest.fn((name: string) => (name === "data-lifecycle-urgent" ? urgentQueue : queue)),
  Worker: jest.fn((name: string, processor: Processor) => {
    processors.set(name, processor);
    return name === "data-lifecycle-urgent" ? urgentWorker : worker;
  }),
  QueueEvents: function (...args: unknown[]) {
    return QueueEventsCtor(...args);
  },
}));
jest.mock("@/lib/monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
jest.mock("@/utils/db", () => ({ db: {} }));
const watchConsumer = jest.fn(<T,>(c: T) => c);
jest.mock("@/lib/consumer-watchdog", () => ({ watchConsumer: (c: unknown) => watchConsumer(c) }));
jest.mock("@/lib/queue", () => ({
  buildRedisOptions: (o: object) => ({ host: "redis-opts", ...o }),
  DATA_LIFECYCLE_CLEANUP_QUEUE: "data-lifecycle-cleanup",
  DATA_LIFECYCLE_URGENT_QUEUE: "data-lifecycle-urgent",
}));
const mockLock = { key: "cleanup:monitor_results:lock", token: "t-1", signal: new AbortController().signal, release: jest.fn() };
const mockAcquire = jest.fn();
jest.mock("@/lib/cleanup-lock", () => ({ acquireOwnedLock: (...args: unknown[]) => mockAcquire(...args) }));

import type { Redis } from "ioredis";
import { DataLifecycleService, redisCursorStore, URGENT_CLEANUP_ENTITY_TYPES, type CleanupEntityType, type CleanupStrategyConfig, type ICleanupStrategy } from "./data-lifecycle-service";

const config = {
  entityType: "monitor_results",
  enabled: true,
  cronSchedule: "0 2 * * *",
  retentionDays: 30,
} as CleanupStrategyConfig;
const redis = {} as Redis;

beforeEach(() => {
  jest.clearAllMocks();
  processors.clear();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  for (const q of [queue, urgentQueue]) {
    q.getRepeatableJobs.mockResolvedValue([]);
    q.close.mockResolvedValue(undefined);
    q.removeJobScheduler.mockResolvedValue(false);
  }
  events.waitUntilReady.mockResolvedValue(undefined);
  events.close.mockResolvedValue(undefined);
  worker.close.mockResolvedValue(undefined);
  urgentWorker.close.mockResolvedValue(undefined);
  mockLock.release.mockResolvedValue(undefined);
  mockAcquire.mockResolvedValue(mockLock);
});

describe("repeat setup", () => {
  it("upserts a stable scheduler and never uses the legacy repeat add", async () => {
    await new DataLifecycleService([config]).initialize(redis);

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      "monitor_results-cleanup",
      { pattern: "0 2 * * *" },
      expect.objectContaining({
        name: "monitor_results-cleanup",
        data: expect.objectContaining({ entityType: "monitor_results", manual: false, dryRun: false, config }),
      }),
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it("removes only the legacy repeatable, keeping the scheduler entry", async () => {
    queue.getRepeatableJobs.mockResolvedValue([
      { name: "monitor_results-cleanup", key: "legacyhash" },
      { name: "monitor_results-cleanup", key: "monitor_results-cleanup" },
      { name: "other-cleanup", key: "otherhash" },
    ]);
    await new DataLifecycleService([config]).initialize(redis);

    expect(queue.removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith("legacyhash");
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy repeatable when the upsert fails", async () => {
    queue.getRepeatableJobs.mockResolvedValue([{ name: "monitor_results-cleanup", key: "legacyhash" }]);
    queue.upsertJobScheduler.mockRejectedValueOnce(new Error("redis"));
    await new DataLifecycleService([config]).initialize(redis);
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it("is idempotent across replica starts", async () => {
    const service = new DataLifecycleService([config]);
    await service.initialize(redis);
    await new DataLifecycleService([config]).initialize(redis);
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
  });
});

describe("consumer watchdog", () => {
  it("watches the cleanup Worker at startup and the lazily created QueueEvents", async () => {
    queue.add.mockResolvedValue({ waitUntilFinished: jest.fn().mockResolvedValue({ success: true }) });
    const service = new DataLifecycleService([config]);
    await service.initialize(redis);
    expect(watchConsumer).toHaveBeenCalledTimes(2);
    expect(watchConsumer).toHaveBeenCalledWith(worker);
    expect(watchConsumer).toHaveBeenCalledWith(urgentWorker);

    await service.triggerManualCleanup("monitor_results");
    await service.triggerManualCleanup("monitor_results");
    expect(watchConsumer).toHaveBeenCalledTimes(3);
    expect(watchConsumer).toHaveBeenLastCalledWith(events);
  });
});

describe("QueueEvents", () => {
  it("is not created at startup", async () => {
    await new DataLifecycleService([config]).initialize(redis);
    expect(QueueEventsCtor).not.toHaveBeenCalled();
  });

  it("is created lazily once, awaited ready before the job is added, and reused", async () => {
    const order: string[] = [];
    events.waitUntilReady.mockImplementation(async () => void order.push("ready"));
    const result = { success: true };
    queue.add.mockImplementation(async () => {
      order.push("add");
      return { waitUntilFinished: jest.fn().mockResolvedValue(result) };
    });
    const service = new DataLifecycleService([config]);
    await service.initialize(redis);

    await expect(service.triggerManualCleanup("monitor_results")).resolves.toBe(result);
    await service.triggerManualCleanup("monitor_results", true);

    expect(QueueEventsCtor).toHaveBeenCalledTimes(1);
    // Its own connection options (BullMQ owns and quits it), never the shared client, plus an error listener.
    expect(QueueEventsCtor).toHaveBeenCalledWith("data-lifecycle-cleanup", { connection: { host: "redis-opts", lazyConnect: false } });
    expect(events.on).toHaveBeenCalledWith("error", expect.any(Function));
    const onError = events.on.mock.calls.find(([name]) => name === "error")![1] as (e: Error) => void;
    expect(() => onError(new Error("redis down"))).not.toThrow(); // logged, never an unhandled 'error' event
    expect(order.slice(0, 2)).toEqual(["ready", "add"]);
  });

  it("does not cache a QueueEvents that failed to become ready", async () => {
    const service = new DataLifecycleService([config]);
    await service.initialize(redis);
    events.waitUntilReady.mockRejectedValueOnce(new Error("no redis"));
    await expect(service.triggerManualCleanup("monitor_results")).rejects.toThrow("no redis");
    expect(events.close).toHaveBeenCalledTimes(1);

    queue.add.mockResolvedValue({ waitUntilFinished: jest.fn().mockResolvedValue({}) });
    await service.triggerManualCleanup("monitor_results");
    expect(QueueEventsCtor).toHaveBeenCalledTimes(2);
  });

  it("is closed at shutdown once created, and shutdown tolerates a close failure", async () => {
    queue.add.mockResolvedValue({ waitUntilFinished: jest.fn().mockResolvedValue({}) });
    const service = new DataLifecycleService([config]);
    await service.initialize(redis);
    await service.triggerManualCleanup("monitor_results");
    events.close.mockRejectedValue(new Error("boom"));

    await expect(service.shutdown()).resolves.toBeUndefined();
    expect(events.close).toHaveBeenCalledTimes(1);
    expect(queue.close).toHaveBeenCalledTimes(1);
    expect(worker.close).toHaveBeenCalledTimes(1);
  });

  it("fails, closes and does not cache a QueueEvents that never becomes ready", async () => {
    jest.useFakeTimers();
    try {
      const service = new DataLifecycleService([config]);
      await service.initialize(redis);
      events.waitUntilReady.mockReturnValueOnce(new Promise(() => {}));
      events.close.mockReturnValueOnce(new Promise(() => {})); // close of a never-connected client can hang too
      const pending = service.triggerManualCleanup("monitor_results");
      const assertion = expect(pending).rejects.toThrow("not ready");
      await jest.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(events.close).toHaveBeenCalledTimes(1);
      expect(queue.add).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("a timed-out caller does not evict a fresh instance another caller cached meanwhile", async () => {
    jest.useFakeTimers();
    try {
      QueueEventsCtor.mockImplementation(() => ({ ...events })); // a distinct instance per construction
      const service = new DataLifecycleService([config]);
      await service.initialize(redis);
      events.waitUntilReady.mockReturnValueOnce(new Promise(() => {})).mockReturnValueOnce(new Promise(() => {}));
      const a = expect(service.triggerManualCleanup("monitor_results")).rejects.toThrow("not ready");
      await jest.advanceTimersByTimeAsync(5_000);
      const b = expect(service.triggerManualCleanup("monitor_results")).rejects.toThrow("not ready");
      await jest.advanceTimersByTimeAsync(5_000); // A times out and evicts the shared instance
      queue.add.mockResolvedValue({ waitUntilFinished: jest.fn().mockResolvedValue({}) });
      await service.triggerManualCleanup("monitor_results"); // C caches a fresh one
      await jest.advanceTimersByTimeAsync(5_000); // B times out later
      await a;
      await b;
      const created = QueueEventsCtor.mock.calls.length;
      await service.triggerManualCleanup("monitor_results");
      expect(QueueEventsCtor).toHaveBeenCalledTimes(created); // C's instance is still cached, not leaked
    } finally {
      jest.useRealTimers();
      QueueEventsCtor.mockImplementation(() => events);
    }
  });

  it("shutdown without a manual run closes no QueueEvents, and manual cleanup is rejected afterwards", async () => {
    const service = new DataLifecycleService([config]);
    await service.initialize(redis);
    await service.shutdown();
    expect(events.close).not.toHaveBeenCalled();
    await expect(service.triggerManualCleanup("monitor_results")).rejects.toThrow("not initialized");
  });

  it("rejects an unknown entity type before creating QueueEvents", async () => {
    const service = new DataLifecycleService([config]);
    await service.initialize(redis);
    await expect(service.triggerManualCleanup("audit_logs")).rejects.toThrow("No strategy");
    expect(QueueEventsCtor).not.toHaveBeenCalled();
  });
});

describe("urgent queue split", () => {
  const urgent = (entityType: CleanupEntityType) =>
    ({ entityType, enabled: true, cronSchedule: "*/2 * * * *" }) as CleanupStrategyConfig;

  it("lists trial lifecycle, deletion sweep and credential revocation retry as urgent", () => {
    expect([...URGENT_CLEANUP_ENTITY_TYPES].sort()).toEqual(["credential_revocation_retry", "deletion_sweep", "trial_lifecycle"]);
  });

  it.each(["trial_lifecycle", "deletion_sweep", "credential_revocation_retry"] as CleanupEntityType[])(
    "schedules %s on the urgent queue and removes its scheduler from the heavy queue",
    async (entityType) => {
      await new DataLifecycleService([urgent(entityType)]).initialize(redis);
      expect(urgentQueue.upsertJobScheduler).toHaveBeenCalledWith(`${entityType}-cleanup`, { pattern: "*/2 * * * *" }, expect.anything());
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(`${entityType}-cleanup`);
    },
  );

  it("keeps heavy strategies on the heavy queue and never removes their scheduler", async () => {
    await new DataLifecycleService([config]).initialize(redis);
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(urgentQueue.upsertJobScheduler).not.toHaveBeenCalled();
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it("does not remove the old scheduler when the urgent upsert fails", async () => {
    urgentQueue.upsertJobScheduler.mockRejectedValueOnce(new Error("redis"));
    await new DataLifecycleService([urgent("deletion_sweep")]).initialize(redis);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it("runs each queue one job at a time, so a second job of a strategy waits instead of being skipped", async () => {
    const { Worker } = jest.requireMock("bullmq") as { Worker: jest.Mock };
    await new DataLifecycleService([config]).initialize(redis);
    const concurrency = Object.fromEntries(Worker.mock.calls.map(([name, , opts]) => [name, opts.concurrency]));
    expect(concurrency).toEqual({ "data-lifecycle-cleanup": 1, "data-lifecycle-urgent": 1 });
  });

  it("manual cleanup of an urgent strategy goes to the urgent queue with its own QueueEvents", async () => {
    urgentQueue.add.mockResolvedValue({ waitUntilFinished: jest.fn().mockResolvedValue({ success: true }) });
    const service = new DataLifecycleService([urgent("deletion_sweep")]);
    await service.initialize(redis);
    await service.triggerManualCleanup("deletion_sweep");
    expect(urgentQueue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();
    expect(QueueEventsCtor).toHaveBeenCalledWith("data-lifecycle-urgent", expect.anything());
  });

  it("shutdown closes both workers and both queues", async () => {
    const service = new DataLifecycleService([config]);
    await service.initialize(redis);
    await service.shutdown();
    for (const closable of [worker, urgentWorker, queue, urgentQueue]) expect(closable.close).toHaveBeenCalledTimes(1);
  });
});

describe("cleanup job processor", () => {
  function serviceWith(execute: ICleanupStrategy["execute"], entityType: CleanupEntityType = "monitor_results") {
    const service = new DataLifecycleService([]);
    const strategy = { entityType, config: { ...config, entityType }, execute, validate: () => {}, getStats: jest.fn() } as ICleanupStrategy;
    (service as unknown as { strategies: Map<CleanupEntityType, ICleanupStrategy> }).strategies.set(entityType, strategy);
    return service;
  }
  const ok = { success: true, entityType: "monitor_results", recordsDeleted: 1, duration: 0, errors: [], details: {} };

  it("runs a strategy under its owned lock, passes the abort signal and a cursor store, and releases the lock", async () => {
    const execute = jest.fn().mockResolvedValue(ok);
    await serviceWith(execute).initialize(redis);
    await expect(processors.get("data-lifecycle-cleanup")!({ data: { entityType: "monitor_results" } })).resolves.toBe(ok);
    expect(mockAcquire).toHaveBeenCalledWith(redis, "cleanup:monitor_results:lock", { ttlMs: 45 * 60_000, renewEveryMs: 5 * 60_000, maxHoldMs: 50 * 60_000 });
    expect(execute).toHaveBeenCalledWith(false, { signal: mockLock.signal, cursor: expect.objectContaining({ get: expect.any(Function), set: expect.any(Function) }) });
    expect(mockLock.release).toHaveBeenCalledTimes(1);
  });

  it("the heavy worker still runs an urgent job an older replica scheduled there", async () => {
    const execute = jest.fn().mockResolvedValue({ ...ok, entityType: "trial_lifecycle" });
    await serviceWith(execute, "trial_lifecycle").initialize(redis);
    await processors.get("data-lifecycle-cleanup")!({ data: { entityType: "trial_lifecycle" } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("skips without running when another owner holds the lock", async () => {
    mockAcquire.mockResolvedValue(null);
    const execute = jest.fn();
    await serviceWith(execute).initialize(redis);
    await expect(processors.get("data-lifecycle-cleanup")!({ data: { entityType: "monitor_results" } })).resolves.toEqual(
      expect.objectContaining({ success: true, details: expect.objectContaining({ skipped: true }) }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails (so BullMQ retries) when acquiring the lock errors, without running", async () => {
    mockAcquire.mockRejectedValue(new Error("redis down"));
    const execute = jest.fn();
    await serviceWith(execute).initialize(redis);
    await expect(processors.get("data-lifecycle-cleanup")!({ data: { entityType: "monitor_results" } })).rejects.toThrow("redis down");
    expect(execute).not.toHaveBeenCalled();
  });

  it("a partial run is a success; a failed run throws and still releases the lock", async () => {
    const execute = jest.fn()
      .mockResolvedValueOnce({ ...ok, details: { partial: true } })
      .mockResolvedValueOnce({ ...ok, success: false, errors: ["boom"] });
    await serviceWith(execute).initialize(redis);
    const run = processors.get("data-lifecycle-cleanup")!;
    await expect(run({ data: { entityType: "monitor_results" } })).resolves.toEqual(expect.objectContaining({ details: { partial: true } }));
    await expect(run({ data: { entityType: "monitor_results" } })).rejects.toThrow("boom");
    expect(mockLock.release).toHaveBeenCalledTimes(2);
  });

  it("rejects an entity type with no strategy", async () => {
    await serviceWith(jest.fn()).initialize(redis);
    await expect(processors.get("data-lifecycle-cleanup")!({ data: { entityType: "audit_logs" } })).rejects.toThrow("No strategy");
  });

  it("runs without a lock or cursor when the service has no Redis connection", async () => {
    const execute = jest.fn().mockResolvedValue(ok);
    const service = serviceWith(execute);
    const run = (service as unknown as { runCleanupJob: (data: { entityType: CleanupEntityType }) => Promise<unknown> }).runCleanupJob.bind(service);
    await expect(run({ entityType: "monitor_results" })).resolves.toBe(ok);
    expect(mockAcquire).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(false, { signal: undefined, cursor: undefined });
  });

  it("logs completed jobs that carry errors and failed jobs", async () => {
    await serviceWith(jest.fn()).initialize(redis);
    const handler = (name: string) => worker.on.mock.calls.find(([event]) => event === name)![1] as (...args: unknown[]) => void;
    handler("completed")({ id: "1" }, { ...ok, errors: ["S3 failures"] });
    handler("completed")({ id: "2" }, ok);
    handler("failed")({ id: "3" }, new Error("boom"));
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("redisCursorStore", () => {
  it("reads, and writes or clears only through the lock-fenced script", async () => {
    const client = { get: jest.fn().mockResolvedValue("org-1"), eval: jest.fn() };
    const store = redisCursorStore(client as unknown as Redis, { key: "cleanup:x:lock", token: "t-1" });
    await expect(store.get("k")).resolves.toBe("org-1");
    await store.set("k", "org-2");
    expect(client.eval).toHaveBeenCalledWith(expect.stringContaining('"get", KEYS[1]'), 2, "cleanup:x:lock", "k", "t-1", "org-2", String(7 * 24 * 3600));
    await store.set("k", null);
    expect(client.eval).toHaveBeenLastCalledWith(expect.any(String), 2, "cleanup:x:lock", "k", "t-1", "", String(7 * 24 * 3600));
  });
});
