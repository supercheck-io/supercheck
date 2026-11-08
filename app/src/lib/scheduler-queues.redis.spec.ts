/** @jest-environment node */
// Real-Redis upgrade tests: state left by the previous release must migrate to
// exactly one schedule per job/entity. Skipped unless TEST_REDIS_URL is set
// (throwaway Redis only). Every key lives under a random BullMQ prefix.
import Redis from "ioredis";
import { Queue } from "bullmq";

jest.mock("bullmq", () => {
  const actual = jest.requireActual("bullmq");
  const prefix = `test-sched-${require("crypto").randomUUID()}`;
  return {
    ...actual,
    __prefix: prefix,
    Queue: class extends actual.Queue {
      constructor(name: string, opts: object) {
        super(name, { ...opts, prefix });
      }
    },
    Worker: class extends actual.Worker {
      constructor(name: string, processor: unknown, opts: object) {
        super(name, processor, { ...opts, prefix, autorun: false });
      }
    },
  };
});

type Row = Record<string, unknown>;
let jobRows: Row[] = [];
let monitorSelects: Row[][] = [];
jest.mock("@/utils/db", () => {
  const schema = jest.requireActual("@/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            const rows = table === schema.jobs ? jobRows : (monitorSelects.shift() ?? []);
            return Object.assign(Promise.resolve(rows), { limit: async () => rows });
          },
        }),
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
  };
});
jest.mock("@/lib/monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
jest.mock("./queue", () => ({ getQueues: jest.fn() }));
jest.mock("./scheduler/job-scheduler", () => ({ processScheduledJob: jest.fn() }));

import { getQueues } from "./queue";
import { initializeJobSchedulers } from "./job-scheduler";
import { initializeMonitorSchedulers } from "./monitor-scheduler";
import { DataLifecycleService, type CleanupStrategyConfig } from "./data-lifecycle-service";

const prefix: string = jest.requireMock("bullmq").__prefix;
const suite = process.env.TEST_REDIS_URL ? describe : describe.skip;

suite("scheduler upgrade (real Redis, BullMQ)", () => {
  let redis: Redis;
  let jobQueue: Queue;
  let k6Queue: Queue;
  let monitorQueue: Queue;
  let lifecycleQueue: Queue;
  const services: DataLifecycleService[] = [];

  const JOB = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const JOB2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const NAME = (id: string) => `scheduled-job-${id}`;
  const CRON = "*/10 * * * *";
  const payload = (id: string) => ({ jobId: id, name: "k6 load", retryLimit: 3, projectId: "p", organizationId: "o" });
  const row = (id: string, extra: Row = {}) => ({
    id, name: "k6 load", cronSchedule: CRON, scheduledJobId: id, jobType: "k6", projectId: "p", organizationId: "o", ...extra,
  });

  const clear = async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.del("job:scheduler:init:lock", "monitor:scheduler:init:lock");
  };

  beforeAll(async () => {
    redis = new Redis(process.env.TEST_REDIS_URL!, { maxRetriesPerRequest: null });
    jobQueue = new Queue("job-scheduler", { connection: redis });
    k6Queue = new Queue("k6-job-scheduler", { connection: redis });
    monitorQueue = new Queue("monitor-scheduler", { connection: redis });
    lifecycleQueue = new Queue("data-lifecycle-cleanup", { connection: redis });
    (getQueues as jest.Mock).mockResolvedValue({
      jobSchedulerQueue: jobQueue,
      k6JobSchedulerQueue: k6Queue,
      monitorSchedulerQueue: monitorQueue,
      redisConnection: redis,
    });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  beforeEach(async () => {
    jobRows = [];
    monitorSelects = [];
    await clear();
  });
  afterEach(async () => {
    await Promise.all(services.splice(0).map((s) => s.shutdown()));
  });
  afterAll(async () => {
    await clear();
    await Promise.all([jobQueue, k6Queue, monitorQueue, lifecycleQueue].map((q) => q.close()));
    await redis.quit();
  });

  // ---- what the previous release wrote ------------------------------------
  const oldScheduleJob = async (id: string, cron = CRON, tz = "UTC") => {
    const existing = (await k6Queue.getRepeatableJobs()).filter((j) => j.key.includes(id) || j.name === NAME(id));
    await Promise.all(existing.map((j) => k6Queue.removeRepeatableByKey(j.key)));
    await k6Queue.add(NAME(id), payload(id), {
      repeat: { pattern: cron, tz },
      removeOnComplete: true,
      removeOnFail: 100,
      jobId: NAME(id),
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    });
  };
  const oldScheduleCleanup = async (config: CleanupStrategyConfig) => {
    const existing = (await lifecycleQueue.getRepeatableJobs()).find((j) => j.name === `${config.entityType}-cleanup`);
    if (existing) await lifecycleQueue.removeRepeatableByKey(existing.key);
    await lifecycleQueue.add(
      `${config.entityType}-cleanup`,
      { entityType: config.entityType, scheduledAt: new Date().toISOString(), manual: false, dryRun: false, config },
      { jobId: `${config.entityType}-cleanup-recurring`, repeat: { pattern: config.cronSchedule } },
    );
  };

  const shape = async (q: Queue) =>
    (await q.getRepeatableJobs()).map((j) => ({ name: j.name, pattern: j.pattern, tz: j.tz, next: j.next })).sort((a, b) => a.name.localeCompare(b.name));
  const noImmediateFire = async (q: Queue) => {
    const c = await q.getJobCounts("waiting", "active", "delayed");
    expect(c.waiting + c.active).toBe(0);
    expect(c.delayed).toBeGreaterThan(0);
  };

  describe("k6 merge", () => {
    it("moves legacy k6 repeatables to job-scheduler with the same schedule, data and next fire, then is a no-op", async () => {
      await oldScheduleJob(JOB, "*/10 * * * *", "Asia/Tokyo");
      await oldScheduleJob(JOB2, "0 3 * * 1", "UTC");
      jobRows = [row(JOB, { cronSchedule: null }), row(JOB2, { cronSchedule: null })]; // only the migration can move them
      const before = await shape(k6Queue);
      expect(before).toHaveLength(2);

      await initializeJobSchedulers();

      expect(await k6Queue.getRepeatableJobs()).toHaveLength(0);
      expect(await k6Queue.getJobCounts("delayed", "waiting")).toMatchObject({ delayed: 0, waiting: 0 });
      expect(await shape(jobQueue)).toEqual(before);
      const data = (await jobQueue.getDelayed()).map((j) => j.data).sort((a, b) => a.jobId.localeCompare(b.jobId));
      expect(data).toEqual([payload(JOB), payload(JOB2)]);
      expect((await jobQueue.getDelayed()).every((j) => j.opts.attempts === 3)).toBe(true);
      await noImmediateFire(jobQueue);

      await initializeJobSchedulers();
      expect(await shape(jobQueue)).toEqual(before);
      expect(await k6Queue.getRepeatableJobs()).toHaveLength(0);
      expect(await jobQueue.getJobCounts("delayed")).toMatchObject({ delayed: 2 });
    });

    it("reschedules a database job into job-scheduler only, replacing its legacy copy", async () => {
      await oldScheduleJob(JOB);
      jobRows = [row(JOB)];
      const before = await shape(k6Queue);
      await initializeJobSchedulers();
      expect(await k6Queue.getRepeatableJobs()).toHaveLength(0);
      expect(await shape(jobQueue)).toEqual(before);
      expect(await jobQueue.getJobCounts("delayed", "waiting")).toMatchObject({ delayed: 1, waiting: 0 });
    });

    it("drops a legacy repeatable for a job that no longer exists", async () => {
      await oldScheduleJob(JOB);
      jobRows = [];
      await initializeJobSchedulers();
      expect(await k6Queue.getRepeatableJobs()).toHaveLength(0);
      expect(await jobQueue.getRepeatableJobs()).toHaveLength(0);
    });

    it("converges to one schedule when an old replica runs concurrently with, and after, a new one", async () => {
      jobRows = [row(JOB)];
      await initializeJobSchedulers();
      await Promise.all([oldScheduleJob(JOB), initializeJobSchedulers()]);
      await oldScheduleJob(JOB); // old replica restarts after the new one finished
      expect((await k6Queue.getRepeatableJobs()).length + (await jobQueue.getRepeatableJobs()).length).toBe(2);

      await initializeJobSchedulers(); // the next new-replica init
      expect(await k6Queue.getRepeatableJobs()).toHaveLength(0);
      expect(await jobQueue.getRepeatableJobs()).toHaveLength(1);
      expect(await jobQueue.getJobCounts("delayed", "waiting")).toMatchObject({ delayed: 1, waiting: 0 });
    });
  });

  describe("data-lifecycle repeat", () => {
    const config = { entityType: "monitor_results", enabled: true, cronSchedule: "0 2 * * *", retentionDays: 30 } as CleanupStrategyConfig;
    const config2 = { entityType: "job_runs", enabled: true, cronSchedule: "30 4 * * *", retentionDays: 30 } as CleanupStrategyConfig;
    const start = async () => {
      const service = new DataLifecycleService([config, config2]);
      services.push(service);
      await service.initialize(redis);
    };

    it("replaces legacy repeatables with one scheduler per entity, keeping pattern and next fire", async () => {
      await oldScheduleCleanup(config);
      await oldScheduleCleanup(config2);
      const before = await shape(lifecycleQueue);
      expect((await lifecycleQueue.getRepeatableJobs()).every((j) => j.key !== j.name)).toBe(true);

      await start();

      const after = await lifecycleQueue.getRepeatableJobs();
      expect(after.map((j) => j.key).sort()).toEqual(["job_runs-cleanup", "monitor_results-cleanup"]);
      expect((await shape(lifecycleQueue)).map(({ name, pattern, next }) => ({ name, pattern, next }))).toEqual(before.map(({ name, pattern, next }) => ({ name, pattern, next })));
      const scheduler = await lifecycleQueue.getJobScheduler("monitor_results-cleanup");
      expect(scheduler?.pattern).toBe("0 2 * * *");
      expect(scheduler?.template?.data).toMatchObject({ entityType: "monitor_results", manual: false, dryRun: false });
      expect((await lifecycleQueue.getRepeatableJobs()).map((j) => j.next).sort()).toEqual(before.map((b) => b.next).sort());
      await noImmediateFire(lifecycleQueue);
      expect(await lifecycleQueue.getJobCounts("delayed")).toMatchObject({ delayed: 2 });
    });

    it("second start is a no-op", async () => {
      await start();
      const first = await shape(lifecycleQueue);
      await services.pop()!.shutdown();
      await start();
      expect(await shape(lifecycleQueue)).toEqual(first);
      expect(await lifecycleQueue.getJobCounts("delayed", "waiting")).toMatchObject({ delayed: 2, waiting: 0 });
    });

    it("old replica start after a new one leaves one schedule per entity, and the next new start converges", async () => {
      await start();
      await oldScheduleCleanup(config); // old code finds our scheduler by name, removes it, adds its legacy repeatable
      await oldScheduleCleanup(config2);
      const names = (await lifecycleQueue.getRepeatableJobs()).map((j) => j.name).sort();
      expect(names).toEqual(["job_runs-cleanup", "monitor_results-cleanup"]);

      await start();
      const after = await lifecycleQueue.getRepeatableJobs();
      expect(after.map((j) => j.key).sort()).toEqual(["job_runs-cleanup", "monitor_results-cleanup"]);
      expect(await lifecycleQueue.getJobCounts("delayed", "waiting")).toMatchObject({ delayed: 2, waiting: 0 });
    });

    it("converges when old and new starts run concurrently", async () => {
      await oldScheduleCleanup(config);
      await Promise.all([oldScheduleCleanup(config), oldScheduleCleanup(config2), start()]);
      await start();
      const after = await lifecycleQueue.getRepeatableJobs();
      expect(after.map((j) => j.key).sort()).toEqual(["job_runs-cleanup", "monitor_results-cleanup"]);
    });
  });

  describe("monitor orphan cleanup", () => {
    const M_ENABLED = "11111111-1111-1111-1111-111111111111";
    const M_DELETED = "22222222-2222-2222-2222-222222222222";
    const M_DISABLED = "33333333-3333-3333-3333-333333333333";
    const oldScheduleMonitor = (id: string) =>
      monitorQueue.add(`scheduled-monitor-${id}`, { monitorId: id }, { repeat: { every: 300000 }, removeOnComplete: true, removeOnFail: 100, jobId: `scheduled-monitor-${id}` });

    it("keeps an enabled monitor whose scheduledJobId is not written yet; removes deleted and disabled ones", async () => {
      await Promise.all([M_ENABLED, M_DELETED, M_DISABLED].map(oldScheduleMonitor));
      monitorSelects = [
        [
          { id: M_ENABLED, enabled: true, scheduledJobId: null },
          { id: M_DISABLED, enabled: false, scheduledJobId: M_DISABLED },
        ],
        [], // no active monitors to re-schedule
      ];
      await initializeMonitorSchedulers();
      expect((await monitorQueue.getRepeatableJobs()).map((j) => j.name)).toEqual([`scheduled-monitor-${M_ENABLED}`]);
    });
  });
});
