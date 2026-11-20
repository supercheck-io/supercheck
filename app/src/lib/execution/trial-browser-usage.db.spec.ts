/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves the 50% / 100% browser-minute emails fire once per organization.
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
import { sendTrialReminders } from "./trial-lifecycle";

const name = `browser_usage_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const NOW = new Date();
const BUDGET_MS = 1000 * 60_000;

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

/** A trial organization with one verified owner and a given share of the browser allowance used. */
async function seedTrial(usedShare: number) {
  const id = randomUUID();
  const [org] = await mockDatabase.insert(schema.organization).values({ name: `Org ${id}`, createdAt: new Date() }).returning();
  const [owner] = await mockDatabase.insert(schema.user).values({ name: "Owner", email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() } as never).returning();
  await mockDatabase.insert(schema.member).values({ organizationId: org.id, userId: owner.id, role: "org_owner", createdAt: new Date() } as never);
  await mockDatabase.insert(schema.executionEntitlements).values({
    organizationId: org.id,
    expiresAt: new Date(NOW.getTime() + 20 * 86_400_000),
    trialStartedAt: NOW,
    playwrightBudgetMs: BUDGET_MS,
    playwrightUsedMs: Math.round(BUDGET_MS * usedShare),
  } as never);
  return { orgId: org.id, email: owner.email };
}

const setUsed = (orgId: string, share: number) =>
  mockDatabase.update(schema.executionEntitlements).set({ playwrightUsedMs: Math.round(BUDGET_MS * share) }).where(eq(schema.executionEntitlements.organizationId, orgId));

/** Only this test's organizations: other seeded rows in the shared database must not leak into the count. */
const runFor = async (orgIds: string[]) => {
  const deliver = jest.fn().mockResolvedValue(true);
  await sendTrialReminders({ now: NOW, deliver });
  return deliver.mock.calls.map(([d]) => d).filter((d) => orgIds.includes(d.organizationId)).map((d) => [d.kind, d.organizationId, d.recipients] as const);
};

describe("trial browser-minute usage emails", () => {
  it("sends nothing below 50%", async () => {
    const { orgId } = await seedTrial(0.49);
    expect(await runFor([orgId])).toEqual([]);
  });

  it("sends the 50% email once, to the owner, and the 100% email once", async () => {
    const { orgId, email } = await seedTrial(0.5);
    expect(await runFor([orgId])).toEqual([["browserHalf", orgId, [email]]]);
    expect(await runFor([orgId])).toEqual([]);

    await setUsed(orgId, 0.75);
    expect(await runFor([orgId])).toEqual([]);

    await setUsed(orgId, 1);
    expect(await runFor([orgId])).toEqual([["browserFull", orgId, [email]]]);
    expect(await runFor([orgId])).toEqual([]);
  });

  it("counts the allowance as used up once under one minimum run is left, as the worker stops admitting runs", async () => {
    const { orgId } = await seedTrial(0.6);
    await mockDatabase.update(schema.executionEntitlements).set({ playwrightUsedMs: BUDGET_MS - 2_500 }).where(eq(schema.executionEntitlements.organizationId, orgId));
    expect((await runFor([orgId])).map(([kind]) => kind)).toEqual(["browserFull"]);
  });

  it("sends only the 100% email when usage jumps past both thresholds", async () => {
    const { orgId } = await seedTrial(1.2);
    expect((await runFor([orgId])).map(([kind]) => kind)).toEqual(["browserFull"]);
    expect(await runFor([orgId])).toEqual([]);
  });

  it("retries on the next run when delivery failed", async () => {
    const { orgId } = await seedTrial(0.6);
    const failing = jest.fn().mockResolvedValue(false);
    await sendTrialReminders({ now: NOW, deliver: failing });
    expect(await runFor([orgId])).toHaveLength(1);
  });
});
