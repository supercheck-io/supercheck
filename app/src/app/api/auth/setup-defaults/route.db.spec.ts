/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
let mockUser: { id: string; email: string; name: string };
let mockToken: string;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUser: () => mockUser }));
jest.mock("@/utils/auth", () => ({ auth: { api: { getSession: () => ({ session: { token: mockToken } }) } } }));
jest.mock("next/headers", () => ({ headers: () => new Headers() }));
jest.mock("@/lib/feature-flags", () => ({ isCloudHosted: () => true }));
jest.mock("@/lib/services/organization-customer", () => ({ ensurePolarCustomerAndLink: jest.fn() }));
import { POST } from "./route";

const dbName = `trial_grant_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const originalTrialFlag = process.env.TRIAL_ENABLED;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${dbName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${dbName}`;
  const appRoot = path.resolve(__dirname, "../../../../..");
  await promisify(execFile)(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  if (originalTrialFlag === undefined) delete process.env.TRIAL_ENABLED;
  else process.env.TRIAL_ENABLED = originalTrialFlag;
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

beforeEach(async () => {
  process.env.TRIAL_ENABLED = "true";
  mockUser = { id: randomUUID(), email: `${randomUUID()}@example.com`, name: "Trial owner" };
  mockToken = randomUUID();
  await mockDatabase.insert(schema.user).values({ ...mockUser, emailVerified: true });
  await mockDatabase.insert(schema.session).values({
    id: randomUUID(), token: mockToken, userId: mockUser.id,
    expiresAt: new Date(Date.now() + 3600000), createdAt: new Date(), updatedAt: new Date(),
  });
});

function request() {
  return new NextRequest("https://app.supercheck.io/api/auth/setup-defaults", {
    method: "POST", headers: { origin: "https://app.supercheck.io" },
  });
}

it("serializes concurrent signup and preserves the grant after organization deletion", async () => {
  const responses = await Promise.all([POST(request()), POST(request())]);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  const memberships = await mockDatabase.select().from(schema.member).where(eq(schema.member.userId, mockUser.id));
  expect(memberships).toHaveLength(1);
  const orgId = memberships[0].organizationId;
  const [trial] = await mockDatabase.select().from(schema.executionEntitlements).where(eq(schema.executionEntitlements.organizationId, orgId));
  const [owner] = await mockDatabase.select().from(schema.user).where(eq(schema.user.id, mockUser.id));
  expect(owner.trialGrantedAt).toEqual(trial.trialStartedAt);
  expect(owner.trialGrantedAt).toBeInstanceOf(Date);

  await mockDatabase.update(schema.session).set({ activeOrganizationId: null, activeProjectId: null }).where(eq(schema.session.userId, mockUser.id));
  await mockDatabase.delete(schema.projects).where(eq(schema.projects.organizationId, orgId));
  await mockDatabase.delete(schema.member).where(eq(schema.member.organizationId, orgId));
  await mockDatabase.delete(schema.organization).where(eq(schema.organization.id, orgId));
  expect((await POST(request())).status).toBe(200);
  const [replacement] = await mockDatabase.select().from(schema.member).where(eq(schema.member.userId, mockUser.id));
  expect(replacement.organizationId).not.toBe(orgId);
  expect(await mockDatabase.select().from(schema.executionEntitlements).where(eq(schema.executionEntitlements.organizationId, replacement.organizationId))).toEqual([]);
  const [after] = await mockDatabase.select().from(schema.user).where(eq(schema.user.id, mockUser.id));
  expect(after.trialGrantedAt).toEqual(owner.trialGrantedAt);
});

it("rolls the grant back if the browser session disappears during signup", async () => {
  await mockDatabase.delete(schema.session).where(eq(schema.session.token, mockToken));
  expect((await POST(request())).status).toBe(401);
  const [owner] = await mockDatabase.select().from(schema.user).where(eq(schema.user.id, mockUser.id));
  expect(owner.trialGrantedAt).toBeNull();
  expect(await mockDatabase.select().from(schema.member).where(eq(schema.member.userId, mockUser.id))).toEqual([]);
});

it("backfills an expired owner's trial once and preserves an existing grant timestamp", async () => {
  expect((await POST(request())).status).toBe(200);
  const [membership] = await mockDatabase.select().from(schema.member).where(eq(schema.member.userId, mockUser.id));
  const startedAt = new Date("2025-01-01T00:00:00Z");
  await mockDatabase.update(schema.executionEntitlements).set({ trialStartedAt: startedAt, expiresAt: new Date("2025-01-15T00:00:00Z") }).where(eq(schema.executionEntitlements.organizationId, membership.organizationId));
  await mockDatabase.update(schema.user).set({ trialGrantedAt: null }).where(eq(schema.user.id, mockUser.id));
  const migration = await readFile(path.resolve(__dirname, "../../../../db/migrations/0042_backfill_user_trial_grants.sql"), "utf8");
  await client.unsafe(migration);
  const [backfilled] = await mockDatabase.select().from(schema.user).where(eq(schema.user.id, mockUser.id));
  expect(backfilled.trialGrantedAt).toEqual(startedAt);
  const earlierGrant = new Date("2024-01-01T00:00:00Z");
  await mockDatabase.update(schema.user).set({ trialGrantedAt: earlierGrant }).where(eq(schema.user.id, mockUser.id));
  await client.unsafe(migration);
  const [preserved] = await mockDatabase.select().from(schema.user).where(eq(schema.user.id, mockUser.id));
  expect(preserved.trialGrantedAt).toEqual(earlierGrant);
});
