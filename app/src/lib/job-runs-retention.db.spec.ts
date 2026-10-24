/** @jest-environment node */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

let mockDatabase: ReturnType<typeof drizzle>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("./s3-cleanup", () => ({ createS3CleanupService: () => ({}) }));
jest.mock("./feature-flags", () => ({ isPolarEnabled: () => false }));
jest.mock("./monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
import { JobRunsCleanupStrategy } from "./data-lifecycle-service";

const databaseName = `playground_retention_${randomUUID().replaceAll("-", "")}`;
const now = Date.parse("2026-10-24T12:00:00Z");
const ago = (hours: number) => new Date(now - hours * 3600000).toISOString();
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  mockDatabase = drizzle(client);
  await client.unsafe(`CREATE TABLE organization (id text PRIMARY KEY);
    CREATE TABLE plan_limits (plan text, job_data_retention_days integer);
    CREATE TABLE runs (id uuid PRIMARY KEY, job_id uuid, status text,
      created_at timestamp, completed_at timestamp)`);
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});
afterEach(() => jest.restoreAllMocks());

it("expires only old terminal playground runs, including historical rows without completion time", async () => {
  jest.spyOn(Date, "now").mockReturnValue(now);
  for (const status of ["passed", "failed", "error", "blocked"]) {
    await client`INSERT INTO runs VALUES (${randomUUID()},NULL,${status},${ago(48)},${ago(25)})`;
  }
  for (const status of ["queued", "running", "pending"]) {
    await client`INSERT INTO runs VALUES (${randomUUID()},NULL,${status},${ago(72)},NULL)`;
  }
  // Old creation does not shorten the report lifetime after a delayed execution.
  await client`INSERT INTO runs VALUES (${randomUUID()},NULL,'passed',${ago(72)},${ago(23)})`;
  await client`INSERT INTO runs VALUES (${randomUUID()},NULL,'passed',${ago(72)},${ago(24)})`;
  await client`INSERT INTO runs VALUES (${randomUUID()},NULL,'error',${ago(25)},NULL)`;
  await client`INSERT INTO runs VALUES (${randomUUID()},${randomUUID()},'passed',${ago(25)},${ago(25)})`;
  const config = { entityType: "job_runs" as const, cronSchedule: "0 * * * *", enabled: true, retentionDays: 90 };
  const result = await new JobRunsCleanupStrategy(config).execute(true);
  expect(result).toMatchObject({ success: true, recordsDeleted: 5, details: { playgroundRunsDeleted: 5 } });
  const longer = await new JobRunsCleanupStrategy({ ...config, customConfig: { playgroundMaxAgeHours: 48 } }).execute(true);
  expect(longer).toMatchObject({ success: true, recordsDeleted: 0 });
  expect((await client`SELECT count(*) FROM runs`)[0].count).toBe("11");
});
