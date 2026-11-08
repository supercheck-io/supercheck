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
jest.mock("@/lib/execution/execution-policy", () => ({
  ...jest.requireActual("@/lib/execution/execution-policy"),
  getExecutionPolicy: jest.fn().mockResolvedValue({ tier: "paid", priority: 0, runningCapacity: 5, queuedCapacity: 50 }),
}));
jest.mock("@/lib/services/polar-usage.service", () => ({
  polarUsageService: { shouldBlockUsage: jest.fn().mockResolvedValue({ blocked: false }) },
}));
jest.mock("@/lib/queue", () => ({
  addJobToQueue: jest.fn(),
  addK6JobToQueue: jest.fn(),
  assertExecutionQueueReady: jest.fn().mockResolvedValue(undefined),
  queueLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("@/lib/job-execution-utils", () => ({
  prepareJobTestScripts: jest.fn().mockResolvedValue({
    testScripts: [{ id: "test-1", script: "code", title: "t" }],
    variableResolution: { variables: {}, secrets: {}, files: {} },
  }),
}));
jest.mock("@/lib/location-registry", () => ({
  resolveProjectK6Location: jest.fn(),
  assertProjectSupportsBrowser: jest.fn().mockResolvedValue(undefined),
  LocationWorkloadUnavailableError: class extends Error {},
}));
jest.mock("@/lib/job-scheduler", () => ({ deleteScheduledJob: jest.fn() }));

import { addJobToQueue, addK6JobToQueue } from "@/lib/queue";
import { prepareJobTestScripts } from "@/lib/job-execution-utils";
import { resolveProjectK6Location } from "@/lib/location-registry";
import { processScheduledJob } from "./job-scheduler";

const execFileAsync = promisify(execFile);
const name = `job_scheduler_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let jobId: string;
let projectId: string;
let organizationId: string;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
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
  jest.clearAllMocks();
  (addJobToQueue as jest.Mock).mockResolvedValue({ status: "queued", position: 1 });
  await client`TRUNCATE jobs, organization CASCADE`;
  const [organization] = await mockDatabase.insert(schema.organization).values({ name: "Test", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: organization.id, name: "Project" }).returning();
  const [job] = await mockDatabase
    .insert(schema.jobs)
    .values({ organizationId: organization.id, projectId: project.id, name: "J", jobType: "playwright", cronSchedule: "*/5 * * * *" } as never)
    .returning();
  jobId = job.id;
  projectId = project.id;
  organizationId = organization.id;
});

const tick = (id: string, attemptsMade = 0) =>
  ({ id, attemptsMade, data: { jobId, projectId, organizationId } }) as Parameters<typeof processScheduledJob>[0];
const runsOf = () => mockDatabase.select().from(schema.runs).where(eq(schema.runs.jobId, jobId));
const finishAll = () => mockDatabase.update(schema.runs).set({ status: "passed" } as never).where(eq(schema.runs.jobId, jobId));

describe("scheduled tick idempotency (real runs table)", () => {
  it("a redelivered tick creates no second run, even after the first run finished", async () => {
    await processScheduledJob(tick("repeat:h:1000"));
    expect(await runsOf()).toHaveLength(1);
    expect((await runsOf())[0].metadata).toMatchObject({ scheduleTickKey: "repeat:h:1000:0" });
    await finishAll(); // the active-run check no longer sees it
    await expect(processScheduledJob(tick("repeat:h:1000"))).resolves.toEqual({ success: true });
    expect(await runsOf()).toHaveLength(1);
    expect(addJobToQueue).toHaveBeenCalledTimes(1);
  });

  it("a retry with a higher attemptsMade still creates a run", async () => {
    await processScheduledJob(tick("repeat:h:2000"));
    await finishAll();
    await processScheduledJob(tick("repeat:h:2000", 1));
    const runs = await runsOf();
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => (r.metadata as { scheduleTickKey: string }).scheduleTickKey).sort()).toEqual(["repeat:h:2000:0", "repeat:h:2000:1"]);
  });

  it("the next cron tick is a different tick and creates its own run", async () => {
    await processScheduledJob(tick("repeat:h:3000"));
    await finishAll();
    await processScheduledJob(tick("repeat:h:4000"));
    expect(await runsOf()).toHaveLength(2);
  });

  it("two processors of the same tick running at once create exactly one run", async () => {
    await Promise.all(Array.from({ length: 4 }, () => processScheduledJob(tick("repeat:h:5000"))));
    expect(await runsOf()).toHaveLength(1);
    expect(addJobToQueue).toHaveBeenCalledTimes(1);
  });

  it("the 24h-bounded tick lookup is served by an index on job_id, not a sequential scan", async () => {
    const rows = Array.from({ length: 3000 }, (_, i) => ({
      jobId, projectId, status: "passed", trigger: "schedule",
      createdAt: new Date(Date.now() - i * 60_000),
      metadata: { scheduleTickKey: `repeat:h:${i}:0` },
    }));
    await mockDatabase.insert(schema.runs).values(rows as never);
    await client`ANALYZE runs`;
    const plan = await client.unsafe(
      `EXPLAIN (FORMAT TEXT) SELECT id FROM runs WHERE job_id = $1 AND created_at >= now() - interval '24 hours' AND metadata->>'scheduleTickKey' = $2 LIMIT 1`,
      [jobId, "repeat:h:100:0"],
    );
    const text = plan.map((row) => row["QUERY PLAN"]).join("\n");
    console.info(`tick lookup plan:\n${text}`);
    expect(text).toMatch(/Index|Bitmap/);
    expect(text).not.toMatch(/Seq Scan on runs/);
  });

  it("a k6 tick carries the tick key and a redelivery of it creates no second run", async () => {
    await mockDatabase.update(schema.jobs).set({ jobType: "k6" } as never).where(eq(schema.jobs.id, jobId));
    (resolveProjectK6Location as jest.Mock).mockResolvedValue("global");
    (addK6JobToQueue as jest.Mock).mockResolvedValue({ status: "queued", position: 1 });
    (prepareJobTestScripts as jest.Mock).mockResolvedValue({
      testScripts: [{ id: "test-1", type: "performance", title: "t", script: "import http from 'k6/http';\nexport default function () { http.get('https://example.com'); }" }],
      variableResolution: { variables: {}, secrets: {}, files: {} },
    });
    await processScheduledJob(tick("repeat:k6:1000"));
    const first = await runsOf();
    expect(first).toHaveLength(1);
    expect(first[0].metadata).toMatchObject({ jobType: "k6", scheduleTickKey: "repeat:k6:1000:0" });
    await finishAll();
    await processScheduledJob(tick("repeat:k6:1000"));
    expect(await runsOf()).toHaveLength(1);
    expect(addK6JobToQueue).toHaveBeenCalledTimes(1);
  });
});
