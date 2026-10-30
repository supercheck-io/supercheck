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

const listenersBefore = {
  SIGTERM: process.listeners("SIGTERM"),
  SIGINT: process.listeners("SIGINT"),
};
// Loaded after the snapshot (imports are hoisted) so its handlers can be told apart from Jest's.
const { initializeSchedulerWorkers, isSchedulerWorkersRunning } =
  jest.requireActual<typeof import("./scheduler-worker")>("./scheduler-worker");

// The module registers SIGTERM/SIGINT shutdown handlers on import. Left in place they intercept the
// signal Jest uses to stop this worker, which then has to be force-exited.
afterAll(() => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    for (const listener of process.listeners(signal)) {
      if (!listenersBefore[signal].includes(listener)) process.removeListener(signal, listener);
    }
  }
});

it("closes created workers and allows a retry after a failed init", async () => {
  await expect(initializeSchedulerWorkers()).rejects.toThrow("redis down");
  expect(workers).toHaveLength(3);
  workers.forEach((w) => expect(w.close).toHaveBeenCalled());

  await expect(initializeSchedulerWorkers()).resolves.toBeUndefined();
  expect(workers).toHaveLength(6);
  expect(isSchedulerWorkersRunning()).toBe(true);
});

it("leaves no signal handlers of its own behind after the suite", () => {
  // Checked again in afterAll; here we prove the module did register them, so the cleanup matters.
  expect(process.listeners("SIGTERM").length).toBeGreaterThan(listenersBefore.SIGTERM.length);
});
