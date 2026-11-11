/** @jest-environment node */
const queue = { getRepeatableJobs: jest.fn(), removeRepeatableByKey: jest.fn(), add: jest.fn() };
const mockDeleting = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: () => mockDeleting() }) }) }) } }));
jest.mock("./queue", () => ({ getQueues: async () => ({ monitorSchedulerQueue: queue }) }));
import { removeScheduledMonitor, scheduleMonitor } from "./monitor-scheduler";

const job = { id: "m", key: "k:m", name: "scheduled-monitor-m" };
const opts = { monitorId: "m", frequencyMinutes: 5, jobData: { type: "website" } as never };

beforeEach(() => {
  jest.resetAllMocks();
  mockDeleting.mockResolvedValue([]);
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("aborted (timed-out) callers do not mutate the queue", () => {
  it("removeScheduledMonitor removes when not aborted", async () => {
    queue.getRepeatableJobs.mockResolvedValue([job]);
    expect(await removeScheduledMonitor("m", new AbortController().signal)).toBe(true);
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith("k:m");
  });

  it("removeScheduledMonitor skips the removal when aborted while the read was pending", async () => {
    const ctl = new AbortController();
    queue.getRepeatableJobs.mockImplementation(async () => {
      ctl.abort();
      return [job];
    });
    await expect(removeScheduledMonitor("m", ctl.signal)).rejects.toBeDefined();
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it("scheduleMonitor neither removes nor adds when aborted while the read was pending", async () => {
    const ctl = new AbortController();
    queue.getRepeatableJobs.mockImplementation(async () => {
      ctl.abort();
      return [job];
    });
    await expect(scheduleMonitor(opts, ctl.signal)).rejects.toBeDefined();
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("scheduleMonitor does not add when aborted after the replace", async () => {
    const ctl = new AbortController();
    queue.getRepeatableJobs.mockResolvedValue([job]);
    queue.removeRepeatableByKey.mockImplementation(async () => {
      ctl.abort();
    });
    await expect(scheduleMonitor(opts, ctl.signal)).rejects.toBeDefined();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("scheduleMonitor adds normally without a signal", async () => {
    queue.getRepeatableJobs.mockResolvedValue([]);
    expect(await scheduleMonitor(opts)).toBe("m");
    expect(queue.add).toHaveBeenCalled();
  });
});

it("refuses to schedule a monitor that is being deleted", async () => {
  mockDeleting.mockResolvedValue([{ id: "m" }]);
  await expect(scheduleMonitor(opts)).rejects.toThrow("being deleted");
});
