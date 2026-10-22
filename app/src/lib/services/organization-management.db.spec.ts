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
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/utils/auth", () => ({ auth: { api: {} } }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserRole: jest.fn(), getUserOrgRole: jest.fn() }));
jest.mock("@/lib/session", () => ({ ...jest.requireActual("@/lib/session"), getCurrentUser: jest.fn() }));
jest.mock("@/lib/session-cache", () => ({ getCachedAuthSession: jest.fn() }));
jest.mock("next/headers", () => ({ headers: async () => new Headers() }));
import { switchOrganization } from "./organization-management";
import { getCurrentUser, getSelectableOrganizations } from "@/lib/session";
import { getCachedAuthSession } from "@/lib/session-cache";
const name = `select_org_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let userId: string;
let organizationId: string;
let otherOrganizationId: string;
let projectId: string;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required for disposable database");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL); target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await promisify(execFile)(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot, env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" }, timeout: 90000,
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
  await client`TRUNCATE organization, "user" CASCADE`;
  const [home] = await mockDatabase.insert(schema.organization).values({ name: "Home", createdAt: new Date(0) }).returning();
  const [team] = await mockDatabase.insert(schema.organization).values({ name: "Empty team", createdAt: new Date() }).returning();
  organizationId = home.id; otherOrganizationId = team.id;
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId, name: "Project" }).returning(); projectId = project.id;
  const [user] = await mockDatabase.insert(schema.user).values({ name: "Member", email: `${randomUUID()}@example.com` }).returning(); userId = user.id;
  await mockDatabase.insert(schema.member).values([
    { userId, organizationId, role: "org_owner", createdAt: new Date() },
    { userId, organizationId: otherOrganizationId, role: "project_viewer", createdAt: new Date() },
  ]);
  await mockDatabase.insert(schema.session).values(["active", "other"].map(token => ({
    userId, createdAt: new Date(), updatedAt: new Date(), token,
    expiresAt: new Date(Date.now() + 60000), activeOrganizationId: organizationId, activeProjectId: projectId,
  })));
  jest.mocked(getCurrentUser).mockResolvedValue({ id: userId } as Awaited<ReturnType<typeof getCurrentUser>>);
  jest.mocked(getCachedAuthSession).mockResolvedValue({ session: { token: "active" } } as Awaited<ReturnType<typeof getCachedAuthSession>>);
});
it("selects a real empty membership and clears only the requesting session's project", async () => {
  expect((await getSelectableOrganizations(userId)).map(org => org.id)).toContain(otherOrganizationId);
  await switchOrganization(otherOrganizationId);
  const rows = await mockDatabase.select().from(schema.session);
  expect(rows.find(row => row.token === "active")).toMatchObject({ activeOrganizationId: otherOrganizationId, activeProjectId: null });
  expect(rows.find(row => row.token === "other")).toMatchObject({ activeOrganizationId: organizationId, activeProjectId: projectId });
});
it("rejects foreign and extra legacy owned organizations without changing context", async () => {
  const [foreign] = await mockDatabase.insert(schema.organization).values({ name: "Foreign", createdAt: new Date() }).returning();
  await expect(switchOrganization(foreign.id)).rejects.toMatchObject({ status: 403 });
  await mockDatabase.update(schema.member).set({ role: "org_owner" }).where(eq(schema.member.organizationId, otherOrganizationId));
  await expect(switchOrganization(otherOrganizationId)).rejects.toMatchObject({ status: 403 });
  expect((await mockDatabase.select().from(schema.session).where(eq(schema.session.token, "active")))[0]).toMatchObject({ activeOrganizationId: organizationId, activeProjectId: projectId });
});
it("rejects a removed session and a revoked membership", async () => {
  await mockDatabase.delete(schema.member).where(eq(schema.member.organizationId, otherOrganizationId));
  await expect(switchOrganization(otherOrganizationId)).rejects.toMatchObject({ status: 403 });
  await mockDatabase.delete(schema.session).where(eq(schema.session.token, "active"));
  await expect(switchOrganization(organizationId)).rejects.toMatchObject({ status: 401 });
});
