/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
import { monitorAggregationService } from "./monitor-aggregation-service";
const execFileAsync = promisify(execFile);
const name = `monitor_aggregates_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let monitorId: string;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../..");
  await execFileAsync(
    process.execPath,
    [path.join(appRoot, "scripts/db-migrate.js")],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        DATABASE_URL: target.toString(),
        SELF_HOSTED: "true",
        NODE_ENV: "test",
      },
      timeout: 90000,
    },
  );
  client = postgres(target.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

const day = new Date();
day.setUTCHours(0, 0, 0, 0);
day.setUTCDate(day.getUTCDate() - 1);

beforeEach(async () => {
  await client`TRUNCATE monitors, organization CASCADE`;
  const [organization] = await mockDatabase
    .insert(schema.organization)
    .values({ name: "Test", createdAt: new Date() })
    .returning();
  const [monitor] = await mockDatabase
    .insert(schema.monitors)
    .values({
      organizationId: organization.id,
      name: "API",
      type: "http_request",
      target: "https://example.com",
      status: "up",
    })
    .returning();
  monitorId = monitor.id;
});

it("rejects duplicate combined rows and makes concurrent aggregation idempotent", async () => {
  await mockDatabase.insert(schema.monitorResults).values([
    {
      monitorId,
      checkedAt: new Date(day.getTime() + 60_000),
      location: "local",
      status: "up",
      isUp: true,
    },
    {
      monitorId,
      checkedAt: new Date(day.getTime() + 120_000),
      location: "local",
      status: "down",
      isUp: false,
    },
  ]);
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      monitorAggregationService.runDailyAggregation(),
    ),
  );
  for (const result of results) expect(result.errors).toEqual([]);
  const rows = await mockDatabase
    .select()
    .from(schema.monitorAggregates)
    .where(eq(schema.monitorAggregates.monitorId, monitorId));
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.location === null)?.totalChecks).toBe(2);
  const combined = rows.find((row) => row.location === null)!;
  await expect(
    mockDatabase.insert(schema.monitorAggregates).values({
      ...combined,
      id: randomUUID(),
    }),
  ).rejects.toThrow();
  expect(
    (
      await monitorAggregationService.getAggregatedMetrics(
        monitorId,
        "daily",
        day,
        new Date(),
        null,
      )
    ).totalChecks,
  ).toBe(2);
});

it("keeps the latest duplicate, archives superseded rows and cascades their deletion", async () => {
  await client`DROP INDEX monitor_aggregates_combined_unique_idx`;
  await client`DROP TABLE monitor_aggregate_dedup_audit`;
  const older = {
    id: randomUUID(),
    monitorId,
    periodType: "daily" as const,
    periodStart: day,
    location: null,
    totalChecks: 5,
    successfulChecks: 5,
    uptimePercentage: "100.00",
    updatedAt: new Date(day.getTime() - 1000),
  };
  const newer = { ...older, id: randomUUID(), totalChecks: 10, updatedAt: day };
  await mockDatabase.insert(schema.monitorAggregates).values([older, newer]);
  const migration = readFileSync(
    path.resolve(
      __dirname,
      "../db/migrations/0033_monitor_aggregate_uniqueness.sql",
    ),
    "utf8",
  );
  await client.begin(async (transaction) => {
    await transaction.unsafe(migration);
    // The migration serializes writers without blocking dashboard reads until commit.
    await client.begin(async (reader) => {
      await reader`SET LOCAL statement_timeout = '1s'`;
      const [visible] =
        await reader`SELECT count(*)::int AS count FROM monitor_aggregates`;
      expect(visible.count).toBe(2);
    });
  });
  expect(
    await mockDatabase
      .select()
      .from(schema.monitorAggregates)
      .where(
        and(
          eq(schema.monitorAggregates.monitorId, monitorId),
          eq(schema.monitorAggregates.periodType, "daily"),
        ),
      ),
  ).toEqual([expect.objectContaining({ id: newer.id, totalChecks: 10 })]);
  const [auditIndex] = await client`SELECT indexdef FROM pg_indexes
    WHERE tablename = 'monitor_aggregate_dedup_audit'
      AND indexname = 'monitor_aggregate_dedup_audit_monitor_idx'`;
  expect(auditIndex.indexdef).toContain("(monitor_id)");
  expect(await client`SELECT id FROM monitor_aggregate_dedup_audit`).toEqual([
    { id: older.id },
  ]);
  await mockDatabase
    .delete(schema.monitors)
    .where(eq(schema.monitors.id, monitorId));
  expect(
    await client`SELECT id FROM monitor_aggregate_dedup_audit`,
  ).toHaveLength(0);
});
