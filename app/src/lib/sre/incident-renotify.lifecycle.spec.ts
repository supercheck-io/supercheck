const mockQueueClose = jest.fn();
const mockWorkerClose = jest.fn();
const mockSet = jest.fn(async () => "OK");

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: mockQueueClose,
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: mockWorkerClose,
  })),
}));
jest.mock("@/lib/queue", () => ({
  getRedisConnection: jest.fn(async () => ({ duplicate: jest.fn(), set: mockSet })),
  queueLogger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock("@/utils/db", () => ({ db: {} }));

import { Worker } from "bullmq";
import { getIncidentRenotifyQueue, initializeIncidentRenotifyScheduler, shutdownIncidentRenotifyScheduler } from "./incident-renotify";

describe("incident-renotify lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueueClose.mockResolvedValue(undefined);
    mockWorkerClose.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await shutdownIncidentRenotifyScheduler();
  });

  it("closes the worker and queue on shutdown, and a second shutdown is a no-op", async () => {
    await initializeIncidentRenotifyScheduler();
    expect(getIncidentRenotifyQueue()).toBeDefined();

    await shutdownIncidentRenotifyScheduler();
    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(getIncidentRenotifyQueue()).toBeUndefined();

    await shutdownIncidentRenotifyScheduler();
    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
  });

  it("stamps the heartbeat ingest key on its own timer, independent of the reminder job, and stops on shutdown", async () => {
    jest.useFakeTimers();
    try {
      await initializeIncidentRenotifyScheduler();
      expect(mockSet).toHaveBeenCalledWith("supercheck:heartbeat:ingest", expect.any(String), "EX", 150);
      mockSet.mockClear();
      jest.advanceTimersByTime(30_000);
      expect(mockSet).toHaveBeenCalledTimes(1);
      await shutdownIncidentRenotifyScheduler();
      mockSet.mockClear();
      jest.advanceTimersByTime(60_000);
      expect(mockSet).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("still closes the queue when closing the worker fails, and can start again", async () => {
    await initializeIncidentRenotifyScheduler();
    mockWorkerClose.mockRejectedValueOnce(new Error("redis down"));

    await expect(shutdownIncidentRenotifyScheduler()).resolves.toBeUndefined();
    expect(mockQueueClose).toHaveBeenCalledTimes(1);

    await initializeIncidentRenotifyScheduler();
    expect(Worker).toHaveBeenCalledTimes(2);
  });
});
