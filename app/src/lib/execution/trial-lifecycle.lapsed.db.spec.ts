/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves suspending ended subscriptions and restoring on resubscribe.
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
import { restoreTrialSuspensions, suspendLapsedOrganizations } from "./trial-lifecycle";

const name = `lapsed_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const NOW = new Date();
const DAY = 86_400_000;

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
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

beforeEach(() => jest.clearAllMocks());

async function seed(fields: { status: "active" | "canceled" | "past_due" | "none"; endsAt?: Date; trialEndsAt?: Date }) {
  const [org] = await mockDatabase.insert(schema.organization).values({
    name: "Org", createdAt: new Date(), subscriptionStatus: fields.status,
    subscriptionPlan: fields.status === "none" ? null : "plus", subscriptionEndsAt: fields.endsAt ?? null,
    polarCustomerId: `cus-${randomUUID()}`, subscriptionId: `sub-${randomUUID()}`,
  }).returning();
  if (fields.trialEndsAt) {
    await mockDatabase.insert(schema.executionEntitlements).values({ organizationId: org.id, expiresAt: fields.trialEndsAt } as never);
  }
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

it("suspends revoked and period-ended organizations once, and restores them on resubscribe", async () => {
  const revoked = await seed({ status: "none" });
  const ended = await seed({ status: "canceled", endsAt: new Date(NOW.getTime() - DAY) });
  const result = await suspendLapsedOrganizations({ now: NOW });
  expect(result).toMatchObject({ organizations: 2, monitorsPaused: 2, statusPagesArchived: 2 });
  for (const { monitor, page } of [revoked, ended]) {
    expect(await monitorStatus(monitor.id)).toBe("paused");
    expect(await pageStatus(page.id)).toBe("archived");
  }
  expect(deleteScheduledMonitor).toHaveBeenCalledWith("sched-1");

  // Idempotent: a second run finds nothing to do.
  expect(await suspendLapsedOrganizations({ now: NOW })).toMatchObject({ organizations: 0, monitorsPaused: 0 });

  // Resubscribing goes through the existing restore path.
  expect(await restoreTrialSuspensions(revoked.org.id)).toEqual({ monitorsResumed: 1, statusPagesRestored: 1 });
  expect(await monitorStatus(revoked.monitor.id)).toBe("pending");
  expect(await pageStatus(revoked.page.id)).toBe("published");
  expect(await monitorStatus(ended.monitor.id)).toBe("paused");
});

it("never touches past_due, a canceled period still running, active, or an organization in its trial", async () => {
  const kept = [
    await seed({ status: "past_due" }),
    await seed({ status: "canceled", endsAt: new Date(NOW.getTime() + DAY) }),
    await seed({ status: "active" }),
    await seed({ status: "none", trialEndsAt: new Date(NOW.getTime() + DAY) }),
  ];
  await suspendLapsedOrganizations({ now: NOW });
  for (const { monitor, page } of kept) {
    expect(await monitorStatus(monitor.id)).toBe("up");
    expect(await pageStatus(page.id)).toBe("published");
  }
});
