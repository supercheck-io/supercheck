/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { db } from "@/utils/db";
import { monitorResults, reports, runs } from "@/db/schema";
import { isPolarEnabled } from "./feature-flags";
import { createS3CleanupService } from "./s3-cleanup";
import { DataLifecycleService, MonitorResultsCleanupStrategy, JobRunsCleanupStrategy, PlaygroundArtifactsCleanupStrategy } from "./data-lifecycle-service";

jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), delete: jest.fn(), update: jest.fn(), transaction: jest.fn() } }));
jest.mock("./feature-flags", () => ({ isPolarEnabled: jest.fn() }));
jest.mock("./monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
jest.mock("./s3-cleanup", () => ({ createS3CleanupService: jest.fn() }));
jest.mock("@aws-sdk/client-s3", () => ({ ...jest.requireActual("@aws-sdk/client-s3"), S3Client: jest.fn() }));
jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    getRepeatableJobs: jest.fn().mockResolvedValue([]), add: jest.fn().mockResolvedValue({}),
  })),
  QueueEvents: jest.fn(),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

const monitorConfig = { entityType: "monitor_results" as const, enabled: true, cronSchedule: "0 2 * * *", retentionDays: 30, batchSize: 10, maxRecordsPerRun: 10 };
const jobConfig = { ...monitorConfig, entityType: "job_runs" as const, retentionDays: 90 };
const oldResult = { id: "result-1", monitorId: "monitor-1", status: "down", isStatusChange: false, testExecutionId: "test-ab12", testReportS3Url: "http://storage:9000/monitors/test-ab12/report/index.html" };
const s3Success = { success: true, deletedObjects: ["test-ab12/report/index.html"], failedObjects: [], totalAttempted: 1 };

describe("Artifact retention strategies", () => {
  const deleteReports = jest.fn();
  const deleteObjectsBatch = jest.fn();
  const send = jest.fn();
  let selections: unknown[][];
  let predicates: SQL[];
  let limits: number[];
  let orderings: SQL[][];
  let events: string[];
  const deleteWhere = jest.fn();
  const updateSet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    selections = [];
    predicates = [];
    limits = [];
    orderings = [];
    events = [];
    jest.mocked(isPolarEnabled).mockReturnValue(true);
    jest.mocked(db.select).mockImplementation(() => {
      const query: {
        from: () => typeof query;
        where: (condition: SQL) => typeof query;
        limit: (limit: number) => typeof query;
        orderBy: (...columns: SQL[]) => typeof query;
        as: (alias: string) => { isStatusChange: typeof monitorResults.isStatusChange };
        then: (resolve: (rows: unknown[]) => unknown) => Promise<unknown>;
      } = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn((condition: SQL) => { predicates.push(condition); return query; }),
        limit: jest.fn((limit: number) => { limits.push(limit); return query; }),
        orderBy: jest.fn((...columns: SQL[]) => { orderings.push(columns); return query; }),
        as: jest.fn(() => ({ isStatusChange: monitorResults.isStatusChange })),
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(selections.shift() || []).then(resolve),
      };
      return query as unknown as ReturnType<typeof db.select>;
    });
    deleteWhere.mockResolvedValue(undefined);
    jest.mocked(db.delete).mockImplementation(table => {
      events.push(table === reports ? "delete-reports" : table === runs ? "delete-runs" : "delete-results");
      return { where: deleteWhere } as unknown as ReturnType<typeof db.delete>;
    });
    updateSet.mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    jest.mocked(db.update).mockImplementation(() => ({ set: updateSet }) as unknown as ReturnType<typeof db.update>);
    jest.mocked(db.transaction).mockImplementation(async callback => callback(db as unknown as Parameters<typeof callback>[0]));
    deleteReports.mockImplementation(async () => { events.push("s3"); return s3Success; });
    deleteObjectsBatch.mockResolvedValue(s3Success);
    jest.mocked(createS3CleanupService).mockReturnValue({ deleteReports, deleteObjectsBatch, getBucketForEntityType: (type: string) => ({job: "playwright-job-artifacts", k6_job: "k6-job-artifacts", test: "playwright-test-artifacts", k6_test: "k6-test-artifacts"}[type]) } as unknown as ReturnType<typeof createS3CleanupService>);
    jest.mocked(S3Client).mockImplementation(() => ({ send }) as unknown as S3Client);
  });

  afterEach(() => jest.restoreAllMocks());

  function monitorSelections(rows = [oldResult]) {
    selections = [[{ organizationId: "org-1", subscriptionPlan: "plus" }], [{ plan: "plus", dataRetentionDays: 7 }], [{ id: "monitor-1" }], rows, []];
  }

  it("deletes monitor artifacts and report metadata before deleting results", async () => {
    monitorSelections();
    const result = await new MonitorResultsCleanupStrategy(monitorConfig).execute();
    expect(deleteReports).toHaveBeenCalledWith([expect.objectContaining({ entityType: "monitor", reportPath: "test-ab12", s3Url: oldResult.testReportS3Url })]);
    expect(events).toEqual(["s3", "delete-reports", "delete-results"]);
    expect(result).toMatchObject({ success: true, recordsDeleted: 1, s3ObjectsDeleted: 1 });
    expect(db.transaction).toHaveBeenCalled();
  });

  it.each([false, true])("preserves monitor DB pointers after S3 failure (status change: %s)", async isStatusChange => {
    monitorSelections([{ ...oldResult, isStatusChange }]);
    deleteReports.mockResolvedValue({ ...s3Success, success: false, failedObjects: [{ key: "test-ab12/report/index.html", error: "Access denied" }] });
    const result = await new MonitorResultsCleanupStrategy(monitorConfig).execute();
    expect(result.success).toBe(false);
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("expires status-change artifacts but preserves the historical result", async () => {
    monitorSelections([{ ...oldResult, isStatusChange: true }]);
    const result = await new MonitorResultsCleanupStrategy(monitorConfig).execute();
    expect(deleteReports).toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalledWith(monitorResults);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ testExecutionId: null, testReportS3Url: null }));
    expect(result.recordsDeleted).toBe(0);
    expect(result.s3ObjectsDeleted).toBe(1);
  });

  it("cleans successful synthetic metadata without sending S3 requests", async () => {
    monitorSelections([{ ...oldResult, status: "up", testReportS3Url: null } as unknown as typeof oldResult]);
    const result = await new MonitorResultsCleanupStrategy(monitorConfig).execute();
    expect(result.recordsDeleted).toBe(1);
    expect(deleteReports).not.toHaveBeenCalled();
  });

  it("honors plan-specific cutoffs and scopes both organization and monitor queries", async () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-15T12:00:00Z"));
    selections = [[{ organizationId: "org-plus", subscriptionPlan: "plus" }, { organizationId: "org-pro", subscriptionPlan: "pro" }],
      [{ plan: "plus", dataRetentionDays: 7 }, { plan: "pro", dataRetentionDays: 30 }],
      [{ id: "monitor-plus" }], [], [{ id: "monitor-pro" }], []];
    await new MonitorResultsCleanupStrategy(monitorConfig).execute();
    const queries = predicates.map(p => new PgDialect().sqlToQuery(p));
    expect(queries.some(q => q.params.includes("org-plus"))).toBe(true);
    expect(queries.some(q => q.params.includes("org-pro"))).toBe(true);
    expect(queries.some(q => q.params.includes("monitor-plus") && q.params.includes("2026-10-08T12:00:00.000Z"))).toBe(true);
    expect(queries.some(q => q.params.includes("monitor-pro") && q.params.includes("2026-09-15T12:00:00.000Z"))).toBe(true);
  });

  it("uses the database unlimited retention in self-hosted mode", async () => {
    jest.mocked(isPolarEnabled).mockReturnValue(false);
    selections = [[{ id: "org-1" }], [{ dataRetentionDays: 7 }], [{ id: "monitor-1" }], [oldResult]];
    const result = await new MonitorResultsCleanupStrategy({ ...monitorConfig, maxRecordsPerRun: 1 }).execute();
    expect(result.recordsDeleted).toBe(1);
    expect(limits.at(-1)).toBe(1);
  });

  it("includes monitor artifact cleanup in the global fallback", async () => {
    selections = [[], [], [oldResult]];
    const result = await new MonitorResultsCleanupStrategy({ ...monitorConfig, maxRecordsPerRun: 1 }).execute();
    expect(deleteReports).toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, recordsDeleted: 1, s3ObjectsDeleted: 1 });
  });

  it("reports global dry-run processed rows separately from deletions", async () => {
    selections = [[], [], [{ count: 2, deleteCount: 1 }]];
    const result = await new MonitorResultsCleanupStrategy({ ...monitorConfig, maxRecordsPerRun: 2 }).execute(true);
    expect(result.recordsDeleted).toBe(1);
    expect(result.details.recordsProcessed).toBe(2);
    expect(deleteReports).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it.each(["tenant", "global"])("bounds the ordered %s dry-run subset before counting historical rows", async mode => {
    if (mode === "tenant") {
      monitorSelections();
      selections[3] = [{ count: 2, deleteCount: 0 }];
    } else selections = [[], [], [{ count: 2, deleteCount: 0 }]];
    const result = await new MonitorResultsCleanupStrategy({ ...monitorConfig, maxRecordsPerRun: 2 }).execute(true);
    expect(result).toMatchObject({ recordsDeleted: 0, details: { recordsProcessed: 2 } });
    expect(limits).toEqual([2]);
    const ordering = orderings.flat().map(column => new PgDialect().sqlToQuery(column).sql).join(" ");
    expect(ordering).toContain("checked_at");
    expect(ordering).toContain('"id"');
  });

  it("continues later monitor tenants after a failed batch while retaining retry pointers", async () => {
    selections = [[{ organizationId: "org-1", subscriptionPlan: "plus" }, { organizationId: "org-2", subscriptionPlan: "plus" }],
      [{ plan: "plus", dataRetentionDays: 7 }], [{ id: "monitor-1" }], [oldResult],
      [{ id: "monitor-2" }], [{ ...oldResult, id: "result-2", testExecutionId: "test-good" }]];
    deleteReports.mockResolvedValueOnce({ ...s3Success, success: false, failedObjects: [{ key: "test-ab12/report/index.html", error: "Denied" }] })
      .mockResolvedValueOnce(s3Success);
    const result = await new MonitorResultsCleanupStrategy({ ...monitorConfig, maxRecordsPerRun: 2 }).execute();
    expect(result).toMatchObject({ success: false, recordsDeleted: 1, details: { recordsProcessed: 2 } });
    expect(deleteReports).toHaveBeenCalledTimes(2);
    const deleted = deleteWhere.mock.calls.map(([condition]) => new PgDialect().sqlToQuery(condition).params).flat();
    expect(deleted).toContain("result-2");
    expect(deleted).not.toContain("result-1");
  });

  it("charges failed monitor batches against the shared safety limit", async () => {
    selections = [[{ organizationId: "org-1", subscriptionPlan: "plus" }, { organizationId: "org-2", subscriptionPlan: "plus" }],
      [{ plan: "plus", dataRetentionDays: 7 }], [{ id: "monitor-1" }], [oldResult]];
    deleteReports.mockResolvedValue({ ...s3Success, success: false, failedObjects: [{ key: "test-ab12", error: "Denied" }] });
    const result = await new MonitorResultsCleanupStrategy({ ...monitorConfig, maxRecordsPerRun: 1 }).execute();
    expect(result).toMatchObject({ success: false, recordsDeleted: 0, details: { recordsProcessed: 1 } });
    expect(deleteReports).toHaveBeenCalledTimes(1);
  });

  it("makes no S3 or DB mutations in dry-run mode", async () => {
    monitorSelections();
    selections[3] = [{ count: 3, deleteCount: 2 }];
    await new MonitorResultsCleanupStrategy(monitorConfig).execute(true);
    expect(deleteReports).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it.each(["monitor", "job"])("fails closed when %s plan lookup fails", async entity => {
    jest.mocked(db.select).mockImplementationOnce(() => { throw new Error("DB unavailable"); });
    const strategy = entity === "monitor" ? new MonitorResultsCleanupStrategy(monitorConfig) : new JobRunsCleanupStrategy(jobConfig);
    const result = await strategy.execute();
    expect(result.success).toBe(false);
    expect(db.delete).not.toHaveBeenCalled();
    expect(deleteReports).not.toHaveBeenCalled();
  });

  function jobSelections(mode: "tenant" | "global" | "playground") {
    const report = { id: "report-1", entityType: mode === "playground" ? "k6_test" : "k6_job", entityId: "run-1", reportPath: "run-1/report", s3Url: null };
    const run = { id: "run-1", jobId: mode === "playground" ? null : "job-1", artifactPaths: null };
    if (mode === "global") selections = [[], [], [run], [report]];
    else selections = [[{ organizationId: "org-1", subscriptionPlan: "plus" }], [{ plan: "plus", jobDataRetentionDays: 30 }],
      mode === "playground" ? [] : [{ id: "job-1" }], [run], [report], []];
  }

  it.each(["tenant", "global", "playground"] as const)("retains %s run/report rows on S3 failure", async mode => {
    jobSelections(mode);
    deleteReports.mockResolvedValue({ ...s3Success, success: false, failedObjects: [{ key: "run-1/metrics.json", error: "Access denied" }] });
    const result = await new JobRunsCleanupStrategy(jobConfig).execute();
    expect(result.success).toBe(false);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it.each([true, false])("cleans persisted k6 run URLs without report metadata (S3 success: %s)", async success => {
    jobSelections("tenant");
    selections[3] = [{ id: "run-1", reportS3Url: "http://storage:9000/k6-job-artifacts/run-1/report/index.html", logsS3Url: "http://storage:9000/k6-job-artifacts/run-1/report/console.log" }];
    selections[4] = [];
    deleteReports.mockResolvedValue({ ...s3Success, success, failedObjects: success ? [] : [{ key: "run-1/metrics.json", error: "Denied" }] });
    const result = await new JobRunsCleanupStrategy(jobConfig).execute();
    expect(deleteReports).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ entityId: "run-1", entityType: "k6_job", reportPath: "run-1" })]));
    expect(result.success).toBe(success);
    if (!success) expect(db.delete).not.toHaveBeenCalled();
    else expect(db.delete).toHaveBeenCalledWith(runs);
  });

  it("refuses missing-metadata URL cleanup for a different execution", async () => {
    jobSelections("tenant");
    selections[3] = [{ id: "run-1", reportS3Url: "http://storage:9000/k6-job-artifacts/run-2/report/index.html" }];
    selections[4] = [];
    const result = await new JobRunsCleanupStrategy(jobConfig).execute();
    expect(result.success).toBe(false);
    expect(deleteReports).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it.each(["not-a-url", "http://storage:9000/k6-job-artifacts/run-other/report/index.html"])("retains a corrupt run URL %s and still cleans healthy runs", async reportS3Url => {
    jobSelections("tenant");
    selections[3] = [
      { id: "run-bad", reportS3Url },
      { id: "run-good", reportS3Url: "http://storage:9000/k6-job-artifacts/run-good/report/index.html" },
    ];
    selections[4] = [];
    const result = await new JobRunsCleanupStrategy(jobConfig).execute();
    expect(result).toMatchObject({ success: false, recordsDeleted: 1, details: { recordsProcessed: 2 } });
    expect(deleteReports).toHaveBeenCalledWith([expect.objectContaining({ entityId: "run-good" })]);
    const deleted = deleteWhere.mock.calls.map(([condition]) => new PgDialect().sqlToQuery(condition).params).flat();
    expect(deleted).toContain("run-good");
    expect(deleted).not.toContain("run-bad");
  });

  it("does not queue any URL for a run whose second pointer is invalid", async () => {
    jobSelections("tenant");
    selections[3] = [{ id: "run-1", reportS3Url: "http://storage:9000/k6-job-artifacts/run-1/report/index.html", logsS3Url: "broken" }];
    selections[4] = [];
    const result = await new JobRunsCleanupStrategy(jobConfig).execute();
    expect(result.success).toBe(false);
    expect(deleteReports).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("excludes corrupt run IDs from subsequent bounded batches", async () => {
    selections = [[{ organizationId: "org-1", subscriptionPlan: "plus" }], [{ plan: "plus", jobDataRetentionDays: 30 }], [{ id: "job-1" }],
      [{ id: "run-bad", reportS3Url: "broken" }], [],
      [{ id: "run-good", reportS3Url: "http://storage:9000/k6-job-artifacts/run-good/report/index.html" }], []];
    const result = await new JobRunsCleanupStrategy({ ...jobConfig, batchSize: 1, maxRecordsPerRun: 2 }).execute();
    expect(result).toMatchObject({ success: false, recordsDeleted: 1, details: { recordsProcessed: 2 } });
    expect(predicates.some(p => {
      const q = new PgDialect().sqlToQuery(p);
      return q.sql.includes("not in") && q.params.includes("run-bad");
    })).toBe(true);
    expect(limits).toEqual([1, 1]);
  });

  it("continues later job tenants after an S3 failure without exceeding the work limit", async () => {
    const report = { id: "report-1", entityType: "k6_job", entityId: "run-1", reportPath: "run-1/report", s3Url: null };
    selections = [[{ organizationId: "org-1", subscriptionPlan: "plus" }, { organizationId: "org-2", subscriptionPlan: "plus" }],
      [{ plan: "plus", jobDataRetentionDays: 30 }], [{ id: "job-1" }], [{ id: "run-1" }], [report],
      [{ id: "job-2" }], [{ id: "run-2" }], [{ ...report, id: "report-2", entityId: "run-2", reportPath: "run-2/report" }]];
    deleteReports.mockResolvedValueOnce({ ...s3Success, success: false, failedObjects: [{ key: "run-1/report", error: "Denied" }] })
      .mockResolvedValueOnce(s3Success);
    const result = await new JobRunsCleanupStrategy({ ...jobConfig, maxRecordsPerRun: 2 }).execute();
    expect(result).toMatchObject({ success: false, recordsDeleted: 1, details: { recordsProcessed: 2 } });
    const deleted = deleteWhere.mock.calls.map(([condition]) => new PgDialect().sqlToQuery(condition).params).flat();
    expect(deleted).toContain("run-2");
    expect(deleted).not.toContain("run-1");
    expect(limits).toEqual([2, 1]);
  });

  it("processes additional job batches up to the exact safety limit", async () => {
    selections = [[{ organizationId: "org-1", subscriptionPlan: "plus" }], [{ plan: "plus", jobDataRetentionDays: 30 }], [{ id: "job-1" }],
      [{ id: "run-1" }, { id: "run-2" }], [], [{ id: "run-3" }], []];
    const result = await new JobRunsCleanupStrategy({ ...jobConfig, batchSize: 2, maxRecordsPerRun: 3 }).execute();
    expect(result.recordsDeleted).toBe(3);
    expect(limits).toEqual([2, 1]);
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });

  it("counts preserved monitor history as updates, not deletions, in dry-run", async () => {
    monitorSelections();
    selections[3] = [{ count: 3, deleteCount: 0 }];
    const result = await new MonitorResultsCleanupStrategy(monitorConfig).execute(true);
    expect(result.recordsDeleted).toBe(0);
    expect(result.details.recordsProcessed).toBe(3);
    expect(db.update).not.toHaveBeenCalled();
  });

  it.each(["monitor", "job"])("reports %s database transaction failures", async entity => {
    if (entity === "monitor") monitorSelections(); else jobSelections("tenant");
    jest.mocked(db.transaction).mockRejectedValueOnce(new Error("Transaction failed"));
    const strategy = entity === "monitor" ? new MonitorResultsCleanupStrategy(monitorConfig) : new JobRunsCleanupStrategy(jobConfig);
    const result = await strategy.execute();
    expect(result.success).toBe(false);
    expect(result.recordsDeleted).toBe(0);
    expect(result.errors).toContain("Transaction failed");
  });

  it("deletes k6 job reports and runs only after S3 succeeds", async () => {
    jobSelections("tenant");
    const result = await new JobRunsCleanupStrategy(jobConfig).execute();
    expect(events).toEqual(["s3", "delete-reports", "delete-runs"]);
    expect(result).toMatchObject({ success: true, recordsDeleted: 1, s3ObjectsDeleted: 1 });
  });

  it("deletes exact expired playground keys without directory expansion", async () => {
    const old = new Date(Date.now() - 48 * 3600000);
    send.mockImplementation(async command => {
      if (command instanceof HeadBucketCommand) return {};
      if (command instanceof ListObjectsV2Command) return { Contents: [
        { Key: "run-1/metrics.json", LastModified: old },
        { Key: "run-1/report/index.html", LastModified: new Date() },
      ] };
      throw new Error("Unexpected operation");
    });
    const result = await new PlaygroundArtifactsCleanupStrategy({ entityType: "playground_artifacts", enabled: true, cronSchedule: "0 5 * * *", customConfig: { maxAgeHours: 24 } }).execute();
    expect(deleteObjectsBatch).toHaveBeenCalledWith("playwright-test-artifacts", ["run-1/metrics.json"]);
    expect(deleteObjectsBatch).toHaveBeenCalledWith("k6-test-artifacts", ["run-1/metrics.json"]);
    expect(deleteReports).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("reports bucket access errors as failures", async () => {
    send.mockRejectedValue(new Error("Access denied"));
    const result = await new PlaygroundArtifactsCleanupStrategy({ entityType: "playground_artifacts", enabled: true, cronSchedule: "0 5 * * *", customConfig: { maxAgeHours: 24 } }).execute();
    expect(result.success).toBe(false);
    expect(result.errors).not.toHaveLength(0);
  });

  it("throws failed cleanup results to activate BullMQ retries and releases the lock", async () => {
    const redis = { set: jest.fn().mockResolvedValue("OK"), del: jest.fn().mockResolvedValue(1) };
    const service = new DataLifecycleService([monitorConfig]);
    await service.initialize(redis as unknown as Redis);
    const processor = jest.mocked(Worker).mock.calls[0][1];
    if (typeof processor !== "function") throw new Error("Missing queue processor");
    const execute = jest.spyOn(MonitorResultsCleanupStrategy.prototype, "execute").mockResolvedValue({
      success: false, entityType: "monitor_results", recordsDeleted: 0, duration: 1,
      errors: ["S3 cleanup denied"], details: {},
    });
    const job = { data: { entityType: "monitor_results", dryRun: false } } as Parameters<typeof processor>[0];
    await expect(processor(job)).rejects.toThrow("S3 cleanup denied");
    expect(execute).toHaveBeenCalledWith(false);
    expect(redis.del).toHaveBeenCalledWith("cleanup:monitor_results:lock");
    expect(jest.mocked(Queue).mock.calls[0][1]?.defaultJobOptions?.attempts).toBe(2);
  });
});
