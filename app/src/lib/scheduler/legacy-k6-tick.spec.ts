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
    data: { jobId: "1", projectId: "p", organizationId: "o" },
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

it("migrates then runs when job-scheduler has no schedule for the job (the database cron, scoped to the tick)", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([{ ...copy(), name: "other" }]);
  loadCron.mockResolvedValue("*/5 * * * *");
  await expect(go(tick())).resolves.toBe("ran");
  expect(jobQueue.add).toHaveBeenCalledWith("scheduled-job-1", expect.objectContaining({ jobId: "1" }), expect.objectContaining({ repeat: { pattern: "*/5 * * * *", tz: "UTC" }, jobId: "scheduled-job-1" }));
  expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("abc");
  expect(loadCron).toHaveBeenCalledWith("1", { projectId: "p", organizationId: "o" });
});

it("a stale legacy tick with no job-scheduler copy installs the database cron, not its own", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([]);
  loadCron.mockResolvedValue("0 7 * * *");
  await expect(go(tick())).resolves.toBe("ran");
  expect(jobQueue.add).toHaveBeenCalledWith("scheduled-job-1", expect.anything(), expect.objectContaining({ repeat: { pattern: "0 7 * * *", tz: "UTC" } }));
});

it("adds the winning schedule before removing others, so a failed add removes nothing", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([copy({ key: "stale", pattern: "0 * * * *" })]);
  loadCron.mockResolvedValue("*/5 * * * *");
  jobQueue.add.mockRejectedValue(new Error("redis"));
  await expect(go(tick())).rejects.toThrow("redis");
  expect(jobQueue.removeRepeatableByKey).not.toHaveBeenCalled();
});

it("reconciles competing job-scheduler copies to the database cron even when one matches the legacy tick", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([copy({ key: "a" }), copy({ key: "b", pattern: "0 9 * * *" })]);
  loadCron.mockResolvedValue("*/5 * * * *");
  await expect(go(tick())).resolves.toBe("ran"); // the run guard dedupes it against the kept copy's fire
  expect(jobQueue.add).not.toHaveBeenCalled();
  expect(jobQueue.removeRepeatableByKey.mock.calls).toEqual([["b"]]);
});

it("processes the tick when the job-scheduler copy is behind this slot (a backlogged worker may jump past it)", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([copy({ next: DUE - 300_000 })]);
  await expect(go(tick())).resolves.toBe("ran");
});

it("same schedule in job-scheduler (null tz is UTC): drops the legacy entry and still processes the tick", async () => {
  // Never skipped from the repeatable snapshot: a concurrent reschedule could have removed that copy's fire.
  // processScheduledJob's per-tick run guard runs a slot once, whichever queue fires it first.
  jobQueue.getRepeatableJobs.mockResolvedValue([copy({ tz: null })]);
  await expect(go(tick())).resolves.toBe("ran");
  expect(run).toHaveBeenCalledTimes(1);
  expect(jobQueue.add).not.toHaveBeenCalled();
  expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("abc");
});

it("removes the legacy entry by repeatJobKey when BullMQ provides it (long-format keys)", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([copy()]);
  await go(tick({ repeatJobKey: "scheduled-job-1:scheduled-job-1::UTC:*/5 * * * *" }));
  expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("scheduled-job-1:scheduled-job-1::UTC:*/5 * * * *");
});

it("a retry re-runs convergence (restoring a schedule a failed attempt left out) and is never skipped as a duplicate", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([]);
  loadCron.mockResolvedValue("*/5 * * * *");
  await expect(go(tick({ attemptsMade: 1 }))).resolves.toBe("ran");
  expect(jobQueue.add).toHaveBeenCalledTimes(1);

  jobQueue.getRepeatableJobs.mockResolvedValue([copy()]); // same slot copy: would be a duplicate on attempt 0
  await expect(go(tick({ attemptsMade: 1 }))).resolves.toBe("ran");
  expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledTimes(2); // the legacy entry is dropped on each attempt
});

it("a payload without project and organization scope is processed untouched (startup migration converges it)", async () => {
  await expect(go(tick({ data: { jobId: "1" } }))).resolves.toBe("ran");
  expect(jobQueue.getRepeatableJobs).not.toHaveBeenCalled();
  expect(k6Queue.removeRepeatableByKey).not.toHaveBeenCalled();
});

it("the same pattern in another timezone is not the same schedule: the legacy one replaces it", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([copy({ key: "tokyo", tz: "Asia/Tokyo" })]);
  loadCron.mockResolvedValue("*/5 * * * *");
  await expect(go(tick())).resolves.toBe("ran");
  expect(jobQueue.add).toHaveBeenCalledWith("scheduled-job-1", expect.anything(), expect.objectContaining({ repeat: { pattern: "*/5 * * * *", tz: "UTC" } }));
  expect(jobQueue.removeRepeatableByKey.mock.calls).toEqual([["tokyo"]]);
});

it("several copies, none matching the database cron: adds it and removes them all", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([copy({ key: "a", pattern: "0 1 * * *" }), copy({ key: "b", pattern: "0 2 * * *" })]);
  loadCron.mockResolvedValue("0 3 * * *");
  await expect(go(tick())).resolves.toBe("ran");
  expect(jobQueue.add).toHaveBeenCalledWith("scheduled-job-1", expect.anything(), expect.objectContaining({ repeat: { pattern: "0 3 * * *", tz: "UTC" } }));
  expect(jobQueue.removeRepeatableByKey.mock.calls.map(([k]) => k).sort()).toEqual(["a", "b"]);
  expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("abc");
});

describe("different schedule in job-scheduler: the database decides", () => {
  beforeEach(() => jobQueue.getRepeatableJobs.mockResolvedValue([copy({ key: "stale", pattern: "0 * * * *" })]));

  it("legacy schedule matches the database: it wins and the due tick still runs", async () => {
    loadCron.mockResolvedValue("*/5 * * * *");
    await expect(go(tick({}, { tz: "Asia/Tokyo" }))).resolves.toBe("ran");
    expect(jobQueue.removeRepeatableByKey).toHaveBeenCalledWith("stale");
    expect(jobQueue.add).toHaveBeenCalledWith("scheduled-job-1", expect.objectContaining({ jobId: "1" }), expect.objectContaining({ repeat: { pattern: "*/5 * * * *", tz: "Asia/Tokyo" } }));
  });

  it("stale in-flight legacy tick: the matching job-scheduler copy (and its timezone) is kept, not overwritten", async () => {
    jobQueue.getRepeatableJobs.mockResolvedValue([copy({ key: "stale", pattern: "0 * * * *", tz: "Asia/Tokyo" })]);
    loadCron.mockResolvedValue("0 * * * *"); // newer reschedule already in job-scheduler
    await expect(go(tick())).resolves.toBe("ran");
    expect(jobQueue.add).not.toHaveBeenCalled();
    expect(jobQueue.removeRepeatableByKey).not.toHaveBeenCalled();
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
