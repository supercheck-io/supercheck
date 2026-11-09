const txUpdateSet = jest.fn();
const execute = jest.fn();
let row: Record<string, unknown> | undefined;
const tx = {
  execute: (...a: unknown[]) => execute(...a),
  select: () => ({ from: () => ({ where: () => ({ for: async () => (row ? [row] : []) }) }) }),
  update: () => ({ set: (v: unknown) => { txUpdateSet(v); return { where: jest.fn() }; } }),
};
const dbUpdateSet = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    transaction: async (cb: (t: unknown) => unknown) => cb(tx),
    update: () => ({ set: (v: unknown) => { dbUpdateSet(v); return { where: jest.fn().mockResolvedValue(undefined) }; } }),
  },
}));
const scheduleMonitor = jest.fn();
const removeScheduledMonitor = jest.fn();
jest.mock("@/lib/monitor-scheduler", () => ({
  scheduleMonitor: (...a: unknown[]) => scheduleMonitor(...a),
  removeScheduledMonitor: (...a: unknown[]) => removeScheduledMonitor(...a),
}));
jest.mock("@/lib/queue", () => ({}));

import { reconcileMonitorSchedule } from "./monitor-schedule-reconcile";

const active = { id: "m1", status: "up", enabled: true, frequencyMinutes: 5, type: "http_request", target: "https://x.test", config: {}, scheduledJobId: "old" };

beforeEach(() => {
  jest.clearAllMocks();
  row = { ...active };
  scheduleMonitor.mockResolvedValue("sched-1");
  removeScheduledMonitor.mockResolvedValue(true);
});

it("does nothing for a monitor that no longer exists", async () => {
  row = undefined;
  await reconcileMonitorSchedule("m1", "p1");
  expect(scheduleMonitor).not.toHaveBeenCalled();
  expect(removeScheduledMonitor).not.toHaveBeenCalled();
});

it("schedules an active monitor from the committed row and stores the scheduler id", async () => {
  await reconcileMonitorSchedule("m1", "p1");
  expect(scheduleMonitor).toHaveBeenCalledWith(
    expect.objectContaining({ monitorId: "m1", frequencyMinutes: 5, jobData: expect.objectContaining({ projectId: "p1", target: "https://x.test" }) }),
    expect.any(AbortSignal),
  );
  expect(txUpdateSet).toHaveBeenCalledWith({ scheduledJobId: "sched-1" });
});

it.each([
  ["paused", { status: "paused" }],
  ["disabled", { enabled: false }],
  ["zero frequency", { frequencyMinutes: 0 }],
])("removes the job and clears the scheduler id for a %s monitor", async (_n, change) => {
  row = { ...active, ...change };
  await reconcileMonitorSchedule("m1", "p1");
  expect(removeScheduledMonitor).toHaveBeenCalledWith("old", expect.any(AbortSignal));
  expect(scheduleMonitor).not.toHaveBeenCalled();
  expect(txUpdateSet).toHaveBeenCalledWith({ scheduledJobId: null });
});

it("also searches by monitor id when the stored job id is not found", async () => {
  row = { ...active, status: "paused" };
  removeScheduledMonitor.mockResolvedValueOnce(false);
  await reconcileMonitorSchedule("m1", "p1");
  expect(removeScheduledMonitor).toHaveBeenNthCalledWith(2, "m1", expect.any(AbortSignal));
});

it("throws, writing no scheduler id, when scheduling fails (the transaction rolls back)", async () => {
  scheduleMonitor.mockRejectedValue(new Error("redis down"));
  await expect(reconcileMonitorSchedule("m1", "p1")).rejects.toThrow("redis down");
  expect(txUpdateSet).not.toHaveBeenCalled();
  // Marked unscheduled outside the rolled-back transaction, so an identical retry sees the schedule out of sync.
  expect(dbUpdateSet).toHaveBeenCalledWith({ scheduledJobId: null });
});

it("throws when removing the job fails for a paused monitor, keeping scheduledJobId", async () => {
  row = { ...active, status: "paused" };
  removeScheduledMonitor.mockRejectedValue(new Error("redis down"));
  await expect(reconcileMonitorSchedule("m1", "p1")).rejects.toThrow("redis down");
  expect(txUpdateSet).not.toHaveBeenCalled();
});
