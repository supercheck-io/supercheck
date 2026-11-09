/** @jest-environment node */
const redis = { ping: jest.fn(), set: jest.fn(), eval: jest.fn() };
const queue = {
  getRepeatableJobs: jest.fn(),
  removeRepeatableByKey: jest.fn(),
  add: jest.fn(),
  client: Promise.resolve(redis),
};
const selects: unknown[][] = [];
const events: string[] = [];

jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          events.push("select");
          return selects.shift() ?? [];
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));
jest.mock("./queue", () => ({ getQueues: async () => ({ monitorSchedulerQueue: queue }) }));

import { initializeMonitorSchedulers } from "./monitor-scheduler";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const D = "44444444-4444-4444-4444-444444444444";
const activeRow = (id: string, frequencyMinutes = 1) => ({ id, projectId: "p", type: "http_request", target: "t", config: {}, frequencyMinutes, enabled: true, status: "up" });
const repeatable = (id: string, minutes = 1, key = `key:${id}`) => ({ name: `scheduled-monitor-${id}`, key, every: String(minutes * 60_000), pattern: null });

beforeEach(() => {
  jest.resetAllMocks();
  selects.length = 0;
  events.length = 0;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  redis.ping.mockResolvedValue("PONG");
  redis.set.mockResolvedValue("OK");
  redis.eval.mockResolvedValue(1);
  queue.removeRepeatableByKey.mockResolvedValue(true);
queue.getRepeatableJobs.mockResolvedValue([]);
});

describe("orphaned repeatable cleanup", () => {
  it("keeps a repeatable for an enabled monitor whose scheduledJobId is not written yet", async () => {
    queue.getRepeatableJobs.mockResolvedValue([repeatable(A)]);
    selects.push([{ id: A, enabled: true, status: "up", scheduledJobId: null, type: "http_request", frequencyMinutes: 1 }]);
    await initializeMonitorSchedulers();
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it("removes repeatables for deleted, disabled and differently scheduled monitors only", async () => {
    queue.getRepeatableJobs.mockResolvedValue([repeatable(A), repeatable(B), repeatable(C), repeatable(D)]);
    selects.push([
      { id: A, enabled: true, status: "up", scheduledJobId: A, type: "http_request", frequencyMinutes: 1 }, // same id: keep
      { id: B, enabled: false, status: "up", scheduledJobId: B, type: "http_request", frequencyMinutes: 1 }, // disabled
      { id: C, enabled: true, status: "up", scheduledJobId: "other", type: "http_request", frequencyMinutes: 1 }, // different id
      // D has no row: deleted
    ]);
    await initializeMonitorSchedulers();
    expect(queue.removeRepeatableByKey.mock.calls.map(([key]) => key).sort()).toEqual(
      [`key:${B}`, `key:${C}`, `key:${D}`].sort(),
    );
  });

  it("removes the repeatable of a paused monitor", async () => {
    queue.getRepeatableJobs.mockResolvedValue([repeatable(A)]);
    selects.push([{ id: A, enabled: true, status: "paused", scheduledJobId: A }]);
    await initializeMonitorSchedulers();
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith(`key:${A}`);
  });

  it("re-adds a monitor resumed between the cleanup read and its removal: the active read runs after removal", async () => {
    queue.getRepeatableJobs.mockResolvedValue([repeatable(A)]);
    queue.removeRepeatableByKey.mockImplementation(async () => void events.push("remove"));
    queue.add.mockImplementation(async () => void events.push("add"));
    selects.push(
      [{ id: A, enabled: true, status: "paused", scheduledJobId: A }], // cleanup saw it paused
      [activeRow(A)], // resume committed
      [activeRow(A)], // per-monitor re-read
    );
    await initializeMonitorSchedulers();
    expect(events).toEqual(["select", "remove", "select", "select", "add"]);
  });

  it("releases its tokenised lock with compare-and-delete, also when no monitor is active", async () => {
    await initializeMonitorSchedulers();
    const [script, , key, token] = redis.eval.mock.calls[0];
    expect(script).toContain("redis.call('get'");
    expect(key).toBe("monitor:scheduler:init:lock");
    expect(redis.set).toHaveBeenCalledWith(key, token, "EX", 120, "NX");
  });

  it("leaves repeatables whose name is not a monitor schedule alone and skips the lookup when none exist", async () => {
    queue.getRepeatableJobs.mockResolvedValue([{ name: "something-else", key: "k" }]);
    await initializeMonitorSchedulers();
    expect(events).toEqual(["select"]); // only the active-monitor query
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it("does not touch the queue when another replica holds the init lock", async () => {
    redis.set.mockResolvedValue(null);
    await expect(initializeMonitorSchedulers()).resolves.toEqual({ success: true, scheduled: 0, failed: 0 });
    expect(queue.getRepeatableJobs).not.toHaveBeenCalled();
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it("takes the lock before reading repeatables, and a cleanup failure does not block init", async () => {
    queue.getRepeatableJobs.mockImplementation(async () => {
      events.push("getRepeatableJobs");
      throw new Error("redis down");
    });
    redis.set.mockImplementation(async () => {
      events.push("lock");
      return "OK";
    });
    await expect(initializeMonitorSchedulers()).resolves.toMatchObject({ success: true });
    expect(events.slice(0, 2)).toEqual(["lock", "getRepeatableJobs"]);
    expect(events).toContain("select"); // init continued to the active-monitor query
  });

  it("removes duplicate and stale-cadence repeatables of an enabled monitor, keeping one at its current cadence", async () => {
    queue.getRepeatableJobs.mockResolvedValue([repeatable(A, 1), repeatable(A, 5, "key:A-old"), repeatable(A, 1, "key:A-dup")]);
    selects.push([{ id: A, enabled: true, status: "up", scheduledJobId: A, type: "http_request", frequencyMinutes: 1 }]);
    await initializeMonitorSchedulers();
    expect(queue.removeRepeatableByKey.mock.calls.map(([key]) => key).sort()).toEqual(["key:A-dup", "key:A-old"]);
  });

  it("applies the synthetic frequency floor when judging the cadence", async () => {
    queue.getRepeatableJobs.mockResolvedValue([repeatable(A, 5)]);
    selects.push([{ id: A, enabled: true, status: "up", scheduledJobId: A, type: "synthetic_test", frequencyMinutes: 1 }]);
    await initializeMonitorSchedulers();
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
  });
});

describe("init sync against concurrent edits", () => {
  it("schedules from the current row when the frequency changed after the active list was read", async () => {
    selects.push([activeRow(A, 1)], [activeRow(A, 15)]);
    await initializeMonitorSchedulers();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][2].repeat.every).toBe(15 * 60_000);
  });

  it("does not schedule a monitor paused, disabled or deleted after the list was read", async () => {
    selects.push([activeRow(A), activeRow(B), activeRow(C)], [{ ...activeRow(A), status: "paused" }], [{ ...activeRow(B), enabled: false }], []);
    await initializeMonitorSchedulers();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("renews the init lock during a long sync and stops when it was lost", async () => {
    jest.useFakeTimers({ now: 0 });
    try {
      selects.push([activeRow(A), activeRow(B)], [activeRow(A)], [activeRow(B)]);
      queue.add.mockImplementation(async () => void jest.setSystemTime(Date.now() + 40_000));
      await initializeMonitorSchedulers();
      const renewal = redis.eval.mock.calls.find(([script]) => String(script).includes("expire"));
      expect(renewal?.slice(2, 3)).toEqual(["monitor:scheduler:init:lock"]);
      expect(renewal?.[4]).toBe(120);

      jest.resetAllMocks();
      redis.ping.mockResolvedValue("PONG");
      redis.set.mockResolvedValue("OK");
      redis.eval.mockResolvedValue(0); // lock lost
      queue.removeRepeatableByKey.mockResolvedValue(true);
      jest.spyOn(console, "warn").mockImplementation(() => {});
      selects.push([activeRow(A), activeRow(B)], [activeRow(A)], [activeRow(B)]);
      queue.getRepeatableJobs.mockResolvedValue([]);
      queue.add.mockImplementation(async () => void jest.setSystemTime(Date.now() + 40_000));
      await initializeMonitorSchedulers();
      expect(queue.add).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
