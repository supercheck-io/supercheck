/** @jest-environment node */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { S3CleanupService } from "./s3-cleanup";
it("aborts a connected S3 endpoint that never responds", async () => {
  const server = createServer(() => { /* Keep the connection open without a response. */ });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const service = new S3CleanupService({ endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, region: "us-east-1", accessKeyId: "test", secretAccessKey: "test", maxRetries: 1, operationTimeout: 50,
      jobBucketName: "jobs", testBucketName: "tests", monitorBucketName: "monitors", k6TestBucketName: "k6-tests", k6JobBucketName: "k6-jobs", statusBucketName: "status", requirementsBucketName: "requirements", projectDataFilesBucketName: "files" });
    const started = Date.now();
    const result = await service.deleteReports([{ entityId: "run", entityType: "job" }]);
    expect(result.success).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}, 5000);
