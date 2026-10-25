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
  const [job, siblingJob, foreignJob] = await mockDatabase
    .insert(schema.jobs)
    .values([
      { organizationId: org.id, projectId: project.id, name: "Nightly" },
      { organizationId: org.id, projectId: sibling.id, name: "Sibling job" },
      { organizationId: otherOrg.id, projectId: foreign.id, name: "Foreign job" },
    ])
    .returning();
  mockContext = { organizationId: org.id, project: { id: project.id } };

  const run = (jobId: string, status: schema.TestRunStatus, startedAt: Date, trigger: schema.JobTrigger = "manual") =>
    ({ jobId, status, startedAt, trigger });
  await mockDatabase.insert(schema.runs).values([
    // Seven failures over the last week; only the newest five are listed.
    ...Array.from({ length: 7 }, (_, i) => run(job.id, i % 2 ? "error" : "failed", daysAgo(i + 1))),
    run(job.id, "blocked", daysAgo(0)),
    run(job.id, "passed", daysAgo(2), "schedule"),
    run(job.id, "passed", daysAgo(2), "schedule"),
    run(job.id, "passed", daysAgo(2), "remote"),
    run(job.id, "failed", daysAgo(40)),
    run(siblingJob.id, "failed", daysAgo(0)),
    run(foreignJob.id, "failed", daysAgo(0)),
  ]);
}, 100000);

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("returns the project's newest failures and daily trigger counts without other tenants' runs", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  const { jobs } = await response.json();

  expect(jobs.failedRuns30d).toBe(7);
  expect(jobs.recentFailures).toHaveLength(5);
  expect(jobs.recentFailures.map((r: { startedAt: string }) => dayKey(new Date(r.startedAt))))
    .toEqual([1, 2, 3, 4, 5].map((d) => dayKey(daysAgo(d))));
  expect(jobs.recentFailures.every((r: { jobName: string; status: string }) =>
    r.jobName === "Nightly" && ["failed", "error"].includes(r.status))).toBe(true);
  expect(jobs).not.toHaveProperty("recentRuns");

  const byDay = new Map(jobs.triggerTrend.map((d: { date: string }) => [d.date, d]));
  expect(byDay.get(dayKey(daysAgo(2)))).toEqual({ date: dayKey(daysAgo(2)), manual: 1, scheduled: 2, remote: 1 });
  expect(byDay.get(dayKey(daysAgo(0)))).toEqual({ date: dayKey(daysAgo(0)), manual: 1, scheduled: 0, remote: 0 });
  expect(byDay.has(dayKey(daysAgo(40)))).toBe(false);
  const total = jobs.triggerTrend.reduce(
    (sum: number, d: { manual: number; scheduled: number; remote: number }) => sum + d.manual + d.scheduled + d.remote, 0);
  expect(total).toBe(jobs.recentRuns30d);
});
