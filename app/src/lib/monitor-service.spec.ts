jest.mock("@/utils/db", () => ({
  db: {
    query: { monitors: { findFirst: jest.fn() } },
    update: jest.fn(),
  },
}));
jest.mock("@/lib/queue", () => ({ addMonitorExecutionJobToQueue: jest.fn() }));
jest.mock("@/lib/monitor-scheduler", () => ({
  scheduleMonitor: jest.fn(),
  deleteScheduledMonitor: jest.fn(),
}));
import { db } from "@/utils/db";
import {
  scheduleMonitor,
  deleteScheduledMonitor,
} from "@/lib/monitor-scheduler";
import { updateMonitorHandler } from "./monitor-service";

describe("updateMonitorHandler schedule synchronization", () => {
  const existing = {
    id: "monitor-1",
    projectId: "project-1",
    type: "http_request",
    target: "https://example.com",
    config: {},
    frequencyMinutes: 5,
    enabled: true,
    status: "up",
    scheduledJobId: "old-schedule",
  };
  beforeEach(() => {
    jest.clearAllMocks();
    (db.query.monitors.findFirst as jest.Mock).mockResolvedValue(existing);
    (scheduleMonitor as jest.Mock).mockResolvedValue("new-schedule");
  });
  function mockUpdate(changes: object) {
    const updated = { ...existing, ...changes };
    const chain = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([updated]),
    };
    (db.update as jest.Mock).mockReturnValue(chain);
    return updated;
  }
  it.each([
    { target: "https://example.org" },
    { type: "ping_host" as const },
    { config: { method: "HEAD" as const } },
  ])("refreshes execution settings for %j", async (changes) => {
    const updated = mockUpdate(changes);
    await updateMonitorHandler(existing.id, changes);
    expect(deleteScheduledMonitor).toHaveBeenCalledWith("old-schedule");
    expect(scheduleMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        jobData: expect.objectContaining({
          target: updated.target,
          type: updated.type,
          config: updated.config,
        }),
      }),
    );
  });
  it("does not reschedule an equivalent config with reordered keys", async () => {
    (db.query.monitors.findFirst as jest.Mock).mockResolvedValue({ ...existing, config: { method: "GET", timeout: 30 } });
    mockUpdate({ config: { timeout: 30, method: "GET" } });
    await updateMonitorHandler(existing.id, { config: { timeout: 30, method: "GET" } });
    expect(scheduleMonitor).not.toHaveBeenCalled();
  });
  it("preserves an explicit PATCH observed status", async () => {
    mockUpdate({status:"down"});
    await updateMonitorHandler(existing.id, {status:"down",enabled:true});
    expect((db.update as jest.Mock).mock.results[0].value.set).toHaveBeenCalledWith(expect.objectContaining({status:"down"}));
    expect(scheduleMonitor).not.toHaveBeenCalled();
  });
  it("resumes with the explicitly requested status", async () => {
    (db.query.monitors.findFirst as jest.Mock).mockResolvedValue({...existing,status:"paused",enabled:false});
    mockUpdate({status:"up",enabled:true});
    await updateMonitorHandler(existing.id, {status:"up",enabled:true});
    expect((db.update as jest.Mock).mock.results[0].value.set).toHaveBeenCalledWith(expect.objectContaining({status:"up",enabled:true}));
    expect(scheduleMonitor).toHaveBeenCalled();
  });
  it("does not reschedule a metadata-only update", async () => {
    mockUpdate({ name: "Renamed" });
    await updateMonitorHandler(existing.id, { name: "Renamed" });
    expect(scheduleMonitor).not.toHaveBeenCalled();
    expect(deleteScheduledMonitor).not.toHaveBeenCalled();
  });
  it("keeps paused monitors unscheduled after configuration changes", async () => {
    (db.query.monitors.findFirst as jest.Mock).mockResolvedValue({
      ...existing,
      enabled: false,
      status: "paused",
      scheduledJobId: null,
    });
    mockUpdate({
      enabled: false,
      status: "paused",
      target: "https://example.org",
    });
    await updateMonitorHandler(existing.id, { target: "https://example.org" });
    expect(scheduleMonitor).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "persists enabled=%s before reconciling the schedule",
    async (enabled) => {
      const chain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest
          .fn()
          .mockResolvedValue([
            { ...existing, enabled, status: enabled ? "pending" : "paused" },
          ]),
      };
      (db.update as jest.Mock).mockReturnValue(chain);
      await updateMonitorHandler(existing.id, { enabled });
      expect(chain.set).toHaveBeenCalledWith(
        expect.objectContaining({ enabled }),
      );
    },
  );
});
