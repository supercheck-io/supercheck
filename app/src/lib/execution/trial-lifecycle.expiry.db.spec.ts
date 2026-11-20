/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves the day-14 path: the sweep pauses an expired
// trial's monitors and archives its status pages; separately, the execution policy refuses an expired trial (402).
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
const deleteScheduledMonitor = jest.fn(async () => true);
const scheduleMonitor = jest.fn(async () => "sched-new");
jest.mock("@/lib/monitor-scheduler", () => ({ deleteScheduledMonitor, scheduleMonitor }));
import { endExpiredTrials, restoreTrialSuspensions } from "./trial-lifecycle";
import { clearExecutionPolicyCache, ExecutionWorkloadError, getExecutionPolicy } from "./execution-policy";

const name = `expiry_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const DAY = 86_400_000;
const savedEnv = { ...process.env };

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await promisify(execFile)(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
  // Cloud mode (the default) so the trial branch of the policy is the one under test.
  delete process.env.SELF_HOSTED;
  delete process.env.POLAR_ACCESS_TOKEN;
}, 100000);

afterAll(async () => {
  process.env = savedEnv;
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

beforeEach(async () => {
  // Trials left by an earlier test must not count in this test's sweep totals.
  await mockDatabase.update(schema.executionEntitlements).set({ lifecycleEndedAt: new Date() });
  jest.clearAllMocks();
  clearExecutionPolicyCache();
});

async function seedTrial(expiresAt: Date) {
  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  await mockDatabase.insert(schema.executionEntitlements).values({ organizationId: org.id, expiresAt } as never);
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "P" }).returning();
  const [monitor] = await mockDatabase.insert(schema.monitors).values({
    organizationId: org.id, projectId: project.id, name: "M", type: "http_request" as const,
    target: "https://example.com", frequencyMinutes: 5, status: "up" as const, scheduledJobId: "sched-1",
  }).returning();
  const [page] = await mockDatabase.insert(schema.statusPages).values({
    organizationId: org.id, projectId: project.id, name: "S", subdomain: randomUUID().replaceAll("-", ""), status: "published" as const,
  }).returning();
  return { org, monitor, page };
}

const monitorStatus = async (id: string) =>
  (await mockDatabase.select().from(schema.monitors).where(eq(schema.monitors.id, id)))[0].status;
const pageStatus = async (id: string) =>
  (await mockDatabase.select().from(schema.statusPages).where(eq(schema.statusPages.id, id)))[0].status;
const endedAt = async (orgId: string) =>
  (await mockDatabase.select().from(schema.executionEntitlements).where(eq(schema.executionEntitlements.organizationId, orgId)))[0].lifecycleEndedAt;

it("pauses an expired trial once, leaves a live trial alone, refuses execution with 402, and restores the setup on resubscribe", async () => {
  const expired = await seedTrial(new Date(Date.now() - DAY));
  const live = await seedTrial(new Date(Date.now() + DAY));

  // Before the sweep the live trial runs; the expired one is already refused at admission.
  await expect(getExecutionPolicy(live.org.id)).resolves.toMatchObject({ tier: "trial" });
  await expect(getExecutionPolicy(expired.org.id)).rejects.toMatchObject({ status: 402 });

  const first = await endExpiredTrials();
  expect(first).toMatchObject({ organizations: 1, monitorsPaused: 1, statusPagesArchived: 1 });
  expect(await monitorStatus(expired.monitor.id)).toBe("paused");
  expect(await pageStatus(expired.page.id)).toBe("archived");
  expect(await endedAt(expired.org.id)).not.toBeNull();
  expect(deleteScheduledMonitor).toHaveBeenCalledWith("sched-1");

  // The user's setup is kept (nothing deleted) and the suspension is recorded for restore.
  const suspensions = await mockDatabase.select().from(schema.trialSuspensions).where(eq(schema.trialSuspensions.organizationId, expired.org.id));
  expect(suspensions.map((r) => [r.resourceType, r.previousStatus]).sort()).toEqual([["monitor", "up"], ["status_page", "published"]]);

  const error = await getExecutionPolicy(expired.org.id).catch((e) => e);
  expect(error).toBeInstanceOf(ExecutionWorkloadError);
  expect(error.status).toBe(402);

  expect(await monitorStatus(live.monitor.id)).toBe("up");
  expect(await pageStatus(live.page.id)).toBe("published");
  expect(await endedAt(live.org.id)).toBeNull();

  // Idempotent: a second run (the sweep fires every 15 minutes) changes nothing.
  expect(await endExpiredTrials()).toEqual({ organizations: 0, monitorsPaused: 0, statusPagesArchived: 0 });

  expect(await restoreTrialSuspensions(expired.org.id)).toEqual({ monitorsResumed: 1, statusPagesRestored: 1 });
  expect(await pageStatus(expired.page.id)).toBe("published");
  expect(await monitorStatus(expired.monitor.id)).toBe("pending");
  expect(scheduleMonitor).toHaveBeenCalledTimes(1);
  expect(await mockDatabase.select().from(schema.trialSuspensions).where(eq(schema.trialSuspensions.organizationId, expired.org.id))).toHaveLength(0);
});

it("refuses an ended trial with 402 when billing is configured (production path), and still admits a live one", async () => {
  process.env.POLAR_ACCESS_TOKEN = "test-token";
  try {
    const expired = await seedTrial(new Date(Date.now() - DAY));
    const live = await seedTrial(new Date(Date.now() + DAY));
    await expect(getExecutionPolicy(expired.org.id)).rejects.toMatchObject({ status: 402 });
    await expect(getExecutionPolicy(live.org.id)).resolves.toMatchObject({ tier: "trial" });
  } finally {
    delete process.env.POLAR_ACCESS_TOKEN;
  }
});
