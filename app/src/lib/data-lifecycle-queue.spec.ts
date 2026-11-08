/** @jest-environment node */
const queue = {
  getRepeatableJobs: jest.fn(),
  removeRepeatableByKey: jest.fn(),
  upsertJobScheduler: jest.fn(),
  add: jest.fn(),
  close: jest.fn(),
};
const worker = { on: jest.fn(), close: jest.fn() };
const events = { waitUntilReady: jest.fn(), close: jest.fn(), on: jest.fn() };
const QueueEventsCtor = jest.fn((..._args: unknown[]) => events);

jest.mock("bullmq", () => ({
  Queue: jest.fn(() => queue),
  Worker: jest.fn(() => worker),
  QueueEvents: function (...args: unknown[]) {
    return QueueEventsCtor(...args);
  },
}));
jest.mock("@/lib/monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/queue", () => ({ buildRedisOptions: (o: object) => ({ host: "redis-opts", ...o }) }));

import type { Redis } from "ioredis";
import { DataLifecycleService, type CleanupStrategyConfig } from "./data-lifecycle-service";

const config = {
  entityType: "monitor_results",
  enabled: true,
  cronSchedule: "0 2 * * *",
  retentionDays: 30,
} as CleanupStrategyConfig;
const redis = {} as Redis;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  queue.getRepeatableJobs.mockResolvedValue([]);
  queue.close.mockResolvedValue(undefined);
  events.waitUntilReady.mockResolvedValue(undefined);
  events.close.mockResolvedValue(undefined);
  worker.close.mockResolvedValue(undefined);
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
