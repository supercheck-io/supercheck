/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
let mockContext: { organizationId: string; project: { id: string } };
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/queue-stats", () => ({
  getQueueStats: jest.fn(async () => ({ running: 0, queued: 0, runningCapacity: 1, queuedCapacity: 10 })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => mockContext),
  isAuthError: jest.fn(() => false),
}));
import { GET } from "./route";
import { getQueueStats } from "@/lib/queue-stats";

const execFileAsync = promisify(execFile);
const name = `dashboard_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

// Noon UTC keeps every seeded run inside one calendar day.
const daysAgo = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(12, 0, 0, 0);
  return date;
};
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });

  const [org, otherOrg] = await mockDatabase
    .insert(schema.organization)
    .values([{ name: "Org", createdAt: new Date() }, { name: "Other", createdAt: new Date() }])
    .returning();
  const [project, sibling, foreign] = await mockDatabase
    .insert(schema.projects)
    .values([
      { organizationId: org.id, name: "Project" },
      { organizationId: org.id, name: "Sibling" },
      { organizationId: otherOrg.id, name: "Foreign" },
    ])
    .returning();
  const [job, siblingJob, foreignJob, k6Job] = await mockDatabase
    .insert(schema.jobs)
    .values([
      { organizationId: org.id, projectId: project.id, name: "Nightly" },
      { organizationId: org.id, projectId: sibling.id, name: "Sibling job" },
      { organizationId: otherOrg.id, projectId: foreign.id, name: "Foreign job" },
      { organizationId: org.id, projectId: project.id, name: "Load test", jobType: "k6" },
    ])
    .returning();
  mockContext = { organizationId: org.id, project: { id: project.id } };

  const run = (jobId: string, status: schema.TestRunStatus, startedAt: Date, trigger: schema.JobTrigger = "manual") =>
    ({ jobId, status, startedAt, trigger });
  await mockDatabase.insert(schema.runs).values([
    // Six failures in the last week and one older, so the 7-day window has a clear edge.
    ...Array.from({ length: 7 }, (_, i) => run(job.id, i % 2 ? "error" : "failed", daysAgo(i < 6 ? i + 1 : 10))),
    run(job.id, "blocked", daysAgo(0)),
    run(job.id, "passed", daysAgo(2), "schedule"),
    run(job.id, "passed", daysAgo(2), "schedule"),
    run(job.id, "passed", daysAgo(2), "remote"),
    run(job.id, "failed", daysAgo(40)),
    run(siblingJob.id, "failed", daysAgo(0)),
    run(foreignJob.id, "failed", daysAgo(0)),
    // k6 job runs stay out of the Playwright run counts but count in the 24h/7d failure signals
    run(k6Job.id, "failed", daysAgo(0)),
    run(k6Job.id, "passed", daysAgo(2)),
  ]);

  const [active, paused] = await mockDatabase
    .insert(schema.monitors)
    .values([
      { organizationId: org.id, projectId: project.id, name: "Active", type: "http_request", target: "https://a.test", status: "up" },
      { organizationId: org.id, projectId: project.id, name: "Paused", type: "http_request", target: "https://p.test", status: "paused", enabled: false },
    ])
    .returning();
  const result = (monitorId: string, isUp: boolean, responseTimeMs: number | null) =>
    ({ monitorId, isUp, responseTimeMs, status: isUp ? "up" : "down", checkedAt: new Date() } as const);
  await mockDatabase.insert(schema.monitorResults).values([
    result(active.id, true, 0),
    result(paused.id, false, null),
    result(paused.id, false, null),
  ]);
}, 100000);

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("returns the project's 7-day failures and daily trigger counts without other tenants' runs", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  const { jobs } = await response.json();

  expect(jobs.failedRuns30d).toBe(7);
  // Failed and error runs of any job type count (6 Playwright + 1 k6); the 10-day, 40-day and other tenants' runs are excluded.
  expect(jobs.failedRuns7d).toEqual({ manual: 7, scheduled: 0, remote: 0 });
  expect(jobs).not.toHaveProperty("recentRuns");

  const byDay = new Map(jobs.triggerTrend.map((d: { date: string }) => [d.date, d]));
  expect(byDay.get(dayKey(daysAgo(2)))).toEqual({ date: dayKey(daysAgo(2)), manual: 1, scheduled: 2, remote: 1 });
  expect(byDay.get(dayKey(daysAgo(0)))).toEqual({ date: dayKey(daysAgo(0)), manual: 1, scheduled: 0, remote: 0 });
  expect(byDay.has(dayKey(daysAgo(40)))).toBe(false);
  const total = jobs.triggerTrend.reduce(
    (sum: number, d: { manual: number; scheduled: number; remote: number }) => sum + d.manual + d.scheduled + d.remote, 0);
  expect(total).toBe(jobs.recentRuns30d);
});

it("excludes k6 job runs from Playwright run counts", async () => {
  const { jobs } = await (await GET()).json();
  // 1 k6 failed + 1 k6 passed run were seeded; 7 failures + 3 passed + 1 blocked remain
  expect(jobs.recentRuns30d).toBe(11);
  expect(jobs.passedRuns30d).toBe(3);
});

it("counts failed k6 job runs in the 24h and 7d failure signals", async () => {
  const { jobs } = await (await GET()).json();
  // Today's k6 failure is always in range; yesterday's noon Playwright failure only before noon UTC.
  const yesterdayInRange = daysAgo(1).getTime() >= Date.now() - 24 * 3600_000;
  expect(jobs.failedRuns24h).toBe(1 + (yesterdayInRange ? 1 : 0));
  expect(jobs.failedRuns7d.manual).toBe(7);
});

it("keeps a 0 ms response time and computes uptime over every monitor with checks", async () => {
  const { monitors } = await (await GET()).json();
  // 1 up check (Active) + 2 down checks (Paused): history is not rewritten by current monitor state
  expect(monitors.uptime).toBeCloseTo(33.33, 1);
  expect(monitors.responseTime.min).toBe(0);
  expect(monitors.responseTime.max).toBe(0);
});

it("reports null uptime when the project has no checks", async () => {
  const [empty] = await mockDatabase
    .insert(schema.projects).values({ organizationId: mockContext.organizationId, name: "Empty" }).returning();
  mockContext = { ...mockContext, project: { id: empty.id } };
  const { monitors } = await (await GET()).json();
  expect(monitors.uptime).toBeNull();
});

it("still serves the dashboard when queue stats fail", async () => {
  jest.mocked(getQueueStats).mockRejectedValueOnce(new Error("redis down"));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).queue).toEqual({ running: 0, queued: 0, runningCapacity: 0, queuedCapacity: 0 });
  } finally { log.mockRestore(); }
});
