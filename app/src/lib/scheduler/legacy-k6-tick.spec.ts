/** @jest-environment node */
import type { Job, Queue } from "bullmq";
import { processLegacyK6Tick } from "./legacy-k6-tick";

const jobQueue = { getRepeatableJobs: jest.fn(), removeRepeatableByKey: jest.fn(), add: jest.fn() };
const k6Queue = { removeRepeatableByKey: jest.fn() };
const queues = { jobSchedulerQueue: jobQueue as unknown as Queue, k6JobSchedulerQueue: k6Queue as unknown as Queue };
const run = jest.fn();
const tick = (over: Partial<{ id: string; pattern: string; tz: string }> = {}) =>
  ({
    id: "repeat:abc:123",
    name: "scheduled-job-1",
    data: { jobId: "1" },
    opts: { repeat: { pattern: "*/5 * * * *", tz: "UTC", ...over } },
    ...(over.id ? { id: over.id } : {}),
  }) as unknown as Job;

beforeEach(() => {
  jest.resetAllMocks();
  run.mockResolvedValue("ran");
});

it("processes a job that is not a repeat tick, or has no pattern, untouched", async () => {
  await processLegacyK6Tick(tick({ id: "manual-1" }), queues, run);
  await processLegacyK6Tick({ id: "repeat:abc:1", name: "n", data: {}, opts: {} } as unknown as Job, queues, run);
  expect(run).toHaveBeenCalledTimes(2);
  expect(jobQueue.getRepeatableJobs).not.toHaveBeenCalled();
});

it("migrates then runs when job-scheduler has no schedule for the job", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([{ name: "other", key: "o", pattern: "* * * * *", tz: "UTC" }]);
  await expect(processLegacyK6Tick(tick(), queues, run)).resolves.toBe("ran");
  expect(jobQueue.add).toHaveBeenCalledWith("scheduled-job-1", { jobId: "1" }, expect.objectContaining({ repeat: { pattern: "*/5 * * * *", tz: "UTC" }, jobId: "scheduled-job-1" }));
  expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("abc");
  expect(jobQueue.removeRepeatableByKey).not.toHaveBeenCalled();
});

it("skips and removes the legacy entry when job-scheduler already has the same schedule (null tz is UTC)", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([{ name: "scheduled-job-1", key: "k", pattern: "*/5 * * * *", tz: null }]);
  await expect(processLegacyK6Tick(tick(), queues, run)).resolves.toBeUndefined();
  expect(run).not.toHaveBeenCalled();
  expect(jobQueue.add).not.toHaveBeenCalled();
  expect(k6Queue.removeRepeatableByKey).toHaveBeenCalledWith("abc");
});

it("replaces a different job-scheduler schedule with the legacy one and skips the tick", async () => {
  jobQueue.getRepeatableJobs.mockResolvedValue([{ name: "scheduled-job-1", key: "stale", pattern: "0 * * * *", tz: "UTC" }]);
  await expect(processLegacyK6Tick(tick({ tz: "Asia/Tokyo" }), queues, run)).resolves.toBeUndefined();
  expect(jobQueue.removeRepeatableByKey).toHaveBeenCalledWith("stale");
  expect(jobQueue.add).toHaveBeenCalledWith("scheduled-job-1", { jobId: "1" }, expect.objectContaining({ repeat: { pattern: "*/5 * * * *", tz: "Asia/Tokyo" } }));
  expect(run).not.toHaveBeenCalled();
});
