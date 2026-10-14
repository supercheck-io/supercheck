/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { db } from "@/utils/db";
import { monitorResults, reports, runs } from "@/db/schema";
import { isPolarEnabled } from "./feature-flags";
import { createS3CleanupService } from "./s3-cleanup";
import { MonitorResultsCleanupStrategy, JobRunsCleanupStrategy, PlaygroundArtifactsCleanupStrategy } from "./data-lifecycle-service";

jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), delete: jest.fn(), update: jest.fn(), transaction: jest.fn() } }));
jest.mock("./feature-flags", () => ({ isPolarEnabled: jest.fn() }));
jest.mock("./monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
jest.mock("./s3-cleanup", () => ({ createS3CleanupService: jest.fn() }));
jest.mock("@aws-sdk/client-s3", () => ({ ...jest.requireActual("@aws-sdk/client-s3"), S3Client: jest.fn() }));

const monitorConfig = { entityType: "monitor_results" as const, enabled: true, cronSchedule: "0 2 * * *", retentionDays: 30, batchSize: 10, maxRecordsPerRun: 10 };
const jobConfig = { ...monitorConfig, entityType: "job_runs" as const, retentionDays: 90 };
const oldResult = { id: "result-1", monitorId: "monitor-1", isStatusChange: false, testExecutionId: "test-ab12", testReportS3Url: "http://storage:9000/monitors/test-ab12/report/index.html" };
const s3Success = { success: true, deletedObjects: ["test-ab12/report/index.html"], failedObjects: [], totalAttempted: 1 };

describe("Artifact retention strategies", () => {
  const deleteReports = jest.fn();
  const deleteObjectsBatch = jest.fn();
  const send = jest.fn();
  let selections: unknown[][];
  let predicates: SQL[];
  let limits: number[];
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
    events = [];
    jest.mocked(isPolarEnabled).mockReturnValue(true);
    jest.mocked(db.select).mockImplementation(() => {
      const rows = selections.shift() || [];
      const query = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn((condition: SQL) => { predicates.push(condition); return query; }),
        limit: jest.fn((limit: number) => { limits.push(limit); return query; }),
        orderBy: jest.fn().mockReturnThis(),
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
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
    jest.mocked(createS3CleanupService).mockReturnValue({ deleteReports, deleteObjectsBatch } as unknown as ReturnType<typeof createS3CleanupService>);
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

  it("cleans successful checks without sending S3 requests", async () => {
    monitorSelections([{ ...oldResult, testExecutionId: null, testReportS3Url: null } as unknown as typeof oldResult]);
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

  it("makes no S3 or DB mutations in dry-run mode", async () => {
    monitorSelections();
    selections[3] = [{ count: 3 }];
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
});
