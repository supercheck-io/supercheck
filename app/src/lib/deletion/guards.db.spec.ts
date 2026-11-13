/** @jest-environment node */
// Needs TEST_DATABASE_URL (npm run test:db). Real migrations, real Postgres.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
let mockSessionToken = "";
let mockSessionUserId = "u";
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/utils/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers()) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn(), logAdminEvent: jest.fn() }));
jest.mock("@/lib/session-cache", () => ({ getCachedAuthSession: jest.fn(async () => ({ session: { token: mockSessionToken }, user: { id: mockSessionUserId } })) }));
import { getUnifiedAuthContext } from "@/lib/rbac/unified-auth";
import { resolveProjectPermissionContext, checkPermissionWithContext, hasPermissionForUser, requirePermissions, forbiddenOrNotFound } from "@/lib/rbac/middleware";
import { clearDeletionStateCache, isOrgPendingDeletion, isProjectDeleted, invalidateOrgState, isProjectOrgPending, organizationGraceDays } from "./org-state";
import { notInPendingOrganization } from "./visibility";
import { isFreshSession, reauthMaxAgeSeconds } from "./reauth";

const name = `deletion_guards_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await promisify(execFile)(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot, env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" }, timeout: 90000,
  });
  client = postgres(target.toString(), { max: 4, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});
beforeEach(() => clearDeletionStateCache());

async function seed(role: "org_owner" | "project_viewer" = "org_owner") {
  const [user] = await mockDatabase.insert(schema.user).values({ name: "U", email: `${randomUUID()}@example.test` }).returning();
  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  await mockDatabase.insert(schema.member).values({ organizationId: org.id, userId: user.id, role, createdAt: new Date() });
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "P", isDefault: true }).returning();
  const token = `tok-${randomUUID()}`;
  await client`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at, active_project_id, active_organization_id)
    VALUES (uuidv7(), ${token}, ${user.id}, now() + interval '1 day', now(), now(), ${project.id}, ${org.id})`;
  return { userId: user.id, orgId: org.id, projectId: project.id, token };
}
const makePending = (orgId: string) => client`UPDATE organization SET deletion_requested_at = now(), deletion_purge_after = now() + interval '14 days' WHERE id = ${orgId}`;

describe("pending flag rides on the rows the auth paths already read", () => {
  it("unified auth reports the flag from its existing organization join", async () => {
    const seeded = await seed();
    expect((await getUnifiedAuthContext(seeded.token)).organizationPendingDeletion).toBe(false);
    await makePending(seeded.orgId);
    const context = await getUnifiedAuthContext(seeded.token);
    expect(context.isValid).toBe(true);
    expect(context.organizationPendingDeletion).toBe(true);
  });

  it("the project permission context carries the flag and then denies writes but allows reads (real roles)", async () => {
    const seeded = await seed();
    const open = await resolveProjectPermissionContext(seeded.userId, seeded.projectId);
    expect(open?.orgPendingDeletion).toBe(false);
    expect(checkPermissionWithContext("test", "run", open!)).toBe(true);
    await makePending(seeded.orgId);
    const pending = await resolveProjectPermissionContext(seeded.userId, seeded.projectId);
    expect(pending?.orgPendingDeletion).toBe(true);
    expect(checkPermissionWithContext("test", "run", pending!)).toBe(false);
    expect(checkPermissionWithContext("job", "trigger", pending!)).toBe(false);
    expect(checkPermissionWithContext("apiKey", "create", pending!)).toBe(false);
    expect(checkPermissionWithContext("invitation", "create", pending!)).toBe(false);
    expect(checkPermissionWithContext("test", "view", pending!)).toBe(true);
    expect(checkPermissionWithContext("run", "export", pending!)).toBe(true);
  });

  it("hasPermissionForUser (id-only paths) denies writes in a pending organization and allows reads", async () => {
    const seeded = await seed();
    await makePending(seeded.orgId);
    expect(await hasPermissionForUser(seeded.userId, "test", "create", { organizationId: seeded.orgId, projectId: seeded.projectId })).toBe(false);
    expect(await hasPermissionForUser(seeded.userId, "test", "view", { organizationId: seeded.orgId, projectId: seeded.projectId })).toBe(true);
  });

  it("another organization is unaffected (tenancy)", async () => {
    const pending = await seed();
    const other = await seed();
    await makePending(pending.orgId);
    expect((await resolveProjectPermissionContext(other.userId, other.projectId))?.orgPendingDeletion).toBe(false);
    expect(await hasPermissionForUser(other.userId, "test", "create", { organizationId: other.orgId, projectId: other.projectId })).toBe(true);
  });

  it("a soft-deleted project resolves to nothing (404 everywhere)", async () => {
    const seeded = await seed();
    await client`UPDATE projects SET status = 'deleted', deleted_at = now(), purge_after = now() + interval '7 days' WHERE id = ${seeded.projectId}`;
    expect(await resolveProjectPermissionContext(seeded.userId, seeded.projectId)).toBeNull();
    expect((await getUnifiedAuthContext(seeded.token)).projectId).toBeNull();
    expect(await isProjectDeleted(seeded.projectId, { fresh: true })).toBe(true);
  });
});

describe("id-based permission checks and soft-deleted projects", () => {
  it("deny writes but allow reads once the project is soft-deleted", async () => {
    const seeded = await seed();
    const ctx = { organizationId: seeded.orgId, projectId: seeded.projectId };
    mockSessionToken = seeded.token;
    expect(await hasPermissionForUser(seeded.userId, "job", "create", ctx)).toBe(true);
    await client`UPDATE projects SET status = 'deleted', deleted_at = now(), purge_after = now() + interval '7 days' WHERE id = ${seeded.projectId}`;
    clearDeletionStateCache();
    expect(await hasPermissionForUser(seeded.userId, "job", "create", ctx)).toBe(false);
    expect(await hasPermissionForUser(seeded.userId, "job", "view", ctx)).toBe(true);
  });
});

describe("denials say why in a pending organization", () => {
  it("requirePermissions throws the pending error for a member's write and keeps reads working", async () => {
    const seeded = await seed();
    mockSessionToken = seeded.token; mockSessionUserId = seeded.userId;
    const ctx = { organizationId: seeded.orgId, projectId: seeded.projectId };
    await expect(requirePermissions({ test: ["create"] }, ctx)).resolves.toBeDefined();
    await makePending(seeded.orgId);
    clearDeletionStateCache();
    await expect(requirePermissions({ test: ["create"] }, ctx)).rejects.toMatchObject({ code: "ORG_PENDING_DELETION" });
    await expect(requirePermissions({ test: ["view"] }, ctx)).resolves.toBeDefined();
  });

  it("requirePermissions does not reveal the state to a user outside the organization", async () => {
    const pending = await seed();
    const outsider = await seed();
    await makePending(pending.orgId);
    mockSessionToken = outsider.token; mockSessionUserId = outsider.userId;
    await expect(requirePermissions({ test: ["create"] }, { organizationId: pending.orgId, projectId: pending.projectId })).rejects.toThrow(/Access denied/);
  });

  it("forbiddenOrNotFound answers the pending code to a member and 404 to an outsider", async () => {
    const pending = await seed();
    const outsider = await seed();
    await makePending(pending.orgId);
    const member = await forbiddenOrNotFound(pending.userId, pending.orgId, "forbidden", "missing");
    expect(member.status).toBe(403);
    expect(await member.json()).toMatchObject({ code: "ORG_PENDING_DELETION" });
    expect((await forbiddenOrNotFound(outsider.userId, pending.orgId, "forbidden", "missing")).status).toBe(404);
  });
});

describe("scheduler predicate", () => {
  it("excludes jobs of pending organizations and keeps the rest", async () => {
    const pending = await seed();
    const normal = await seed();
    for (const s of [pending, normal]) await mockDatabase.insert(schema.jobs).values({ organizationId: s.orgId, projectId: s.projectId, name: "J", cronSchedule: "* * * * *" });
    await makePending(pending.orgId);
    const rows = await mockDatabase.select({ org: schema.jobs.organizationId }).from(schema.jobs).where(notInPendingOrganization(schema.jobs.organizationId));
    expect(rows.map((r) => r.org)).toContain(normal.orgId);
    expect(rows.map((r) => r.org)).not.toContain(pending.orgId);
  });
});

describe("id-only helper", () => {
  it("caches for deny checks, but a fresh read and local invalidation see changes at once", async () => {
    const seeded = await seed();
    expect(await isOrgPendingDeletion(seeded.orgId)).toBe(false);
    await makePending(seeded.orgId);
    expect(await isOrgPendingDeletion(seeded.orgId)).toBe(false); // cached: another pod's change is seen within the TTL
    expect(await isOrgPendingDeletion(seeded.orgId, { fresh: true })).toBe(true); // admission never trusts the cache
    expect(await isOrgPendingDeletion(seeded.orgId)).toBe(true); // the fresh read refreshed the entry
    await client`UPDATE organization SET deletion_requested_at = NULL, deletion_purge_after = NULL WHERE id = ${seeded.orgId}`;
    invalidateOrgState(seeded.orgId);
    expect(await isOrgPendingDeletion(seeded.orgId)).toBe(false);
    expect(await isProjectOrgPending(seeded.projectId)).toBe(false);
    await makePending(seeded.orgId);
    expect(await isProjectOrgPending(seeded.projectId)).toBe(true);
  });

  it("unknown or missing ids are not pending", async () => {
    expect(await isOrgPendingDeletion(null)).toBe(false);
    expect(await isOrgPendingDeletion(randomUUID())).toBe(false);
  });
});

describe("fresh sign-in", () => {
  it("accepts a session created within the window and refuses an older one (read from the database)", async () => {
    const seeded = await seed();
    mockSessionToken = seeded.token;
    expect(await isFreshSession()).toBe(true);
    await client`UPDATE session SET created_at = now() - interval '11 minutes' WHERE token = ${seeded.token}`;
    expect(await isFreshSession()).toBe(false);
    expect(await isFreshSession(60 * 60)).toBe(true);
    mockSessionToken = "missing-token";
    expect(await isFreshSession()).toBe(false);
  });

  it("window is configurable within bounds and defaults to ten minutes", () => {
    expect(reauthMaxAgeSeconds({} as NodeJS.ProcessEnv)).toBe(600);
    expect(reauthMaxAgeSeconds({ ORG_DELETION_REAUTH_MINUTES: "5" } as unknown as NodeJS.ProcessEnv)).toBe(300);
    expect(reauthMaxAgeSeconds({ ORG_DELETION_REAUTH_MINUTES: "0" } as unknown as NodeJS.ProcessEnv)).toBe(600);
    expect(reauthMaxAgeSeconds({ ORG_DELETION_REAUTH_MINUTES: "999" } as unknown as NodeJS.ProcessEnv)).toBe(600);
  });
});

describe("grace window", () => {
  const env = (value: string | undefined) => ({ ORG_DELETION_GRACE_DAYS: value }) as unknown as NodeJS.ProcessEnv;
  it("defaults to 14 days; zero only when self-hosted; invalid values fall back", () => {
    const previous = process.env.SELF_HOSTED;
    try {
      process.env.SELF_HOSTED = "false";
      expect(organizationGraceDays(env(undefined))).toBe(14);
      expect(organizationGraceDays(env("30"))).toBe(30);
      expect(organizationGraceDays(env("0"))).toBe(14);
      expect(organizationGraceDays(env("-3"))).toBe(14);
      expect(organizationGraceDays(env("abc"))).toBe(14);
      process.env.SELF_HOSTED = "true";
      expect(organizationGraceDays(env("0"))).toBe(0);
      expect(organizationGraceDays(env("7"))).toBe(7);
    } finally {
      process.env.SELF_HOSTED = previous;
    }
  });
});
