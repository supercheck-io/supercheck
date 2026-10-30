const workers: Array<{ close: jest.Mock; run: jest.Mock; on: jest.Mock }> = [];
let failRunOnce = true;
jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation(() => {
    const w = {
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      run: jest.fn().mockImplementation(async () => {
        if (failRunOnce) {
          failRunOnce = false;
          throw new Error("redis down");
        }
      }),
    };
    workers.push(w);
    return w;
  }),
}));
jest.mock("@/lib/queue", () => ({
  getRedisConnection: jest.fn().mockResolvedValue({ duplicate: jest.fn() }),
  queueLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("./job-scheduler", () => ({ processScheduledJob: jest.fn() }));
jest.mock("./monitor-scheduler", () => ({ processScheduledMonitor: jest.fn() }));

import { initializeSchedulerWorkers, isSchedulerWorkersRunning } from "./scheduler-worker";

it("closes created workers and allows a retry after a failed init", async () => {
  await expect(initializeSchedulerWorkers()).rejects.toThrow("redis down");
  expect(workers).toHaveLength(3);
  workers.forEach((w) => expect(w.close).toHaveBeenCalled());

  await expect(initializeSchedulerWorkers()).resolves.toBeUndefined();
  expect(workers).toHaveLength(6);
  expect(isSchedulerWorkersRunning()).toBe(true);
});
