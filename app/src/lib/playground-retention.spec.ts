/** @jest-environment node */
const mockSend = jest.fn();
const mockWhere = jest.fn();
const mockDelete = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: (...args: unknown[]) => mockWhere(...args) }) }) } }));
jest.mock("@aws-sdk/client-s3", () => ({ ...jest.requireActual("@aws-sdk/client-s3"), S3Client: jest.fn(() => ({ send: mockSend })) }));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: () => ({ deleteObjectsBatch: (...args: unknown[]) => mockDelete(...args) }) }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => false }));
jest.mock("@/lib/monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PlaygroundArtifactsCleanupStrategy } from "./data-lifecycle-service";
it("preserves 25-hour browser and k6 reports for retained runs while deleting orphan playground artifacts", async () => {
  mockWhere.mockResolvedValue([{ id: "retained-run" }]);
  mockSend.mockImplementation(async (command) => command instanceof ListObjectsV2Command ? { Contents: [
    { Key: "retained-run/report/index.html", LastModified: new Date(Date.now() - 25 * 3600000) },
    { Key: "temporary-test/report/index.html", LastModified: new Date(Date.now() - 25 * 3600000) },
  ] } : {});
  mockDelete.mockImplementation(async (_bucket, keys) => ({ success: true, deletedObjects: keys }));
  const strategy = new PlaygroundArtifactsCleanupStrategy({ entityType: "playground_artifacts", cronSchedule: "0 * * * *", enabled: true, retentionDays: 1, batchSize: 100, customConfig: { maxAgeHours: 24 } });
  const result = await strategy.execute();
  expect(result.success).toBe(true);
  expect(mockDelete).toHaveBeenCalledTimes(2);
  for (const call of mockDelete.mock.calls) expect(call[1]).toEqual(["temporary-test/report/index.html"]);
});
