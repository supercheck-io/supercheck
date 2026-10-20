/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
import { abortMonitorCycle, monitorCycleId, persistMonitorCycle } from "./monitor-cycles";
const execFileAsync = promisify(execFile);
const name = `monitor_cycles_${randomUUID().replaceAll("-", "")}`;
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

const cycle = (id: string) => ({
  id,
  monitorId,
  scheduledFor: new Date(),
  deadlineAt: new Date(Date.now() + 60_000),
  expectedLocations: ["eu", "us"],
  strategy: "majority" as const,
  threshold: 50,
});

it("creates a cycle once per id and rejects invalid states", async () => {
  await mockDatabase.insert(schema.monitorCycles).values(cycle("c-1"));
  await expect(
    mockDatabase.insert(schema.monitorCycles).values(cycle("c-1")),
  ).rejects.toThrow();
  await expect(
    mockDatabase
      .insert(schema.monitorCycles)
      .values({ ...cycle("c-2"), status: "bogus" as never }),
  ).rejects.toThrow();
  await expect(
    mockDatabase
      .insert(schema.monitorCycles)
      .values({ ...cycle("c-3"), closedBy: "someone" as never }),
  ).rejects.toThrow();
});

it("keeps one arrival per region and cascades with the monitor", async () => {
  await mockDatabase.insert(schema.monitorCycles).values(cycle("c-4"));
  await mockDatabase
    .insert(schema.monitorCycleArrivals)
    .values({ cycleId: "c-4", location: "eu", isUp: true });
  await expect(
    mockDatabase
      .insert(schema.monitorCycleArrivals)
      .values({ cycleId: "c-4", location: "eu", isUp: false }),
  ).rejects.toThrow();
  await mockDatabase
    .delete(schema.monitors)
    .where(eq(schema.monitors.id, monitorId));
  expect(await client`SELECT id FROM monitor_cycles`).toHaveLength(0);
  expect(await client`SELECT id FROM monitor_cycle_arrivals`).toHaveLength(0);
});

it("indexes only pending relay work with partial indexes", async () => {
  const rows = await client`SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename IN ('monitor_cycles', 'monitor_cycle_arrivals')`;
  const def = (name: string) =>
    rows.find((row) => row.indexname === name)?.indexdef as string;
  expect(def("monitor_cycles_deadline_pending_idx")).toContain("WHERE");
  expect(def("monitor_cycles_notify_pending_idx")).toContain("notified_at IS NULL");
  expect(def("monitor_cycle_arrivals_pending_idx")).toContain("published_at IS NULL");
  // Hot results table is untouched: the cycle id reuses the existing execution_group_id index.
  const [{ count }] = await client`SELECT count(*)::int AS count FROM pg_indexes
    WHERE tablename = 'monitor_results' AND indexdef ILIKE '%cycle%'`;
  expect(count).toBe(0);
});

it("persists a cycle idempotently so a scheduler retry reuses it", async () => {
  const id = monitorCycleId(monitorId, "repeat:abc:1000");
  const input = {
    id,
    monitorId,
    configuredLocations: ["eu", "us", "eu"],
    policy: { strategy: "majority" as const, threshold: 50 },
    deadlineMs: 60_000,
  };
  const first = await persistMonitorCycle(input);
  const retry = await persistMonitorCycle({ ...input, configuredLocations: ["other"] });
  expect(first).toEqual({ created: true });
  expect(retry).toEqual({ created: false });
  const [row] = await mockDatabase
    .select()
    .from(schema.monitorCycles)
    .where(eq(schema.monitorCycles.id, id));
  expect(row.expectedLocations).toEqual(["eu", "us"]);
  expect(row.status).toBe("open");
  expect(row.deadlineAt.getTime()).toBeGreaterThan(row.scheduledFor.getTime());
});

it("aborts only open cycles", async () => {
  const id = monitorCycleId(monitorId, "k");
  await persistMonitorCycle({
    id,
    monitorId,
    configuredLocations: ["eu"],
    policy: { strategy: "all", threshold: 100 },
  });
  await abortMonitorCycle(id);
  const [aborted] = await client`SELECT status, closed_at FROM monitor_cycles WHERE id = ${id}`;
  expect(aborted.status).toBe("aborted");
  expect(aborted.closed_at).not.toBeNull();
  await client`UPDATE monitor_cycles SET status = 'closed', closed_by = 'arrival', result_status = 'up' WHERE id = ${id}`;
  await abortMonitorCycle(id);
  const [still] = await client`SELECT status FROM monitor_cycles WHERE id = ${id}`;
  expect(still.status).toBe("closed");
});
