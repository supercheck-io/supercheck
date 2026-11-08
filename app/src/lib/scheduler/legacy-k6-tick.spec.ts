/** @jest-environment node */
import type { Job, Queue } from "bullmq";
import { processLegacyK6Tick } from "./legacy-k6-tick";

const jobQueue = { getRepeatableJobs: jest.fn(), removeRepeatableByKey: jest.fn(), add: jest.fn() };
const k6Queue = { removeRepeatableByKey: jest.fn() };
const queues = { jobSchedulerQueue: jobQueue as unknown as Queue, k6JobSchedulerQueue: k6Queue as unknown as Queue };
const run = jest.fn();
const loadCron = jest.fn();
const go = (job: Job) => processLegacyK6Tick(job, queues, run, loadCron);
const DUE = 1_000;
const tick = (over: Record<string, unknown> = {}, repeat: Record<string, unknown> = {}) =>
  ({
    id: `repeat:abc:${DUE}`,
    name: "scheduled-job-1",
    data: { jobId: "1" },
    attemptsMade: 0,
    opts: { repeat: { pattern: "*/5 * * * *", tz: "UTC", ...repeat } },
    ...over,
  }) as unknown as Job;
const copy = (over: Record<string, unknown> = {}) => ({ name: "scheduled-job-1", key: "k", pattern: "*/5 * * * *", tz: "UTC", next: DUE, ...over });

beforeEach(() => {
  jest.resetAllMocks();
  run.mockResolvedValue("ran");
});

it("processes a job that is not a repeat tick, or has no pattern, untouched", async () => {
  await go(tick({ id: "manual-1" }));
  await go({ id: "repeat:abc:1", name: "n", data: {}, attemptsMade: 0, opts: {} } as unknown as Job);
  expect(run).toHaveBeenCalledTimes(2);
  expect(jobQueue.getRepeatableJobs).not.toHaveBeenCalled();
});

it("migrates then runs when job-scheduler has no schedule for the job", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([{ ...copy(), name: "other" }]);
  await expect(go(tick())).resolves.toBe("ran");
  expect(jobQueue.add).toHaveBeenCalledWith("scheduled-job-1", { jobId: "1" }, expect.objectContaining({ repeat: { pattern: "*/5 * * * *", tz: "UTC" }, jobId: "scheduled-job-1" }));
  expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("abc");
  expect(loadCron).not.toHaveBeenCalled();
});

it("skips and removes the legacy entry when the same schedule fires in this slot (null tz is UTC)", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([copy({ tz: null })]);
  await expect(go(tick())).resolves.toBeUndefined();
  expect(run).not.toHaveBeenCalled();
  expect(jobQueue.add).not.toHaveBeenCalled();
  expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("abc");
});

it("processes the due tick when the same schedule's copy fires only later (in-flight tick around migration)", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([copy({ next: DUE + 300_000 })]);
  await expect(go(tick())).resolves.toBe("ran");
  expect(jobQueue.add).not.toHaveBeenCalled();
  expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("abc");
});

it("removes the legacy entry by repeatJobKey when BullMQ provides it (long-format keys)", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([copy()]);
  await go(tick({ repeatJobKey: "scheduled-job-1:scheduled-job-1::UTC:*/5 * * * *" }));
  expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("scheduled-job-1:scheduled-job-1::UTC:*/5 * * * *");
});

it("a retry of a failed tick is processed without any convergence", async () => {
  await expect(go(tick({ attemptsMade: 1 }))).resolves.toBe("ran");
  expect(jobQueue.getRepeatableJobs).not.toHaveBeenCalled();
  expect(k6Queue.removeRepeatableByKey).not.toHaveBeenCalled();
});

describe("different schedule in job-scheduler: the database decides", () => {
  beforeEach(() => jobQueue.getRepeatableJobs.mockResolvedValue([copy({ key: "stale", pattern: "0 * * * *" })]));

  it("legacy schedule matches the database: it wins and the due tick still runs", async () => {
    loadCron.mockResolvedValue("*/5 * * * *");
    await expect(go(tick({}, { tz: "Asia/Tokyo" }))).resolves.toBe("ran");
    expect(jobQueue.removeRepeatableByKey).toHaveBeenCalledWith("stale");
    expect(jobQueue.add).toHaveBeenCalledWith("scheduled-job-1", { jobId: "1" }, expect.objectContaining({ repeat: { pattern: "*/5 * * * *", tz: "Asia/Tokyo" } }));
  });

  it("stale in-flight legacy tick: job-scheduler is made to match the database, not overwritten", async () => {
    loadCron.mockResolvedValue("0 * * * *"); // newer reschedule already in job-scheduler
    await expect(go(tick())).resolves.toBe("ran");
    expect(jobQueue.add).toHaveBeenCalledWith("scheduled-job-1", { jobId: "1" }, expect.objectContaining({ repeat: { pattern: "0 * * * *", tz: "UTC" } }));
    expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("abc");
  });

  it("deleted or unscheduled job: drops the legacy entry, leaves job-scheduler alone, and lets the processor clean up", async () => {
    loadCron.mockResolvedValue(null);
    await expect(go(tick())).resolves.toBe("ran");
    expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("abc");
    expect(jobQueue.add).not.toHaveBeenCalled();
    expect(jobQueue.removeRepeatableByKey).not.toHaveBeenCalled();
  });
});
