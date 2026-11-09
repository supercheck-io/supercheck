jest.mock("@/utils/db", () => ({
  db: {
    query: { monitors: { findFirst: jest.fn() } },
    update: jest.fn(),
    transaction: jest.fn(),
  },
}));
jest.mock("@/lib/monitor-schedule-reconcile", () => ({ reconcileMonitorSchedule: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/queue", () => ({ addMonitorExecutionJobToQueue: jest.fn() }));
jest.mock("@/lib/monitor-scheduler", () => ({
  scheduleMonitor: jest.fn(),
  deleteScheduledMonitor: jest.fn(),
}));
import { db } from "@/utils/db";
import { reconcileMonitorSchedule } from "@/lib/monitor-schedule-reconcile";
import {
  scheduleMonitor,
  deleteScheduledMonitor,
} from "@/lib/monitor-scheduler";
import { InvalidNotificationProvidersError, MonitorScheduleError } from "@/lib/monitor-write";
import { updateMonitorHandler, scheduleCreatedMonitor, insertMonitorRecord } from "./monitor-service";

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
    expect(updated).toMatchObject(changes);
    expect(reconcileMonitorSchedule).toHaveBeenCalledWith(existing.id, "project-1");
  });
  it("does not reschedule an equivalent config with reordered keys", async () => {
    (db.query.monitors.findFirst as jest.Mock).mockResolvedValue({ ...existing, config: { method: "GET", timeout: 30 } });
    mockUpdate({ config: { timeout: 30, method: "GET" } });
    await updateMonitorHandler(existing.id, { config: { timeout: 30, method: "GET" } });
    expect(reconcileMonitorSchedule).not.toHaveBeenCalled();
  });
  it.each([
    { alertChannels: ["new-channel"] },
    { regions: ["eu-central"] },
    { locationConfig: { enabled: true, locations: ["eu-central"], threshold: 1 } },
    { sslLastCheckedAt: "2026-10-22T00:00:00.000Z" },
    { testTitle: "Renamed test" },
  ])("does not reschedule a nonexecution config update %j", async (config) => {
    mockUpdate({ config });
    await updateMonitorHandler(existing.id, { config });
    expect(reconcileMonitorSchedule).not.toHaveBeenCalled();
  });
  it("preserves an explicit PATCH observed status", async () => {
    mockUpdate({status:"down"});
    await updateMonitorHandler(existing.id, {status:"down",enabled:true});
    expect((db.update as jest.Mock).mock.results[0].value.set).toHaveBeenCalledWith(expect.objectContaining({status:"down"}));
    expect(reconcileMonitorSchedule).not.toHaveBeenCalled();
  });
  it("resumes with the explicitly requested status", async () => {
    (db.query.monitors.findFirst as jest.Mock).mockResolvedValue({...existing,status:"paused",enabled:false});
    mockUpdate({status:"up",enabled:true});
    await updateMonitorHandler(existing.id, {status:"up",enabled:true});
    expect((db.update as jest.Mock).mock.results[0].value.set).toHaveBeenCalledWith(expect.objectContaining({status:"up",enabled:true}));
    expect(reconcileMonitorSchedule).toHaveBeenCalled();
  });
  it("does not reschedule a metadata-only update", async () => {
    mockUpdate({ name: "Renamed" });
    await updateMonitorHandler(existing.id, { name: "Renamed" });
    expect(reconcileMonitorSchedule).not.toHaveBeenCalled();
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
    // Reconcile removes any stray job for a paused monitor and never adds one.
    expect(reconcileMonitorSchedule).toHaveBeenCalledWith(existing.id, "project-1");
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

describe("updateMonitorHandler write safety", () => {
  const existing = {
    id: "monitor-1", projectId: "project-1", type: "http_request", target: "https://example.com",
    config: { timeoutSeconds: 30, aggregatedAlertState: { n: 4 }, sslLastCheckedAt: "t" },
    frequencyMinutes: 5, enabled: true, status: "up", scheduledJobId: "old-schedule",
  };
  const chain = (row: object) => ({
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([row]),
  });
  beforeEach(() => {
    jest.clearAllMocks();
    (db.query.monitors.findFirst as jest.Mock).mockResolvedValue(existing);
  });

  it("keeps worker-owned config keys when config is replaced (c2)", async () => {
    const c = chain({ ...existing });
    (db.update as jest.Mock).mockReturnValue(c);
    await updateMonitorHandler(existing.id, { config: { timeoutSeconds: 10 } });
    expect(c.set).toHaveBeenCalledWith(expect.objectContaining({
      config: { timeoutSeconds: 10, aggregatedAlertState: { n: 4 }, sslLastCheckedAt: "t" },
    }));
  });

  it("does not reschedule when only worker bookkeeping differs (c2)", async () => {
    (db.update as jest.Mock).mockReturnValue(chain({ ...existing }));
    await updateMonitorHandler(existing.id, { config: { timeoutSeconds: 30 } });
    expect(reconcileMonitorSchedule).not.toHaveBeenCalled();
  });

  it("surfaces a scheduling failure instead of reporting success (c5)", async () => {
    const c = chain({ ...existing, frequencyMinutes: 10 });
    (db.update as jest.Mock).mockReturnValue(c);
    (reconcileMonitorSchedule as jest.Mock).mockRejectedValue(new Error("redis down"));
    await expect(updateMonitorHandler(existing.id, { frequencyMinutes: 10 })).rejects.toBeInstanceOf(MonitorScheduleError);
    // The row is saved; reconcile owns scheduledJobId, so a retry converges.
    expect(c.set).toHaveBeenCalledWith(expect.objectContaining({ frequencyMinutes: 10 }));
  });

  it("surfaces a scheduling failure after create (c5)", async () => {
    (scheduleMonitor as jest.Mock).mockRejectedValue(new Error("redis down"));
    (db.update as jest.Mock).mockReturnValue(chain({}));
    await expect(scheduleCreatedMonitor({ ...existing, frequencyMinutes: 5 } as never, true)).rejects.toThrow("redis down");
  });

  it("removes the queued repeatable job when recording its id fails after create", async () => {
    (scheduleMonitor as jest.Mock).mockResolvedValue("new-schedule");
    (db.update as jest.Mock).mockReturnValue({ set: jest.fn().mockReturnThis(), where: jest.fn().mockRejectedValue(new Error("db down")) });
    await expect(scheduleCreatedMonitor({ ...existing, frequencyMinutes: 5 } as never, true)).rejects.toThrow("db down");
    expect(deleteScheduledMonitor).toHaveBeenCalledWith("new-schedule");
  });

  it("replaces the delivery rows in the same transaction as the row when asked to (alertConfig write)", async () => {
    const c = chain({ ...existing });
    const txDeleteWhere = jest.fn().mockResolvedValue(undefined);
    const txValues = jest.fn().mockReturnValue({ onConflictDoNothing: jest.fn() });
    const tx = {
      update: jest.fn().mockReturnValue(c),
      select: () => ({ from: () => ({ where: async () => [{ id: "00000000-0000-4000-8000-0000000000aa" }] }) }),
      delete: () => ({ where: txDeleteWhere }),
      insert: () => ({ values: txValues }),
    };
    (db.transaction as jest.Mock).mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));
    await updateMonitorHandler(existing.id, { alertConfig: null }, {
      providerSync: { ids: ["00000000-0000-4000-8000-0000000000aa"], organizationId: "org-1", projectId: "project-1" },
    });
    expect(tx.update).toHaveBeenCalled();
    expect(txDeleteWhere).toHaveBeenCalled();
    expect(txValues).toHaveBeenCalledWith([{ monitorId: existing.id, notificationProviderId: "00000000-0000-4000-8000-0000000000aa" }]);
  });

  it("writes nothing when a provider is outside the project", async () => {
    const tx = {
      update: jest.fn().mockReturnValue(chain({ ...existing })),
      select: () => ({ from: () => ({ where: async () => [] }) }),
      delete: jest.fn(),
      insert: jest.fn(),
    };
    (db.transaction as jest.Mock).mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));
    await expect(
      updateMonitorHandler(existing.id, {}, { providerSync: { ids: ["00000000-0000-4000-8000-0000000000bb"], organizationId: "org-1", projectId: "project-1" } }),
    ).rejects.toBeInstanceOf(InvalidNotificationProvidersError);
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("rejects config null instead of wiping the stored config", async () => {
    await expect(updateMonitorHandler(existing.id, { config: null })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("insertMonitorRecord enabled flag", () => {
  const base = { name: "m", type: "http_request", target: "https://example.com", frequencyMinutes: 5, organizationId: "00000000-0000-4000-8000-000000000001", projectId: "00000000-0000-4000-8000-000000000002" };
  const executor = () => {
    const values = jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{}]) });
    return { values, executor: { insert: jest.fn().mockReturnValue({ values }) } };
  };
  it("stores enabled=false with status paused", async () => {
    const { values, executor: ex } = executor();
    await insertMonitorRecord({ ...base, enabled: false } as never, ex as never);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, status: "paused" }));
  });
  it("stores enabled=true by default", async () => {
    const { values, executor: ex } = executor();
    await insertMonitorRecord(base as never, ex as never);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, status: "pending" }));
  });
});
