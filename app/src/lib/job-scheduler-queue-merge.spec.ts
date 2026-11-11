/** @jest-environment node */
// Stateful fake queues: a job fires once per queue that holds a repeatable for it,
// so "exactly one repeatable across both queues" means "exactly one firing per tick".
type Repeatable = { key: string; name: string; pattern: string; tz: string | null; data: Record<string, unknown> };

function fakeQueue() {
  const repeatables = new Map<string, Repeatable>();
  return {
    repeatables,
    getRepeatableJobs: jest.fn(async () => [...repeatables.values()].map(({ data: _data, ...rest }) => ({ ...rest, next: 1 }))),
    removeRepeatableByKey: jest.fn(async (key: string) => repeatables.delete(key)),
    getJob: jest.fn(async (id: string) => {
      const found = [...repeatables.values()].find((r) => id === `repeat:${r.key}:1`);
      return found ? { data: found.data } : undefined;
    }),
    add: jest.fn(async (name: string, data: Record<string, unknown>, opts: { repeat: { pattern: string; tz: string }; jobId: string }) => {
      const key = `${name}:${opts.jobId}:::${opts.repeat.tz}:${opts.repeat.pattern}`;
      repeatables.set(key, { key, name, pattern: opts.repeat.pattern, tz: opts.repeat.tz, data });
    }),
    client: Promise.resolve({ ping: jest.fn(), set: jest.fn().mockResolvedValue("OK"), eval: jest.fn() }),
  };
}

const jobQueue = fakeQueue();
const k6Queue = fakeQueue();
let rows: Record<string, unknown>[] = [];
let lookup: Record<string, unknown>[] = [];

jest.mock("./queue", () => ({ getQueues: async () => ({ jobSchedulerQueue: jobQueue, k6JobSchedulerQueue: k6Queue }) }));
jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Object.assign(Promise.resolve(rows), { limit: async () => lookup }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));
jest.mock("drizzle-orm", () => ({ eq: jest.fn(), and: jest.fn(), isNotNull: jest.fn(), isNull: jest.fn() }));
jest.mock("@/db/schema", () => ({ jobs: {} }));
jest.mock("@/lib/cron-utils", () => ({ getNextRunDate: () => new Date("2030-01-01T00:00:00Z") }));
jest.mock("./data-lifecycle-service", () => ({ createDataLifecycleService: jest.fn(), setDataLifecycleInstance: jest.fn() }));
jest.mock("./scheduler/job-scheduler", () => ({ processScheduledJob: jest.fn() }));

import { deleteScheduledJob, initializeJobSchedulers, scheduleJob } from "./job-scheduler";

const JOB = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const NAME = `scheduled-job-${JOB}`;
const CRON = "*/5 * * * *";
const payload = { jobId: JOB, name: "k6 load", retryLimit: 3, projectId: "p", organizationId: "o" };
const dbJob = { id: JOB, name: "k6 load", cronSchedule: CRON, scheduledJobId: JOB, jobType: "k6", projectId: "p", organizationId: "o" };
const noCron = { ...dbJob, cronSchedule: null };
const total = () => jobQueue.repeatables.size + k6Queue.repeatables.size;

// What an old (pre-merge) replica leaves behind for a k6 job.
function oldReplicaSchedules(pattern = CRON, tz = "UTC") {
  const key = `${NAME}:${NAME}:::${tz}:${pattern}`;
  k6Queue.repeatables.set(key, { key, name: NAME, pattern, tz, data: payload });
}

beforeEach(() => {
  jest.clearAllMocks();
  jobQueue.repeatables.clear();
  k6Queue.repeatables.clear();
  rows = [dbJob];
  lookup = [dbJob];
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("scheduleJob", () => {
  it("sends a k6 job to job-scheduler and never to the legacy queue", async () => {
    await scheduleJob({ name: "k6 load", cron: CRON, jobId: JOB });
    expect(k6Queue.add).not.toHaveBeenCalled();
    expect([...jobQueue.repeatables.values()]).toEqual([
      expect.objectContaining({ name: NAME, pattern: CRON, tz: "UTC", data: payload }),
    ]);
  });

  it("replaces a legacy k6 repeatable instead of leaving two schedules", async () => {
    oldReplicaSchedules("0 * * * *");
    await scheduleJob({ name: "k6 load", cron: CRON, jobId: JOB, timezone: "Europe/Paris" });
    expect(k6Queue.repeatables.size).toBe(0);
    expect([...jobQueue.repeatables.values()].map((r) => [r.pattern, r.tz])).toEqual([[CRON, "Europe/Paris"]]);
  });
});

describe("deleteScheduledJob", () => {
  it("removes the schedule from both queues", async () => {
    oldReplicaSchedules();
    await scheduleJob({ name: "k6 load", cron: CRON, jobId: JOB }); // job-scheduler copy
    oldReplicaSchedules(); // an old replica re-added the legacy copy
    expect(total()).toBe(2);
    await expect(deleteScheduledJob(JOB)).resolves.toBe(true);
    expect(total()).toBe(0);
  });
});

describe("initializeJobSchedulers k6 migration", () => {
  it("moves a legacy repeatable with the same schedule and data, leaving exactly one", async () => {
    oldReplicaSchedules("*/10 * * * *", "Asia/Tokyo");
    rows = [noCron]; // the DB pass skips it (no cron): only the migration can move it
    await initializeJobSchedulers();
    expect(k6Queue.repeatables.size).toBe(0);
    expect([...jobQueue.repeatables.values()]).toEqual([
      expect.objectContaining({ name: NAME, pattern: "*/10 * * * *", tz: "Asia/Tokyo", data: payload }),
    ]);
  });

  it("is idempotent when run again, and when the schedule already exists in job-scheduler", async () => {
    rows = [noCron];
    oldReplicaSchedules();
    await initializeJobSchedulers();
    await initializeJobSchedulers();
    expect(total()).toBe(1);

    oldReplicaSchedules(); // legacy copy appears next to an existing migrated one
    await initializeJobSchedulers();
    expect(total()).toBe(1);
    expect(k6Queue.repeatables.size).toBe(0);
  });

  it("converges to one firing when an old replica re-adds a k6 schedule after the migration", async () => {
    await initializeJobSchedulers(); // new replica starts first
    expect(total()).toBe(1);
    oldReplicaSchedules(); // old replica restarts or edits mid-rollout: two firings until...
    expect(total()).toBe(2);
    await initializeJobSchedulers(); // ...the next new-replica init
    expect(total()).toBe(1);
    expect(jobQueue.repeatables.size).toBe(1);
  });

  it("does nothing with an empty legacy queue", async () => {
    rows = [];
    await initializeJobSchedulers();
    expect(jobQueue.getRepeatableJobs).toHaveBeenCalledTimes(1); // cleanup only
    expect(k6Queue.getJob).not.toHaveBeenCalled();
  });

  it("leaves an unreadable legacy entry for the database pass to replace", async () => {
    oldReplicaSchedules();
    k6Queue.getJob.mockResolvedValueOnce(undefined); // active/waiting tick: payload not readable
    rows = [dbJob];
    await initializeJobSchedulers();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Cannot migrate"));
    expect(k6Queue.repeatables.size).toBe(0);
    expect(jobQueue.repeatables.size).toBe(1);
  });

  it("keeps the legacy entry when the move fails, and survives a failed lookup", async () => {
    oldReplicaSchedules();
    rows = [noCron];
    jobQueue.add.mockRejectedValueOnce(new Error("redis"));
    await initializeJobSchedulers();
    expect(k6Queue.repeatables.size).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to migrate legacy k6 schedule"), expect.any(Error));

    // first call is the orphan cleanup (which tolerates it), second is the migration
    k6Queue.getRepeatableJobs.mockRejectedValueOnce(new Error("redis")).mockRejectedValueOnce(new Error("redis"));
    await expect(initializeJobSchedulers()).resolves.toBeDefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to migrate legacy k6 schedules"), expect.any(Error));
  });
});
