/** @jest-environment node */
const redis = { ping: jest.fn(), set: jest.fn(), del: jest.fn() };
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
const repeatable = (id: string) => ({ name: `scheduled-monitor-${id}`, key: `key:${id}` });

beforeEach(() => {
  jest.resetAllMocks();
  selects.length = 0;
  events.length = 0;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  redis.ping.mockResolvedValue("PONG");
  redis.set.mockResolvedValue("OK");
  queue.removeRepeatableByKey.mockResolvedValue(true);
});

describe("orphaned repeatable cleanup", () => {
  it("keeps a repeatable for an enabled monitor whose scheduledJobId is not written yet", async () => {
    queue.getRepeatableJobs.mockResolvedValue([repeatable(A)]);
    selects.push([{ id: A, enabled: true, scheduledJobId: null }]);
    await initializeMonitorSchedulers();
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it("removes repeatables for deleted, disabled and differently scheduled monitors only", async () => {
    queue.getRepeatableJobs.mockResolvedValue([repeatable(A), repeatable(B), repeatable(C), repeatable(D)]);
    selects.push([
      { id: A, enabled: true, scheduledJobId: A }, // same id: keep
      { id: B, enabled: false, scheduledJobId: B }, // disabled
      { id: C, enabled: true, scheduledJobId: "other" }, // different id
      // D has no row: deleted
    ]);
    await initializeMonitorSchedulers();
    expect(queue.removeRepeatableByKey.mock.calls.map(([key]) => key).sort()).toEqual(
      [`key:${B}`, `key:${C}`, `key:${D}`].sort(),
    );
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
});
