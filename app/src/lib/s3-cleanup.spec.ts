/** @jest-environment node */
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { S3CleanupService, type S3Config } from "./s3-cleanup";

jest.mock("@aws-sdk/client-s3", () => ({
  ...jest.requireActual("@aws-sdk/client-s3"),
  S3Client: jest.fn(),
}));

const config: S3Config = {
  endpoint: "http://storage:9000", region: "us-east-1",
  accessKeyId: "test", secretAccessKey: "test", maxRetries: 1,
  jobBucketName: "jobs", testBucketName: "tests", monitorBucketName: "monitors",
  k6TestBucketName: "k6-tests", k6JobBucketName: "k6-jobs", statusBucketName: "status",
  requirementsBucketName: "requirements", projectDataFilesBucketName: "files",
};

describe("S3 report cleanup", () => {
  let service: S3CleanupService;
  let objects: Map<string, string[]>;
  const send = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    objects = new Map();
    send.mockImplementation(async (command) => {
      if (command instanceof ListObjectsV2Command) {
        return { Contents: (objects.get(command.input.Bucket!) || [])
          .filter(key => key.startsWith(command.input.Prefix || ""))
          .map(Key => ({ Key })) };
      }
      if (command instanceof DeleteObjectsCommand) {
        const keys = command.input.Delete!.Objects!.map(obj => obj.Key!);
        objects.set(command.input.Bucket!, (objects.get(command.input.Bucket!) || [])
          .filter(key => !keys.includes(key)));
        return { Deleted: keys.map(Key => ({ Key })) };
      }
      throw new Error("Unexpected S3 operation");
    });
    jest.mocked(S3Client).mockImplementation(() => ({ send }) as unknown as S3Client);
    service = new S3CleanupService(config);
  });

  afterEach(() => jest.restoreAllMocks());

  it("recovers owned run URLs without report metadata and preserves shared test reports", () => {
    expect(service.getRunArtifactInputs({ id: "run-1", reportS3Url: "http://storage:9000/k6-tests/run-1/report/index.html", logsS3Url: "https://k6-tests.example.test/run-1/logs.txt" })).toEqual([
      { entityId: "run-1", entityType: "k6_test", reportPath: "run-1", s3Url: "http://storage:9000/k6-tests/run-1/report/index.html" },
      { entityId: "run-1", entityType: "k6_test", reportPath: "run-1", s3Url: "https://k6-tests.example.test/run-1/logs.txt" },
    ]);
    expect(service.getRunArtifactInputs({ id: "run-1", metadata: { testId: "test-1" }, reportS3Url: "http://storage:9000/tests/test-1/report/index.html" })).toEqual([]);
    expect(() => service.getRunArtifactInputs({ id: "run-1", reportS3Url: "http://storage:9000/k6-tests/other-run/report/index.html" })).toThrow("execution directory");
  });

  it.each(["k6_test", "k6_job"] as const)("deletes the entire %s execution including sibling metrics", async entityType => {
    const bucket = entityType === "k6_test" ? "k6-tests" : "k6-jobs";
    objects.set(bucket, ["run-1/report/index.html", "run-1/metrics.json", "run-10/report/index.html"]);
    const result = await service.deleteReports([{
      entityType, entityId: "run-1", reportPath: "run-1/report",
      s3Url: `http://storage:9000/${bucket}/run-1/report/index.html`,
    }]);
    expect(result.success).toBe(true);
    expect(objects.get(bucket)).toEqual(["run-10/report/index.html"]);
  });

  it("uses a monitor execution URL without matching other executions or buckets", async () => {
    objects.set("monitors", ["test-ab12/report/index.html", "test-ab12/report/trace.zip", "test-ab123/report/index.html"]);
    objects.set("tests", ["test-ab12/report/index.html"]);
    const result = await service.deleteReports([{
      entityType: "monitor", entityId: "monitor-1",
      s3Url: "http://storage:9000/monitors/test-ab12/report/index.html",
    }]);
    expect(result.deletedObjects).toHaveLength(2);
    expect(objects.get("monitors")).toEqual(["test-ab123/report/index.html"]);
    expect(objects.get("tests")).toEqual(["test-ab12/report/index.html"]);
  });

  it("never broadens an empty execution prefix to the monitor ID", async () => {
    objects.set("monitors", ["monitor-1/new-execution/report/index.html"]);
    const result = await service.deleteReports([{
      entityType: "monitor", entityId: "monitor-1", reportPath: "missing-execution",
    }]);
    expect(result.success).toBe(true);
    expect(objects.get("monitors")).toEqual(["monitor-1/new-execution/report/index.html"]);
  });

  it("deduplicates listings for the same execution", async () => {
    objects.set("jobs", ["run-1/report/index.html"]);
    const input = { entityType: "job" as const, entityId: "run-1", reportPath: "run-1/report" };
    await service.deleteReports([input, input]);
    expect(send.mock.calls.filter(([command]) => command instanceof ListObjectsV2Command)).toHaveLength(1);
  });

  it("reports listing failures without trying broader prefixes", async () => {
    send.mockRejectedValue(new Error("Access denied"));
    const result = await service.deleteReports([{ entityType: "job", entityId: "run-1" }]);
    expect(result.success).toBe(false);
    expect(result.failedObjects).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("supports virtual-hosted report URLs", async () => {
    objects.set("monitors", ["test-ab12/report/index.html"]);
    const result = await service.deleteReports([{
      entityType: "monitor", entityId: "monitor-1",
      s3Url: "https://monitors.storage.example/test-ab12/report/index.html",
    }]);
    expect(result.success).toBe(true);
    expect(objects.get("monitors")).toEqual([]);
  });

  it.each(["/", "../report"])("refuses unsafe report path %s", async reportPath => {
    const result = await service.deleteReports([{ entityType: "job", entityId: "run-1", reportPath }]);
    expect(result.success).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a URL for a different bucket", async () => {
    const result = await service.deleteReports([{
      entityType: "monitor", entityId: "monitor-1", s3Url: "https://storage.example/tests/test-ab12/report/index.html",
    }]);
    expect(result.success).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports individual delete failures", async () => {
    send.mockResolvedValueOnce({ Contents: [{ Key: "run-1/report/index.html" }] })
      .mockResolvedValueOnce({ Errors: [{ Key: "run-1/report/index.html", Message: "Access denied" }] });
    const result = await service.deleteReports([{ entityType: "job", entityId: "run-1" }]);
    expect(result.success).toBe(false);
    expect(result.failedObjects[0].error).toBe("Access denied");
  });

  it("identifies only failed report owners in a partially successful S3 batch", async () => {
    const inputs = [
      { entityType: "job" as const, entityId: "owner-1", reportPath: "run-1/report" },
      { entityType: "job" as const, entityId: "owner-10", reportPath: "run-10/report" },
    ];
    send.mockResolvedValueOnce({ Contents: [{ Key: "run-1/report/index.html" }] })
      .mockResolvedValueOnce({ Contents: [{ Key: "run-10/report/index.html" }] })
      .mockResolvedValueOnce({ Deleted: [{ Key: "run-10/report/index.html" }], Errors: [{ Key: "run-1/report/index.html", Message: "Denied" }] });
    const result = await service.deleteReports(inputs);
    expect(service.getFailedReportEntityIds(inputs, result)).toEqual(new Set(["owner-1"]));
  });

  it("maps URL parsing failures back to their recorded owner", () => {
    const inputs = [
      { entityType: "monitor" as const, entityId: "bad", s3Url: "broken" },
      { entityType: "monitor" as const, entityId: "good", reportPath: "test-good" },
    ];
    expect(service.getFailedReportEntityIds(inputs, { success: false, deletedObjects: [], failedObjects: [{ key: "broken", error: "Invalid URL" }], totalAttempted: 1 }))
      .toEqual(new Set(["bad"]));
  });

  it("retains every owner when a failure key cannot be identified", () => {
    const inputs = [{ entityType: "job" as const, entityId: "run-1" }, { entityType: "job" as const, entityId: "run-2" }];
    expect(service.getFailedReportEntityIds(inputs, { success: false, deletedObjects: [], failedObjects: [{ key: "unknown", error: "Denied" }], totalAttempted: 1 }))
      .toEqual(new Set(["run-1", "run-2"]));
  });

  it("paginates listings and splits S3 deletes at 1000 keys", async () => {
    const keys = Array.from({ length: 1001 }, (_, i) => `run-1/report/${i}.png`);
    send.mockResolvedValueOnce({ Contents: keys.slice(0, 1000).map(Key => ({ Key })), NextContinuationToken: "page-2" })
      .mockResolvedValueOnce({ Contents: [{ Key: keys[1000] }] })
      .mockResolvedValueOnce({ Deleted: keys.slice(0, 1000).map(Key => ({ Key })) })
      .mockResolvedValueOnce({ Deleted: [{ Key: keys[1000] }] });
    const result = await service.deleteReports([{ entityType: "job", entityId: "run-1" }]);
    expect(result.deletedObjects).toHaveLength(1001);
    expect(send.mock.calls[1][0].input.ContinuationToken).toBe("page-2");
    expect(send.mock.calls[2][0].input.Delete.Objects).toHaveLength(1000);
    expect(send.mock.calls[3][0].input.Delete.Objects).toHaveLength(1);
  });
});
