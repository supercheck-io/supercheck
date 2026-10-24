import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle>;
const mockDeleteRunArtifacts = jest.fn();
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("./s3-cleanup", () => ({ createS3CleanupService: () => ({ deleteRunArtifacts: mockDeleteRunArtifacts }) }));
jest.mock("./monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
import { RunArtifactsCleanupStrategy } from "./data-lifecycle-service";

const databaseName = `artifact_cleanup_${randomUUID().replaceAll("-", "")}`;
const runId = "00000000-0000-4000-8000-000000000001";
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const strategy = () => new RunArtifactsCleanupStrategy({ entityType: "run_artifacts", enabled: true,
  cronSchedule: "*/15 * * * *", maxRecordsPerRun: 10 });
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  mockDatabase = drizzle(client, { schema });
  await client.unsafe("CREATE TABLE runs (id uuid PRIMARY KEY)");
  await client.unsafe(readFileSync(path.join(__dirname, "../db/migrations/0040_run_callback_fencing.sql"), "utf8"));
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});
beforeEach(async () => {
  mockDeleteRunArtifacts.mockReset();
  await client`TRUNCATE runs, run_callbacks`;
  await client`INSERT INTO runs VALUES (${runId})`;
  await client`INSERT INTO run_callbacks (run_id,owner,bucket) VALUES (${runId},${randomUUID()},'tests')`;
  await client`DELETE FROM runs WHERE id=${runId}`;
});

it("keeps empty-prefix tombstones eligible for a PUT that commits after cleanup", async () => {
  const objects = new Set<string>();
  mockDeleteRunArtifacts.mockImplementation(async (bucket: string, id: string) => {
    expect(bucket).toBe("tests");
    // A max:1 query would deadlock if cleanup retained the pool connection.
    await Promise.race([client`SELECT 1`, new Promise((_, reject) => setTimeout(() => reject(new Error("database held during storage cleanup")), 1500).unref())]);
    const deletedObjects = [...objects].filter(key => key.startsWith(`${id}/`));
    deletedObjects.forEach(key => objects.delete(key));
    return { success: true, deletedObjects };
  });
  expect((await strategy().execute()).success).toBe(true);
  expect(await client`SELECT run_id FROM run_callbacks`).toHaveLength(1);
  // A rejected SDK attempt can commit remotely after the first empty cleanup.
  objects.add(`${runId}/report/index.html`);
  objects.add("another-run/report/index.html");
  await client`UPDATE run_callbacks SET cleanup_at=now()-interval '1 second'`;
  expect((await strategy().execute()).s3ObjectsDeleted).toBe(1);
  expect([...objects]).toEqual(["another-run/report/index.html"]);
  expect(await client`SELECT run_id FROM run_callbacks`).toHaveLength(1);
});

it("preserves failed storage pointers and schedules another attempt", async () => {
  mockDeleteRunArtifacts.mockRejectedValueOnce(new Error("storage unavailable"));
  const result = await strategy().execute();
  expect(result.success).toBe(false);
  const [pointer] = await client`SELECT bucket, cleanup_at > now() AS retry_pending FROM run_callbacks`;
  expect(pointer).toEqual({ bucket: "tests", retry_pending: true });
  await client`UPDATE run_callbacks SET cleanup_at=now()-interval '1 second'`;
  mockDeleteRunArtifacts.mockResolvedValue({ success: true, deletedObjects: [] });
  expect((await strategy().execute()).success).toBe(true);
});

it("claims each due tombstone once across concurrent cleanup workers", async () => {
  mockDeleteRunArtifacts.mockResolvedValue({ success: true, deletedObjects: [] });
  await Promise.all([strategy().execute(), strategy().execute()]);
  expect(mockDeleteRunArtifacts).toHaveBeenCalledTimes(1);
});

it("does not mutate or delete storage during a dry run", async () => {
  const before = await client`SELECT cleanup_at::text FROM run_callbacks`;
  expect((await strategy().execute(true)).details.recordsProcessed).toBe(1);
  expect(mockDeleteRunArtifacts).not.toHaveBeenCalled();
  expect(await client`SELECT cleanup_at::text FROM run_callbacks`).toEqual(before);
});
