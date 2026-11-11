/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, gte, sql } from "drizzle-orm";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
import { getRowCountsByPeriod } from "./monitor-availability";
import { monitorAggregationService } from "./monitor-aggregation-service";
import { excludeSupersededSyntheticResults } from "./monitor-result-filters";

const execFileAsync = promisify(execFile);
const name = `monitor_availability_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let orgId: string;
let projectId: string;

const H = 3_600_000;
const D = 24 * H;
const midnight = Math.floor(Date.now() / D) * D;
const hourStart = Math.floor(Date.now() / H) * H;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 5, onnotice: () => {}, connection: { TimeZone: "UTC" } });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

/** The pre-aggregate dashboard queries, verbatim, as the reference. */
async function rawDaily(from: Date) {
  return mockDatabase
    .select({
      date: sql<string>`DATE(${schema.monitorResults.checkedAt})`,
      upCount: sql<number>`SUM(CASE WHEN ${schema.monitorResults.isUp} THEN 1 ELSE 0 END)`.mapWith(Number),
      totalCount: sql<number>`count(*)`.mapWith(Number),
    })
    .from(schema.monitorResults)
    .innerJoin(schema.monitors, eq(schema.monitorResults.monitorId, schema.monitors.id))
    .where(and(
      gte(schema.monitorResults.checkedAt, from),
      eq(schema.monitors.projectId, projectId),
      eq(schema.monitors.organizationId, orgId),
      excludeSupersededSyntheticResults,
    ))
    .groupBy(sql`DATE(${schema.monitorResults.checkedAt})`)
    .orderBy(sql`DATE(${schema.monitorResults.checkedAt})`);
}
async function rawTotals(from: Date) {
  const [row] = await mockDatabase
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      up: sql<number>`count(*) filter (where ${schema.monitorResults.isUp} = true)`.mapWith(Number),
    })
    .from(schema.monitorResults)
    .innerJoin(schema.monitors, eq(schema.monitorResults.monitorId, schema.monitors.id))
    .where(and(
      gte(schema.monitorResults.checkedAt, from),
      eq(schema.monitors.projectId, projectId),
      eq(schema.monitors.organizationId, orgId),
      excludeSupersededSyntheticResults,
    ));
  return row;
}
async function newDaily(from: Date, now = new Date()) {
  const counts = await getRowCountsByPeriod({ organizationId: orgId, projectId, from, now, period: "daily" });
  return [...counts].sort(([a], [b]) => a - b).map(([t, c]) => ({
    date: new Date(t).toISOString().slice(0, 10), upCount: c.up, totalCount: c.total,
  }));
}
async function newTotals(from: Date, now = new Date()) {
  const counts = await getRowCountsByPeriod({ organizationId: orgId, projectId, from, now, period: "hourly" });
  return [...counts.values()].reduce((a, c) => ({ total: a.total + c.total, up: a.up + c.up }), { total: 0, up: 0 });
}

beforeEach(async () => {
  await client`TRUNCATE monitors, organization CASCADE`;
  const [org, other] = await mockDatabase.insert(schema.organization)
    .values([{ name: "Org", createdAt: new Date() }, { name: "Other", createdAt: new Date() }]).returning();
  const [project, sibling, foreign] = await mockDatabase.insert(schema.projects).values([
    { organizationId: org.id, name: "Project" },
    { organizationId: org.id, name: "Sibling" },
    { organizationId: other.id, name: "Foreign" },
  ]).returning();
  orgId = org.id;
  projectId = project.id;
  const make = (o: string, p: string, n: string) =>
    ({ organizationId: o, projectId: p, name: n, type: "http_request", target: "https://x.test", status: "up", createdAt: new Date(midnight - 40 * D) }) as const;
  const [single, multi, siblingMonitor, foreignMonitor] = await mockDatabase.insert(schema.monitors).values([
    make(org.id, project.id, "single"),
    make(org.id, project.id, "multi"),
    make(org.id, sibling.id, "sibling project"),
    make(other.id, foreign.id, "foreign"),
  ]).returning();

  const rows: (typeof schema.monitorResults.$inferInsert)[] = [];
  const row = (monitorId: string, at: number, isUp: boolean, location: "us-east" | "eu-central" | "asia-pacific", group: string | null, extra: Partial<typeof schema.monitorResults.$inferInsert> = {}) =>
    rows.push({ monitorId, checkedAt: new Date(at), isUp, status: isUp ? "up" : "down", responseTimeMs: isUp ? 100 : null, location, executionGroupId: group, ...extra });
  const locations = ["us-east", "eu-central", "asia-pacific"] as const;
  for (let day = 34; day >= 0; day--) {
    const start = midnight - day * D;
    // Day boundaries (last ms of the previous day, first ms) and a mid-day check, three regions for `multi`.
    for (const [i, at] of [start - 1, start, start + 11 * H + 59_000].entries()) {
      const up = (day + i) % 4 !== 0;
      row(single.id, at, up, "us-east", `s-${day}-${i}`);
      locations.forEach((location, l) => row(multi.id, at, (day + l + i) % 5 !== 0, location, `m-${day}-${i}`));
      row(siblingMonitor.id, at, false, "us-east", null);
      row(foreignMonitor.id, at, false, "us-east", null);
    }
  }
  // Last 24h: hour-edge rows (just before / at the top of hours) and a few recent ones.
  for (let h = 30; h >= 0; h--) {
    for (const at of [hourStart - h * H - 1, hourStart - h * H]) {
      if (at >= Date.now() - 1000) continue;
      row(single.id, at, at % 3 !== 0, "us-east", randomUUID());
      locations.forEach((location, l) => row(multi.id, at, (at / 1000 + l) % 7 !== 0, location, `h-${at}`));
    }
  }
  // Superseded synthetic failure: the real result of the same cycle and region arrived late.
  const cycleAt = midnight - 3 * D + 5 * H;
  row(multi.id, cycleAt, false, "eu-central", "late", { responseTimeMs: null, details: { synthetic: true } as never });
  row(multi.id, cycleAt + 40_000, true, "eu-central", "late");
  const hourlyCycleAt = hourStart - 5 * H + 5 * 60_000;
  row(multi.id, hourlyCycleAt, false, "eu-central", "late-h", { responseTimeMs: null, details: { synthetic: true } as never });
  row(multi.id, hourlyCycleAt + 40_000, true, "eu-central", "late-h");
  // A synthetic failure with no real sibling still counts.
  row(multi.id, midnight - 4 * D + 5 * H, false, "asia-pacific", "lonely", { responseTimeMs: null, details: { synthetic: true } as never });
  const past = rows.filter((r) => (r.checkedAt as Date).getTime() < Date.now());
  for (let i = 0; i < past.length; i += 500) await mockDatabase.insert(schema.monitorResults).values(past.slice(i, i + 500));
});

const aggregateAll = async () => {
  expect((await monitorAggregationService.runDailyAggregation(40)).errors).toEqual([]);
  expect((await monitorAggregationService.runHourlyAggregation()).errors).toEqual([]);
};

it("matches the raw dashboard queries across day boundaries, regions and superseded rows", async () => {
  await aggregateAll();
  const now = new Date();
  const from30 = new Date(now.getTime() - 30 * D);
  const from24 = new Date(now.getTime() - D);
  expect(await newDaily(from30, now)).toEqual(await rawDaily(from30));
  expect(await newTotals(from24, now)).toEqual(await rawTotals(from24));
  // The superseded and lonely synthetic rows are exercised: rows were seeded and aggregates are used.
  const [aggregates] = await mockDatabase.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.monitorAggregates);
  expect(aggregates.n).toBeGreaterThan(100);
});

it("counts checks that arrive after the aggregates ran and periods the aggregator missed", async () => {
  await aggregateAll();
  const [multi] = await mockDatabase.select().from(schema.monitors).where(eq(schema.monitors.name, "multi"));
  // A backdated late result is picked up by the next aggregator run (lookback), then a fresh one arrives.
  await mockDatabase.insert(schema.monitorResults).values(
    { monitorId: multi.id, checkedAt: new Date(midnight + 1000), isUp: true, status: "up", location: "eu-central" },
  );
  await aggregateAll();
  await mockDatabase.insert(schema.monitorResults).values(
    { monitorId: multi.id, checkedAt: new Date(Date.now() - 1000), isUp: false, status: "down", location: "us-east" },
  );
  await client`DELETE FROM monitor_aggregates WHERE period_type = 'daily' AND period_start = ${new Date(midnight - 7 * D).toISOString()}::timestamptz`;
  await client`DELETE FROM monitor_aggregates WHERE period_type = 'hourly' AND period_start = ${new Date(hourStart - 3 * H).toISOString()}::timestamptz`;
  const now = new Date();
  const from30 = new Date(now.getTime() - 30 * D);
  const from24 = new Date(now.getTime() - D);
  expect(await newDaily(from30, now)).toEqual(await rawDaily(from30));
  expect(await newTotals(from24, now)).toEqual(await rawTotals(from24));
});

it("does not read the raw table for completed periods", async () => {
  await aggregateAll();
  // Raw rows of a completed, aggregated day are gone (retention): the aggregate still answers.
  const day = midnight - 10 * D;
  const before = (await newDaily(new Date(day - 1), new Date())).find((d) => d.date === new Date(day).toISOString().slice(0, 10));
  await client`DELETE FROM monitor_results WHERE checked_at >= ${new Date(day).toISOString()}::timestamptz AND checked_at < ${new Date(day + D).toISOString()}::timestamptz`;
  const after = (await newDaily(new Date(day - 1), new Date())).find((d) => d.date === new Date(day).toISOString().slice(0, 10));
  expect(before?.totalCount).toBeGreaterThan(0);
  expect(after).toEqual(before);
});

it("keeps tenancy: another project or organization's checks never count", async () => {
  await aggregateAll();
  const now = new Date();
  const mine = await newDaily(new Date(now.getTime() - 30 * D), now);
  // single + multi only: 3 rows per boundary check for multi, 1 for single, no sibling/foreign rows.
  const everything = await mockDatabase.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.monitorResults);
  const total = mine.reduce((sum, d) => sum + d.totalCount, 0);
  expect(total).toBeLessThan(everything[0].n);
  expect(await newDaily(new Date(now.getTime() - 30 * D), now)).toEqual(await rawDaily(new Date(now.getTime() - 30 * D)));
});
