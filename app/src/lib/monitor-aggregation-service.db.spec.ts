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
  const [project] = await mockDatabase
    .insert(schema.projects)
    .values({ organizationId: organization.id, name: "Project" })
    .returning();
  const [monitor] = await mockDatabase
    .insert(schema.monitors)
    .values({
      organizationId: organization.id,
      projectId: project.id,
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

it.each(["hourly", "daily"] as const)("keeps entirely skipped cycles neutral in %s uptime while counting observed results", async (period) => {
  const windowStart = new Date(day);
  if (period === "hourly") {
    windowStart.setTime(Date.now());
    windowStart.setUTCMinutes(0, 0, 0);
    windowStart.setUTCHours(windowStart.getUTCHours() - 1);
  }
  const aggregate = () => period === "hourly" ? monitorAggregationService.runHourlyAggregation() : monitorAggregationService.runDailyAggregation();
  await mockDatabase.insert(schema.monitorResults).values({
    monitorId, checkedAt: new Date(windowStart.getTime() + 60_000), location: "local", status: "up", isUp: true,
  });
  const metrics = () => monitorAggregationService.getAggregatedMetrics(monitorId, period, windowStart, new Date(), null);
  expect((await aggregate()).errors).toEqual([]);
  const before = await metrics();
  expect(before).toMatchObject({ totalChecks: 1, uptimePercentage: 100 });

  const cycleId = randomUUID();
  await mockDatabase.insert(schema.monitorCycles).values({
    id: cycleId, monitorId, scheduledFor: new Date(windowStart.getTime() + 120_000),
    deadlineAt: new Date(windowStart.getTime() + 180_000), expectedLocations: ["local", "eu"],
    strategy: "all", threshold: 1, status: "aborted", closedAt: new Date(windowStart.getTime() + 180_000),
    observedLocations: [], missingLocations: ["local", "eu"], notifiedAt: new Date(),
  });
  expect((await aggregate()).errors).toEqual([]);
  expect(await metrics()).toEqual(before);

  await mockDatabase.insert(schema.monitorResults).values({
    monitorId, executionGroupId: cycleId, checkedAt: new Date(windowStart.getTime() + 120_000),
    location: "local", status: "down", isUp: false,
  });
  expect((await aggregate()).errors).toEqual([]);
  expect(await metrics()).toMatchObject({ totalChecks: 2, uptimePercentage: 50 });
  const aggregates = await mockDatabase.select().from(schema.monitorAggregates).where(eq(schema.monitorAggregates.monitorId, monitorId));
  expect(aggregates.find(row => row.location === null)).toMatchObject({ totalChecks: 2, successfulChecks: 1, failedChecks: 1 });
});

const at = (minutes: number) => new Date(day.getTime() + minutes * 60_000);

it("counts a 3-region majority monitor with one region always down as 100% up, per-region rows stay per region", async () => {
  await mockDatabase
    .update(schema.monitors)
    .set({ config: { locationConfig: { enabled: true, locations: ["a", "b", "c"], strategy: "majority", threshold: 50 } } })
    .where(eq(schema.monitors.id, monitorId));
  const rows = [0, 1, 2, 3].flatMap((i) =>
    [["a", true], ["b", true], ["c", false]].map(([location, isUp]) => ({
      monitorId, executionGroupId: `grp-${i}`, checkedAt: at(i * 5), location: location as string,
      status: isUp ? ("up" as const) : ("down" as const), isUp: isUp as boolean, responseTimeMs: isUp ? 100 + i : null,
    })),
  );
  await mockDatabase.insert(schema.monitorResults).values(rows);
  expect((await monitorAggregationService.runDailyAggregation()).errors).toEqual([]);
  const aggregates = await mockDatabase.select().from(schema.monitorAggregates).where(eq(schema.monitorAggregates.monitorId, monitorId));
  expect(aggregates.find((r) => r.location === null)).toMatchObject({ totalChecks: 4, successfulChecks: 4, failedChecks: 0, responseSampleCount: 8 });
  expect(aggregates.find((r) => r.location === "c")).toMatchObject({ totalChecks: 4, successfulChecks: 0, responseSampleCount: 0 });
  expect(aggregates.find((r) => r.location === "a")).toMatchObject({ totalChecks: 4, successfulChecks: 4 });
  const window = await monitorAggregationService.getWindowMetrics(monitorId, "daily", day, new Date(day.getTime() + 86_400_000), null);
  expect(window).toMatchObject({ totalChecks: 4, successfulChecks: 4, uptimePercentage: 100 });
  expect(window.p95ResponseMs).toBeGreaterThanOrEqual(100);
});

it("aggregates a monitor paused after a partial period, deletes a stale period, and never deletes periods older than the oldest raw row", async () => {
  await mockDatabase.update(schema.monitors).set({ enabled: false }).where(eq(schema.monitors.id, monitorId));
  const older = (days: number, minutes: number) => new Date(day.getTime() - days * 86_400_000 + minutes * 60_000);
  await mockDatabase.insert(schema.monitorResults).values([
    { monitorId, checkedAt: older(2, 10), location: "local", status: "up", isUp: true, responseTimeMs: 50 },
    { monitorId, checkedAt: older(1, 10), location: "local", status: "up", isUp: true, responseTimeMs: 50 },
    { monitorId, checkedAt: at(10), location: "local", status: "up", isUp: true, responseTimeMs: 50 },
  ]);
  expect((await monitorAggregationService.runDailyAggregation()).errors).toEqual([]);
  const count = async () =>
    (await mockDatabase.select().from(schema.monitorAggregates).where(eq(schema.monitorAggregates.monitorId, monitorId))).length;
  expect(await count()).toBe(6);

  // The middle day's rows disappear while older and newer raw rows remain: its aggregates are stale.
  await mockDatabase.delete(schema.monitorResults).where(and(eq(schema.monitorResults.monitorId, monitorId), eq(schema.monitorResults.checkedAt, older(1, 10))));
  expect((await monitorAggregationService.runDailyAggregation()).errors).toEqual([]);
  expect(await count()).toBe(4);

  // Raw retention purges the oldest rows: aggregates of purged days are kept, not deleted.
  await mockDatabase.delete(schema.monitorResults).where(and(eq(schema.monitorResults.monitorId, monitorId), eq(schema.monitorResults.checkedAt, older(2, 10))));
  expect((await monitorAggregationService.runDailyAggregation()).errors).toEqual([]);
  expect(await count()).toBe(4);
});

it("counts raw rows of a period no aggregate covers in the window", async () => {
  await mockDatabase.insert(schema.monitorResults).values([
    { monitorId, checkedAt: at(10), location: "local", status: "up", isUp: true, responseTimeMs: 50 },
    { monitorId, checkedAt: at(20), location: "local", status: "down", isUp: false },
  ]);
  const window = await monitorAggregationService.getWindowMetrics(monitorId, "daily", day, new Date(day.getTime() + 86_400_000), null);
  expect(window).toMatchObject({ totalChecks: 2, successfulChecks: 1, uptimePercentage: 50, avgResponseMs: 50 });
});

it("summarises a window with no aggregates in SQL: cycle rule, missing region, in-flight cycle, snapshot, location filter, p95", async () => {
  await mockDatabase
    .update(schema.monitors)
    .set({ config: { locationConfig: { enabled: true, locations: ["a", "b", "c"], strategy: "majority", threshold: 50 } } })
    .where(eq(schema.monitors.id, monitorId));
  const row = (group: string, location: string, isUp: boolean, minutes: number, ms: number | null = 100) => ({
    monitorId, executionGroupId: group, checkedAt: at(minutes), location, status: isUp ? ("up" as const) : ("down" as const), isUp, responseTimeMs: isUp ? ms : null,
  });
  // g1: a,b up c down => up. g2: only a reported (old) => down. g3: snapshot "any", only a up => up.
  await mockDatabase.insert(schema.monitorCycles).values({
    id: "g3", monitorId, scheduledFor: at(30), deadlineAt: at(40), expectedLocations: ["a", "b", "c"], strategy: "any", threshold: 1, status: "closed",
  });
  await mockDatabase.insert(schema.monitorResults).values([
    row("g1", "a", true, 0, 100), row("g1", "b", true, 0, 200), row("g1", "c", false, 0),
    row("g2", "a", true, 10, 300),
    row("g3", "a", true, 30, 400),
  ]);
  // In flight right now: a reported, b and c have not. Not counted until it settles.
  await mockDatabase.insert(schema.monitorResults).values({
    monitorId, executionGroupId: "g4", checkedAt: new Date(Date.now() - 60_000), location: "a", status: "up", isUp: true, responseTimeMs: 100,
  });
  const now = new Date();
  const window = await monitorAggregationService.getWindowMetrics(monitorId, "daily", day, now, null);
  expect(window).toMatchObject({ totalChecks: 3, successfulChecks: 2 });
  // Samples: 100,200,300,400,100 -> p95 within the 5% bucket of 400.
  expect(window.p95ResponseMs).toBeGreaterThan(380);
  expect(window.p95ResponseMs).toBeLessThan(420);
  const regional = await monitorAggregationService.getWindowMetrics(monitorId, "daily", day, now, "c" as never);
  expect(regional).toMatchObject({ totalChecks: 1, successfulChecks: 0 });
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
    // Mirror scripts/db-migrate.js: each migration statement runs inside a savepoint.
    await transaction`SAVEPOINT migration_statement`;
    await transaction.unsafe(migration);
    await transaction`RELEASE SAVEPOINT migration_statement`;
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
