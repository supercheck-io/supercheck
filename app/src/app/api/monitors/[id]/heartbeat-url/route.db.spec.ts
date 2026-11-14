/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

process.env.SECRET_ENCRYPTION_KEY ??= "test-secret-encryption-key-0123456789abcdef";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
type Ctx = { userId: string; organizationId: string; orgPendingDeletion: boolean; isCliAuth: boolean; project: { id: string; userRole: string } };
let mockContext: Ctx;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => mockContext),
  requireUserAuthContext: jest.fn(async () => ({ userId: mockContext.userId })),
  isAuthError: jest.fn(() => false),
  authErrorStatus: jest.fn(() => 401),
}));
// The real permission matrix decides (same call checkPermissionWithContext makes); the session-bound
// impersonation lookup is stubbed because the full middleware module boots Better Auth.
jest.mock("@/lib/rbac/middleware", () => {
  const { hasPermission } = jest.requireActual("@/lib/rbac/permissions");
  const { normalizeRole } = jest.requireActual("@/lib/rbac/role-normalizer");
  return {
    checkPermissionWithContext: (resource: string, action: string, c: Ctx) =>
      hasPermission({ userId: c.userId, role: normalizeRole(c.project.userRole), organizationId: c.organizationId, projectId: c.project.id, assignedProjectIds: [c.project.id], orgPendingDeletion: c.orgPendingDeletion }, resource, action),
    isImpersonatedSession: jest.fn(async () => false),
  };
});
const mockRateLimit = jest.fn();
jest.mock("@/lib/session-security", () => ({ checkMonitorApiRateLimit: (...args: unknown[]) => mockRateLimit(...args) }));
const mockAudit = jest.fn();
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...args: unknown[]) => mockAudit(...args) }));

import { GET } from "./route";
import { POST } from "./rotate/route";
import { createHeartbeatTokenColumns, hashHeartbeatToken } from "@/lib/heartbeat/token";
import { recordHeartbeatPing } from "@/lib/heartbeat/ping";

const execFileAsync = promisify(execFile);
const dbName = `heartbeat_url_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let orgId: string;
let projectId: string;
let otherProjectId: string;
let otherOrgId: string;
let otherOrgProjectId: string;
let monitorId: string;
let httpMonitorId: string;
let originalToken: string;
let userId: string;

const ctx = (role: string, overrides: Partial<Ctx> = {}): Ctx => ({
  userId, organizationId: orgId, orgPendingDeletion: false, isCliAuth: false, project: { id: projectId, userRole: role }, ...overrides,
});
const reveal = (id = monitorId) => GET(new NextRequest(`https://app.test/api/monitors/${id}/heartbeat-url`), { params: Promise.resolve({ id }) });
const rotate = (id = monitorId) => POST(new NextRequest(`https://app.test/api/monitors/${id}/heartbeat-url/rotate`, { method: "POST" }), { params: Promise.resolve({ id }) });
const tokenOf = async (res: Response) => ((await res.json()) as { pingUrl: string }).pingUrl.split("/").pop()!;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${dbName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${dbName}`;
  const appRoot = path.resolve(__dirname, "../../../../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 10, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });

  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [other] = await mockDatabase.insert(schema.organization).values({ name: "Other", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "P" }).returning();
  const [sibling] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "P2" }).returning();
  const [foreign] = await mockDatabase.insert(schema.projects).values({ organizationId: other.id, name: "F" }).returning();
  const [user] = await mockDatabase.insert(schema.user).values({ name: "U", email: `${randomUUID()}@example.test` }).returning();
  await mockDatabase.insert(schema.member).values({ organizationId: org.id, userId: user.id, role: "org_admin", createdAt: new Date() });
  [orgId, projectId, otherProjectId, otherOrgId, otherOrgProjectId, userId] = [org.id, project.id, sibling.id, other.id, foreign.id, user.id];

  const columns = createHeartbeatTokenColumns(projectId);
  originalToken = columns.token;
  const [monitor] = await mockDatabase.insert(schema.monitors).values({
    organizationId: orgId, projectId, name: "Nightly", type: "heartbeat", target: "", frequencyMinutes: 60, status: "pending",
    heartbeatTokenHash: columns.heartbeatTokenHash, heartbeatTokenEncrypted: columns.heartbeatTokenEncrypted,
  }).returning();
  monitorId = monitor.id;
  const [http] = await mockDatabase.insert(schema.monitors).values({
    organizationId: orgId, projectId, name: "Site", type: "http_request", target: "https://example.com",
  }).returning();
  httpMonitorId = http.id;
});

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

beforeEach(() => {
  mockAudit.mockReset();
  mockRateLimit.mockReset().mockResolvedValue({ allowed: true });
});

it.each(["org_owner", "org_admin", "project_admin", "project_editor"])("%s may reveal the stored ping URL", async (role) => {
  mockContext = ctx(role);
  const res = await reveal();
  expect(res.status).toBe(200);
  const token = await tokenOf(res);
  const [row] = await mockDatabase.select({ hash: schema.monitors.heartbeatTokenHash }).from(schema.monitors).where(eq(schema.monitors.id, monitorId));
  expect(hashHeartbeatToken(token)).toBe(row.hash);
  expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "monitor_heartbeat_url_revealed", resourceId: monitorId }));
});

it("denies a project viewer for reveal and rotate", async () => {
  mockContext = ctx("project_viewer");
  expect((await reveal()).status).toBe(403);
  expect((await rotate()).status).toBe(403);
  expect(mockAudit).not.toHaveBeenCalled();
});

it("answers 404 across projects, across organizations and for a non-heartbeat monitor", async () => {
  mockContext = ctx("project_editor", { project: { id: otherProjectId, userRole: "project_editor" } });
  expect((await reveal()).status).toBe(404);
  expect((await rotate()).status).toBe(404);
  mockContext = ctx("org_owner", { organizationId: otherOrgId, project: { id: otherOrgProjectId, userRole: "org_owner" } });
  expect((await reveal()).status).toBe(404);
  expect((await rotate()).status).toBe(404);
  mockContext = ctx("project_editor");
  expect((await reveal(httpMonitorId)).status).toBe(404);
  const [row] = await mockDatabase.select({ hash: schema.monitors.heartbeatTokenHash }).from(schema.monitors).where(eq(schema.monitors.id, monitorId));
  expect(row.hash).toBe(hashHeartbeatToken(originalToken));
});

it("answers 429 over the per-user limit", async () => {
  mockContext = ctx("project_editor");
  mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
  expect((await rotate()).status).toBe(429);
});

it("rotate replaces the token: the old URL stops recording pings and the new one works", async () => {
  mockContext = ctx("project_editor");
  expect(await recordHeartbeatPing(hashHeartbeatToken(originalToken), "ping", null)).toBe(true);
  const res = await rotate();
  expect(res.status).toBe(200);
  const fresh = await tokenOf(res);
  expect(fresh).not.toBe(originalToken);
  expect(await recordHeartbeatPing(hashHeartbeatToken(originalToken), "ping", null)).toBe(false);
  expect(await recordHeartbeatPing(hashHeartbeatToken(fresh), "ping", null)).toBe(true);
  // Rotation never touches runtime state: both recorded pings are still counted.
  const [row] = await mockDatabase.select({ state: schema.monitors.heartbeatState }).from(schema.monitors).where(eq(schema.monitors.id, monitorId));
  expect(row.state?.pingSeq).toBe(2);
  expect(await tokenOf(await reveal())).toBe(fresh);
  expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "monitor_heartbeat_url_rotated", resourceId: monitorId }));
  expect(JSON.stringify(mockAudit.mock.calls)).not.toContain(fresh);
});

it("refuses a member of an organization pending deletion with the pending code", async () => {
  // Its own organization: the pending flag is cached per organization for a short time.
  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Leaving", createdAt: new Date(), deletionRequestedAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "L" }).returning();
  await mockDatabase.insert(schema.member).values({ organizationId: org.id, userId, role: "org_admin", createdAt: new Date() });
  const [monitor] = await mockDatabase.insert(schema.monitors).values({
    organizationId: org.id, projectId: project.id, name: "Old", type: "heartbeat", target: "", ...createHeartbeatTokenColumns(project.id),
  }).returning();
  mockContext = ctx("org_admin", { organizationId: org.id, orgPendingDeletion: true, project: { id: project.id, userRole: "org_admin" } });
  for (const res of [await reveal(monitor.id), await rotate(monitor.id)]) {
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ORG_PENDING_DELETION" });
  }
});
