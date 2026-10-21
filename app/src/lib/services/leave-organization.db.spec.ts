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
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn() }));
jest.mock("@/lib/session-cache", () => ({ clearRequestCache: jest.fn() }));
jest.mock("next/headers", () => ({ headers: async () => new Headers() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
// Audit persistence is intentionally real; a database failure must abort the leave transaction.
import { leaveOrganization } from "./leave-organization";
import { requireUserAuthContext } from "@/lib/auth-context";
import { clearRequestCache } from "@/lib/session-cache";
import { logAuditEvent } from "@/lib/audit-logger";
const name = `leave_org_${randomUUID().replaceAll("-", "")}`;
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
  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Team", createdAt: new Date() }).returning();
  const [other] = await mockDatabase.insert(schema.organization).values({ name: "Personal", createdAt: new Date() }).returning();
  organizationId = org.id; otherOrganizationId = other.id;
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId, name: "Project" }).returning(); projectId = project.id;
  const [user] = await mockDatabase.insert(schema.user).values({ name: "Member", email: `${randomUUID()}@example.com` }).returning(); userId = user.id;
  await mockDatabase.insert(schema.member).values([
    { userId, organizationId, role: "project_editor", createdAt: new Date() },
    { userId, organizationId: otherOrganizationId, role: "org_owner", createdAt: new Date() },
  ]);
  await mockDatabase.insert(schema.projectMembers).values({ userId, projectId, role: "project_editor" });
  await mockDatabase.insert(schema.session).values([
    { userId, createdAt: new Date(), updatedAt: new Date(), token: "active", expiresAt: new Date(Date.now() + 60000), activeOrganizationId: organizationId, activeProjectId: projectId },
    { userId, createdAt: new Date(), updatedAt: new Date(), token: "legacy", expiresAt: new Date(Date.now() + 60000), activeProjectId: projectId },
    { userId, createdAt: new Date(), updatedAt: new Date(), token: "other", expiresAt: new Date(Date.now() + 60000), activeOrganizationId: otherOrganizationId },
  ]);
  jest.mocked(requireUserAuthContext).mockResolvedValue({ userId, organizationId, projectId: null, isCliAuth: false });
});
it("commits the real audit row and clears all affected sessions while preserving other memberships", async () => {
  await leaveOrganization(organizationId);
  expect(await mockDatabase.select().from(schema.projectMembers)).toHaveLength(0);
  expect(await mockDatabase.select().from(schema.member)).toMatchObject([{ organizationId: otherOrganizationId }]);
  const sessions = await mockDatabase.select().from(schema.session);
  expect(sessions.filter(s => s.token !== "other")).toEqual(expect.arrayContaining([
    expect.objectContaining({ token: "active", activeOrganizationId: null, activeProjectId: null }),
    expect.objectContaining({ token: "legacy", activeOrganizationId: null, activeProjectId: null }),
  ]));
  expect(sessions.find(s => s.token === "other")?.activeOrganizationId).toBe(otherOrganizationId);
  expect(await mockDatabase.select().from(schema.auditLogs)).toEqual(expect.arrayContaining([expect.objectContaining({ action: "member_left", userId, organizationId })]));
});
it("rolls back membership, assignments and session context when the real audit insert fails", async () => {
  await client.unsafe(`CREATE FUNCTION reject_leave_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$`);
  await client.unsafe(`CREATE TRIGGER reject_leave_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_leave_audit()`);
  try {
    await expect(leaveOrganization(organizationId)).rejects.toThrow();
    expect(await mockDatabase.select().from(schema.member).where(eq(schema.member.organizationId, organizationId))).toHaveLength(1);
    expect(await mockDatabase.select().from(schema.projectMembers)).toHaveLength(1);
    expect((await mockDatabase.select().from(schema.session).where(eq(schema.session.token, "active")))[0].activeOrganizationId).toBe(organizationId);
    expect(clearRequestCache).not.toHaveBeenCalled();
    // Existing callers still use best-effort audit behavior by default.
    await expect(logAuditEvent({ userId, organizationId, action: "test", resource: "member", success: true })).resolves.toBeUndefined();
  } finally {
    await client.unsafe(`DROP TRIGGER reject_leave_audit ON audit_logs`);
    await client.unsafe(`DROP FUNCTION reject_leave_audit()`);
  }
});
