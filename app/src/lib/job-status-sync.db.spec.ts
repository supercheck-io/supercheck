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
import { syncJobStatusFromRuns } from "./job-status-sync";
const execFileAsync = promisify(execFile);
const name = `job_status_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let jobId: string;
let projectId: string;

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
  await client`TRUNCATE jobs, organization CASCADE`;
  const [organization] = await mockDatabase
    .insert(schema.organization)
    .values({ name: "Test", createdAt: new Date() })
    .returning();
  const [project] = await mockDatabase
    .insert(schema.projects)
    .values({ organizationId: organization.id, name: "Project" })
    .returning();
  const [job] = await mockDatabase
    .insert(schema.jobs)
    .values({ organizationId: organization.id, projectId: project.id, name: "J", jobType: "playwright", cronSchedule: null } as never)
    .returning();
  jobId = job.id;
  projectId = project.id;
});

const addRun = async (status: string, at: string) =>
  (
    await mockDatabase
      .insert(schema.runs)
      .values({ jobId, projectId, status, trigger: "manual", createdAt: new Date(at) } as never)
      .returning({ id: schema.runs.id })
  )[0].id;
const setRun = (id: string, status: string) =>
  mockDatabase.update(schema.runs).set({ status } as never).where(eq(schema.runs.id, id));
const jobStatus = async () =>
  (await mockDatabase.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0].status;

it("a newer run finishing first does not leave the job stuck on running", async () => {
  const a = await addRun("running", "2026-01-01T00:01:00Z");
  const b = await addRun("running", "2026-01-01T00:02:00Z");
  await setRun(b, "passed");
  await syncJobStatusFromRuns(mockDatabase, jobId);
  expect(await jobStatus()).toBe("running");
  await setRun(a, "failed");
  await syncJobStatusFromRuns(mockDatabase, jobId);
  expect(await jobStatus()).toBe("passed");
});

it("follows the newest remaining run after a run is deleted", async () => {
  await addRun("passed", "2026-01-01T00:01:00Z");
  const newest = await addRun("failed", "2026-01-01T00:02:00Z");
  await syncJobStatusFromRuns(mockDatabase, jobId);
  expect(await jobStatus()).toBe("failed");
  await mockDatabase.delete(schema.runs).where(eq(schema.runs.id, newest));
  await syncJobStatusFromRuns(mockDatabase, jobId);
  expect(await jobStatus()).toBe("passed");
});

it("leaves the status unchanged with no runs", async () => {
  const before = await jobStatus();
  await syncJobStatusFromRuns(mockDatabase, jobId);
  expect(await jobStatus()).toBe(before);
});
