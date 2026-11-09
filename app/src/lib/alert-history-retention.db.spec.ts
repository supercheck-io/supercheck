/** @jest-environment node */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

let mockDatabase: ReturnType<typeof drizzle>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("./s3-cleanup", () => ({ createS3CleanupService: () => ({}) }));
jest.mock("./feature-flags", () => ({ isPolarEnabled: () => false }));
jest.mock("./monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
import { AlertHistoryCleanupStrategy } from "./data-lifecycle-service";

const databaseName = `alert_retention_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const down = randomUUID();
const errored = randomUUID();
const up = randomUUID();
const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
const config = { entityType: "alert_history" as const, cronSchedule: "0 * * * *", enabled: true, retentionDays: 90 };

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  mockDatabase = drizzle(client);
  await client.unsafe(`CREATE TABLE monitors (id uuid PRIMARY KEY, status text);
    CREATE TABLE alert_history (id uuid PRIMARY KEY, monitor_id uuid, job_id uuid, outage_key uuid, sent_at timestamptz)`);
  await client`INSERT INTO monitors VALUES (${down}, 'down'), (${up}, 'up'), (${errored}, 'error')`;
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("keeps the claim rows of a monitor that is still down, and expires everything else past retention", async () => {
  const insert = (monitor: string | null, key: string | null, sentAt = old) =>
    client`INSERT INTO alert_history VALUES (${randomUUID()}, ${monitor}, ${monitor ? null : randomUUID()}, ${key}, ${sentAt})`;
  await insert(down, randomUUID()); // open outage claim: kept
  await insert(errored, randomUUID()); // monitor in error status mid-outage: kept
  await insert(down, null); // history row of a down monitor, no claim: expires
  await insert(up, randomUUID()); // outage over: expires
  await insert(null, null); // job alert: expires
  await insert(down, randomUUID(), new Date().toISOString()); // recent: kept

  const dry = await new AlertHistoryCleanupStrategy(config).execute(true);
  expect(dry.recordsDeleted).toBe(3);
  expect(await new AlertHistoryCleanupStrategy(config).getStats()).toMatchObject({ oldRecords: 3 });
  const result = await new AlertHistoryCleanupStrategy(config).execute(false);
  expect(result).toMatchObject({ success: true, recordsDeleted: 3 });
  expect((await client`SELECT count(*)::int AS n FROM alert_history`)[0].n).toBe(3);
});
