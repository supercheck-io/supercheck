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

const mockMonitorsFindFirst = db.query.monitors.findFirst as jest.Mock;
const mockMonitorResultsFindFirst = db.query.monitorResults.findFirst as jest.Mock;

describe("monitor-scheduler", () => {
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

    mockMonitorsFindFirst.mockResolvedValue({
      config: null,
      projectId: "project-1",
    });
    mockMonitorResultsFindFirst.mockResolvedValue(null);
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

  it.each(["up", "down"])("updates status-change time only when changing %s to down", async (status) => {
    mockMonitorsFindFirst.mockResolvedValue({ status, config: null, projectId: "project-1" });
    mockResolveMonitorLocations.mockRejectedValue(new Error("no jobs enqueued"));
    mockGetFirstVisibleProjectRestrictionCode.mockResolvedValue("eu-central");
    await expect(processScheduledMonitor({ data: { monitorId: "monitor-1", type: "website", target: "https://example.com" } } as never)).rejects.toThrow();
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      lastStatusChangeAt: status === "up" ? expect.any(Date) : undefined,
    }));
  });



});
