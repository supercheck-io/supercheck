/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves that resuming a monitor through the update
// service counts and writes under the plan-limit lock, so simultaneous resumes cannot exceed the plan.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
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
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => true }));
jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: { getOrganizationPlan: async () => ({ id: "plus", plan: "plus", maxMonitors: 2, maxStatusPages: 1 }) },
}));
jest.mock("@/lib/queue", () => ({ addMonitorExecutionJobToQueue: jest.fn(async () => undefined) }));
jest.mock("@/lib/monitor-scheduler", () => ({
  scheduleMonitor: jest.fn(async () => "schedule-1"),
  deleteScheduledMonitor: jest.fn(async () => true),
}));
import { ResumeRefusedError } from "@/lib/middleware/plan-enforcement";
import { MonitorTargetChangedError, updateMonitorHandler } from "./monitor-service";

const name = `monitor_svc_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../..");
  await promisify(execFile)(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 10, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

async function seed(active: number, paused: number) {
  const [organization] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: organization.id, name: "P" }).returning();
  const row = (status: "up" | "paused") => ({
    organizationId: organization.id, projectId: project.id, name: "M", type: "http_request" as const,
    target: "https://example.com", frequencyMinutes: 5, status, enabled: status !== "paused",
  });
  const rows = await mockDatabase.insert(schema.monitors)
    .values([...Array.from({ length: active }, () => row("up")), ...Array.from({ length: paused }, () => row("paused"))]).returning();
  return { organization, pausedRows: rows.filter((r) => r.status === "paused") };
}

const activeCount = async (organizationId: string) =>
  (await mockDatabase.select().from(schema.monitors).where(eq(schema.monitors.organizationId, organizationId)))
    .filter((row) => row.status !== "paused").length;

it("refuses to resume a paused monitor at the plan limit and leaves it paused", async () => {
  const { organization, pausedRows } = await seed(2, 1);
  await expect(updateMonitorHandler(pausedRows[0].id, { enabled: true })).rejects.toBeInstanceOf(ResumeRefusedError);
  expect(await activeCount(organization.id)).toBe(2);
});

it("resumes below the limit", async () => {
  const { organization, pausedRows } = await seed(1, 1);
  await expect(updateMonitorHandler(pausedRows[0].id, { enabled: true })).resolves.toMatchObject({ enabled: true });
  expect(await activeCount(organization.id)).toBe(2);
});

it("lets only one of several simultaneous resumes take the last slot", async () => {
  const { organization, pausedRows } = await seed(1, 4);
  const results = await Promise.allSettled(pausedRows.map((row) => updateMonitorHandler(row.id, { enabled: true })));
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected" && r.reason instanceof ResumeRefusedError)).toHaveLength(3);
  expect(await activeCount(organization.id)).toBe(2);
});

it("does not take a slot for an edit that does not resume", async () => {
  const { organization } = await seed(2, 0);
  const [active] = await mockDatabase.select().from(schema.monitors).where(eq(schema.monitors.organizationId, organization.id));
  await expect(updateMonitorHandler(active.id, { name: "Renamed" })).resolves.toMatchObject({ name: "Renamed" });
});

it("writes a secret-bearing monitor only while its target is still the checked one", async () => {
  const { organization } = await seed(1, 0);
  const [monitor] = await mockDatabase.select().from(schema.monitors).where(eq(schema.monitors.organizationId, organization.id));
  // A concurrent request moved the target after this one read it.
  await mockDatabase.update(schema.monitors).set({ target: "https://collector.example" }).where(eq(schema.monitors.id, monitor.id));
  await expect(
    updateMonitorHandler(monitor.id, { config: { auth: { type: "bearer", secretKey: "K" } } }, { expectTarget: "https://example.com" }),
  ).rejects.toBeInstanceOf(MonitorTargetChangedError);
  const [after] = await mockDatabase.select().from(schema.monitors).where(eq(schema.monitors.id, monitor.id));
  expect(after.config?.auth?.secretKey).toBeUndefined();
  await expect(
    updateMonitorHandler(monitor.id, { name: "Renamed" }, { expectTarget: "https://collector.example" }),
  ).resolves.toMatchObject({ name: "Renamed" });
});
