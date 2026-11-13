/** @jest-environment node */
const mockSet = jest.fn();
const mockExists = jest.fn();
const mockEval = jest.fn().mockResolvedValue(1);
const mockRepeatables = jest.fn();
const mockRemove = jest.fn();
const mockAddRepeatable = jest.fn();
const selectResults: unknown[][] = [];

const queue = { getRepeatableJobs: () => mockRepeatables(), removeRepeatableByKey: (...a: unknown[]) => mockRemove(...a), client: Promise.resolve({ exists: (...a: unknown[]) => mockExists(...a), set: (...a: unknown[]) => mockSet(...a), eval: (...a: unknown[]) => mockEval(...a) }) };
jest.mock("./queue", () => ({ getQueues: async () => ({ jobSchedulerQueue: queue, k6JobSchedulerQueue: { ...queue, getRepeatableJobs: async () => [] } }) }));

/** A drizzle-like builder: every step returns itself, awaiting it yields the next queued select result. */
function chain(result: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const step of ["from", "where", "orderBy", "limit"]) builder[step] = () => builder;
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}
jest.mock("@/utils/db", () => ({
  db: {
    select: () => chain(selectResults.shift() ?? []),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
}));
jest.mock("./scheduler/legacy-k6-tick", () => ({ addJobRepeatable: (...a: unknown[]) => mockAddRepeatable(...a) }));
jest.mock("./scheduler/job-scheduler", () => ({ processScheduledJob: jest.fn() }));
jest.mock("./data-lifecycle-service", () => ({ createDataLifecycleService: jest.fn(), setDataLifecycleInstance: jest.fn() }));
jest.mock("@/lib/sentry-lazy", () => ({ checkedTick: jest.fn() }));
jest.mock("@/lib/middleware/plan-limit-lock", () => ({ notInDeletedProject: jest.fn() }));
jest.mock("@/lib/deletion/visibility", () => ({ liveJob: jest.fn(), notInPendingOrganization: jest.fn() }));
jest.mock("@/lib/cron-utils", () => ({ getNextRunDate: () => new Date("2026-01-01T00:00:00Z") }));

let repairJobSchedules: typeof import("./job-scheduler").repairJobSchedules;

const job = (id: string) => ({ id, name: `Job ${id}`, cron: "0 * * * *" });
const row = (id: string) => ({ id, name: `Job ${id}`, projectId: "p", organizationId: "o", deletingAt: null });
const fresh = (cron = "0 * * * *") => [{ cron }];

describe("repairJobSchedules", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.isolateModules(() => { ({ repairJobSchedules } = jest.requireActual<typeof import("./job-scheduler")>("./job-scheduler")); }); // fresh cursor per test
    selectResults.length = 0;
    mockSet.mockResolvedValue("OK");
    mockExists.mockResolvedValue(0);
    mockRepeatables.mockResolvedValue([{ name: "scheduled-job-a", key: "k-a" }]);
  });

  it("schedules only live jobs whose repeatable is missing", async () => {
    selectResults.push([job("a"), job("b")], fresh(), [row("b")]);
    expect(await repairJobSchedules()).toEqual({ repaired: 1, failed: 0 });
    expect(mockAddRepeatable).toHaveBeenCalledTimes(1);
    expect(mockAddRepeatable.mock.calls[0][1]).toBe("scheduled-job-b");
    expect(mockEval).toHaveBeenCalled(); // lock released
  });

  it("keeps going after one job fails", async () => {
    selectResults.push([job("b"), job("c")], fresh(), [], fresh(), [row("c")]); // b vanished inside scheduleJob
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await repairJobSchedules()).toEqual({ repaired: 1, failed: 1 });
    expect(mockAddRepeatable.mock.calls.map((call) => call[1])).toEqual(["scheduled-job-c"]);
  });

  it("skips while another sweep holds its lock, and backs off (never blocks) while init runs", async () => {
    mockSet.mockResolvedValue(null);
    expect(await repairJobSchedules()).toEqual({ repaired: 0, failed: 0, skipped: true });
    mockSet.mockResolvedValue("OK");
    mockExists.mockResolvedValue(1);
    expect(await repairJobSchedules()).toEqual({ repaired: 0, failed: 0, skipped: true });
    expect(mockSet).toHaveBeenCalledTimes(1); // init's key is only read, never taken
    expect(mockSet.mock.calls[0][0]).toBe("job:scheduler:repair:lock");
    expect(mockRepeatables).not.toHaveBeenCalled();
  });

  it("leaves a job alone when its cron changed since the snapshot (the edit scheduled it)", async () => {
    selectResults.push([job("b")], fresh("*/5 * * * *"));
    expect(await repairJobSchedules()).toEqual({ repaired: 0, failed: 0 });
    expect(mockAddRepeatable).not.toHaveBeenCalled();
  });

  it("starts after the last job handled, so failing rows cannot starve the rest", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    selectResults.push([job("b"), job("c")], fresh(), [], fresh(), []); // both fail; cursor ends at c
    await repairJobSchedules();
    selectResults.push([job("b"), job("c"), job("d")], fresh(), [row("d")]);
    await repairJobSchedules();
    expect(mockAddRepeatable.mock.calls[0][1]).toBe("scheduled-job-d");
  });
});
