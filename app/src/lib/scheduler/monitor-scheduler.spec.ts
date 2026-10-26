/** @jest-environment node */

const mockResolveMonitorLocations = jest.fn();
const mockResolveDefaultMonitorLocations = jest.fn();
const mockIsMonitorLocationResolutionError = jest.fn();
const mockGetFirstVisibleProjectRestrictionCode = jest.fn();

const mockUpdateWhere = jest.fn().mockResolvedValue(undefined);
const mockUpdateSet = jest.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = jest.fn().mockReturnValue({ set: mockUpdateSet });

const mockInsertValues = jest.fn().mockResolvedValue(undefined);
const mockInsert = jest.fn().mockReturnValue({ values: mockInsertValues });

jest.mock("@/lib/queue", () => ({
  getQueues: jest.fn(),
  enqueueMonitorLocationJobs: jest.fn(),
  monitorQueueName: (location: string) => `monitor-${location}`,
  queueLogger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock("@/lib/monitor-cycles", () => ({
  ...jest.requireActual("@/lib/monitor-cycles"),
  abortMonitorCycle: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/location-registry", () => ({
  getFirstVisibleProjectRestrictionCode: jest.fn(),
}));

jest.mock("@/lib/monitor-location-routing", () => ({
  partitionMonitorLocationsByAvailability: jest.fn(),
  resolveDefaultMonitorLocations: jest.fn(),
  resolveMonitorLocations: jest.fn(),
  isMonitorLocationResolutionError: jest.fn(),
}));

jest.mock("@/utils/db", () => {
  const database = {
    update: jest.fn(() => mockUpdate()),
    insert: jest.fn(() => mockInsert()),
    select: jest.fn(() => ({ from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), for: async () => {
      const monitor = await mockMonitorsFindFirst(); return monitor ? [monitor] : [];
    } })),
    query: { monitors: { findFirst: jest.fn() }, monitorResults: { findFirst: jest.fn() } },
  };
  return { db: { ...database, transaction: jest.fn(async (callback: (tx: typeof database) => Promise<unknown>) => callback(database)) } };
});

jest.mock("@/db/schema", () => ({
  monitors: {},
  monitorResults: {},
}));

jest.mock("drizzle-orm", () => ({
  desc: jest.fn(),
  eq: jest.fn(),
}));

jest.mock("./constants", () => ({
  EXECUTE_MONITOR_JOB_NAME: "executeMonitorJob",
}));

import { getQueues, enqueueMonitorLocationJobs } from "@/lib/queue";
import { partitionMonitorLocationsByAvailability } from "@/lib/monitor-location-routing";
import { db } from "@/utils/db";
import {
  getFirstVisibleProjectRestrictionCode,
} from "@/lib/location-registry";
import {
  isMonitorLocationResolutionError,
  resolveDefaultMonitorLocations,
  resolveMonitorLocations,
} from "@/lib/monitor-location-routing";
import { processScheduledMonitor } from "./monitor-scheduler";
import { abortMonitorCycle, MonitorCycleClosedError, monitorCycleId } from "@/lib/monitor-cycles";

const mockMonitorsFindFirst = db.query.monitors.findFirst as jest.Mock;
const mockMonitorResultsFindFirst = db.query.monitorResults.findFirst as jest.Mock;

describe("monitor-scheduler", () => {
  const currentMonitor = { config: null, projectId: "project-1", type: "website", target: "https://example.com", frequencyMinutes: 5, enabled: true, status: "up" };
  beforeEach(() => {
    jest.clearAllMocks();

    mockResolveMonitorLocations.mockReset();
    mockResolveDefaultMonitorLocations.mockReset();
    mockIsMonitorLocationResolutionError.mockReset();
    mockGetFirstVisibleProjectRestrictionCode.mockReset();

    (resolveMonitorLocations as jest.Mock).mockImplementation(
      mockResolveMonitorLocations
    );
    (resolveDefaultMonitorLocations as jest.Mock).mockImplementation(
      mockResolveDefaultMonitorLocations
    );
    (isMonitorLocationResolutionError as jest.Mock).mockImplementation(
      mockIsMonitorLocationResolutionError
    );
    (getFirstVisibleProjectRestrictionCode as jest.Mock).mockImplementation(
      mockGetFirstVisibleProjectRestrictionCode
    );

    mockMonitorsFindFirst.mockResolvedValue(currentMonitor);
    mockMonitorResultsFindFirst.mockResolvedValue(null);
  });

  it.each([false, true])("refreshes changed routing config at the scheduled trigger (nested=%s)", async (nested) => {
    const oldConfig = { headers: { Authorization: "Bearer old-target-key" }, locationConfig: { enabled: true, locations: ["us-east"], threshold: 1 } };
    const config = { headers: { Authorization: "Bearer current-target-key" }, locationConfig: { enabled: true, locations: ["eu-central"], threshold: 1 }, alertChannels: ["new-channel"] };
    mockMonitorsFindFirst.mockResolvedValue({ ...currentMonitor, config });
    mockResolveMonitorLocations.mockResolvedValue(["eu-central"]);
    (getQueues as jest.Mock).mockResolvedValue({ monitorExecutionQueue: { "eu-central": {} } });
    (partitionMonitorLocationsByAvailability as jest.Mock).mockResolvedValue({ enqueuedLocations: ["eu-central"], skippedLocations: [] });
    (enqueueMonitorLocationJobs as jest.Mock).mockResolvedValue("group");
    const data = { monitorId: "monitor-1", projectId: "project-1", type: "website", target: "https://old.example.com", config: oldConfig };
    await processScheduledMonitor({ data: nested ? { monitorId: data.monitorId, jobData: data } : data } as never);
    expect(resolveMonitorLocations).toHaveBeenCalledWith(config.locationConfig, "project-1", { monitorType: "website" });
    expect(enqueueMonitorLocationJobs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ config, target: currentMonitor.target, type: currentMonitor.type, projectId: currentMonitor.projectId }), ["eu-central"], expect.anything(), expect.anything());
  });

  it.each([null, { enabled: false }, { status: "paused" }])("skips a removed or paused monitor %j", async monitor => {
    mockMonitorsFindFirst.mockResolvedValue(monitor);
    const result = await processScheduledMonitor({ data: { monitorId: "monitor-1", type: "website", target: "https://example.com" } } as never);
    expect(result).toEqual({ success: false });
    expect(resolveMonitorLocations).not.toHaveBeenCalled();
    expect(enqueueMonitorLocationJobs).not.toHaveBeenCalled();
  });

  it("removes its own repeatable schedule when the monitor is gone", async () => {
    mockMonitorsFindFirst.mockResolvedValue(null);
    const removeRepeatableByKey = jest.fn().mockResolvedValue(true);
    (getQueues as jest.Mock).mockResolvedValue({ monitorSchedulerQueue: { removeRepeatableByKey } });
    const job = { data: { monitorId: "monitor-1", type: "website", target: "https://example.com" }, repeatJobKey: "repeat-key" };
    await expect(processScheduledMonitor(job as never)).resolves.toEqual({ success: false });
    expect(removeRepeatableByKey).toHaveBeenCalledWith("repeat-key");
  });

  it("keeps the schedule of a paused monitor, which a resume may be re-adding under the same key", async () => {
    mockMonitorsFindFirst.mockResolvedValue({ status: "paused" });
    const removeRepeatableByKey = jest.fn().mockResolvedValue(true);
    (getQueues as jest.Mock).mockResolvedValue({ monitorSchedulerQueue: { removeRepeatableByKey } });
    const job = { data: { monitorId: "monitor-1", type: "website", target: "https://example.com" }, repeatJobKey: "repeat-key" };
    await expect(processScheduledMonitor(job as never)).resolves.toEqual({ success: false });
    expect(removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it("does not fail the job when removing its stale schedule fails", async () => {
    mockMonitorsFindFirst.mockResolvedValue(null);
    const removeRepeatableByKey = jest.fn().mockRejectedValue(new Error("redis down"));
    (getQueues as jest.Mock).mockResolvedValue({ monitorSchedulerQueue: { removeRepeatableByKey } });
    const job = { data: { monitorId: "monitor-1", type: "website", target: "https://example.com" }, repeatJobKey: "repeat-key" };
    await expect(processScheduledMonitor(job as never)).resolves.toEqual({ success: false });
  });

  it("records scheduling failures when project restrictions disable all allowed locations", async () => {
    const disabledRestrictionsError =
      "All restricted locations for this project are currently disabled. Enable at least one assigned location or remove the project restrictions.";

    mockResolveMonitorLocations
      .mockRejectedValueOnce(new Error(disabledRestrictionsError))
      .mockRejectedValueOnce(new Error(disabledRestrictionsError));
    mockResolveDefaultMonitorLocations.mockRejectedValue(
      new Error(disabledRestrictionsError)
    );
    mockIsMonitorLocationResolutionError.mockReturnValue(true);
    mockGetFirstVisibleProjectRestrictionCode.mockResolvedValue("eu-central");

    await expect(
      processScheduledMonitor({
        data: {
          monitorId: "monitor-1",
          projectId: "project-1",
          type: "website",
          target: "https://example.com",
        },
      } as never)
    ).rejects.toThrow(disabledRestrictionsError);

    expect(db.update).toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        monitorId: "monitor-1",
        location: "eu-central",
        status: "error",
        isUp: false,
      })
    );
    expect(mockGetFirstVisibleProjectRestrictionCode).toHaveBeenCalledWith(
      "project-1"
    );
  });

  it("records Redis enqueue errors even when some regional commands succeeded", async () => {
    mockResolveMonitorLocations.mockResolvedValue(["eu-central", "us-east"]);
    (getQueues as jest.Mock).mockResolvedValue({ monitorExecutionQueue: { "eu-central": {}, "us-east": {} } });
    (partitionMonitorLocationsByAvailability as jest.Mock).mockResolvedValue({ enqueuedLocations: ["eu-central", "us-east"], skippedLocations: [] });
    (enqueueMonitorLocationJobs as jest.Mock).mockRejectedValue(new Error("incomplete cycle enqueue"));
    await expect(processScheduledMonitor({ data: { monitorId: "monitor-1", type: "website", target: "https://example.com" } } as never)).rejects.toThrow("incomplete cycle enqueue");
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "down" }));
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ location: "eu-central", isUp: false }));
  });

  it("retries on a database read failure without recording the monitor as down", async () => {
    mockMonitorsFindFirst.mockRejectedValueOnce(new Error("connection pool exhausted"));
    await expect(processScheduledMonitor({ data: { monitorId: "monitor-1", type: "website", target: "https://example.com" } } as never)).rejects.toThrow("connection pool exhausted");
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(enqueueMonitorLocationJobs).not.toHaveBeenCalled();
  });

  describe("missing-cycle closure", () => {
    const data = { monitorId: "monitor-1", type: "website", target: "https://example.com" };
    const job = (overrides: Record<string, unknown> = {}) =>
      ({ id: "repeat:abc:1000", attemptsMade: 0, opts: { attempts: 3 }, data, ...overrides }) as never;
    beforeEach(() => {
      process.env.MISSING_CYCLE_CLOSURE_ENABLED = "true";
      mockResolveMonitorLocations.mockResolvedValue(["eu-central", "us-east"]);
      (getQueues as jest.Mock).mockResolvedValue({ monitorExecutionQueue: { "eu-central": {}, "us-east": {} } });
      (partitionMonitorLocationsByAvailability as jest.Mock).mockResolvedValue({ enqueuedLocations: ["eu-central", "us-east"], skippedLocations: [] });
    });
    afterEach(() => { delete process.env.MISSING_CYCLE_CLOSURE_ENABLED; });

    it("passes the scheduler job id and the configured regions, retrying until the last attempt", async () => {
      (enqueueMonitorLocationJobs as jest.Mock).mockResolvedValue("group");
      await processScheduledMonitor(job({ attemptsMade: 1 }));
      expect(enqueueMonitorLocationJobs).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), ["eu-central", "us-east"], expect.anything(),
        expect.objectContaining({ key: "repeat:abc:1000", configuredLocations: ["eu-central", "us-east"], abortOnFailure: false }),
      );
      await processScheduledMonitor(job({ attemptsMade: 2 }));
      expect(enqueueMonitorLocationJobs).toHaveBeenLastCalledWith(
        expect.anything(), expect.anything(), expect.anything(), expect.anything(),
        expect.objectContaining({ abortOnFailure: true }),
      );
    });

    it("aborts the cycle on a final failure that happens before publication", async () => {
      (partitionMonitorLocationsByAvailability as jest.Mock).mockResolvedValue({ enqueuedLocations: [], skippedLocations: ["eu-central", "us-east"] });
      await expect(processScheduledMonitor(job({ attemptsMade: 2 }))).rejects.toThrow("no jobs enqueued");
      expect(abortMonitorCycle).toHaveBeenCalledWith(monitorCycleId("monitor-1", "repeat:abc:1000"));
    });

    it("keeps the cycle for a retry while attempts remain", async () => {
      (partitionMonitorLocationsByAvailability as jest.Mock).mockResolvedValue({ enqueuedLocations: [], skippedLocations: ["eu-central"] });
      await expect(processScheduledMonitor(job({ attemptsMade: 0 }))).rejects.toThrow();
      expect(abortMonitorCycle).not.toHaveBeenCalled();
    });

    it("does not abort or double-count when the flag is off", async () => {
      delete process.env.MISSING_CYCLE_CLOSURE_ENABLED;
      (partitionMonitorLocationsByAvailability as jest.Mock).mockResolvedValue({ enqueuedLocations: [], skippedLocations: ["eu-central"] });
      await expect(processScheduledMonitor(job({ attemptsMade: 2 }))).rejects.toThrow();
      expect(abortMonitorCycle).not.toHaveBeenCalled();
    });

    it("skips publication into an already closed cycle without a second scheduling failure", async () => {
      (enqueueMonitorLocationJobs as jest.Mock).mockRejectedValue(new MonitorCycleClosedError("c", "closed"));
      mockUpdateSet.mockClear();
      expect(await processScheduledMonitor(job({ attemptsMade: 1 }))).toEqual({ success: false });
      expect(mockUpdateSet).not.toHaveBeenCalled();
      expect(abortMonitorCycle).not.toHaveBeenCalled();
    });
  });

  it.each(["up", "down"])("updates status-change time only when changing %s to down", async (status) => {
    mockMonitorsFindFirst.mockResolvedValue({ ...currentMonitor, status });
    mockResolveMonitorLocations.mockRejectedValue(new Error("no jobs enqueued"));
    mockGetFirstVisibleProjectRestrictionCode.mockResolvedValue("eu-central");
    await expect(processScheduledMonitor({ data: { monitorId: "monitor-1", type: "website", target: "https://example.com" } } as never)).rejects.toThrow();
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      lastStatusChangeAt: status === "up" ? expect.any(Date) : undefined,
    }));
  });
});
