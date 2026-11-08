const mockQueueClose = jest.fn();
const mockWorkerClose = jest.fn();

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
  getRedisConnection: jest.fn(async () => ({ duplicate: jest.fn() })),
  queueLogger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock("@/utils/db", () => ({ db: {} }));

import { Worker } from "bullmq";
import { getStatusPageQueue, initializeStatusPageScheduler, shutdownStatusPageScheduler } from "./status-page-scheduler";

describe("status-page-scheduler lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueueClose.mockResolvedValue(undefined);
    mockWorkerClose.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await shutdownStatusPageScheduler();
  });

  it("closes the worker and queue on shutdown, and a second shutdown is a no-op", async () => {
    await initializeStatusPageScheduler();
    expect(getStatusPageQueue()).toBeDefined();

    await shutdownStatusPageScheduler();
    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(getStatusPageQueue()).toBeUndefined();

    await shutdownStatusPageScheduler();
    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
  });

  it("still closes the queue when closing the worker fails, and can start again", async () => {
    await initializeStatusPageScheduler();
    mockWorkerClose.mockRejectedValueOnce(new Error("redis down"));

    await expect(shutdownStatusPageScheduler()).resolves.toBeUndefined();
    expect(mockQueueClose).toHaveBeenCalledTimes(1);

    await initializeStatusPageScheduler();
    expect(Worker).toHaveBeenCalledTimes(2);
  });
});
