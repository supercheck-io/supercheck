/** @jest-environment node */
import { NextRequest } from "next/server";
const mockStanding = { value: true };
jest.mock("@/lib/rbac/middleware", () => ({
  hasPermissionForUser: jest.fn(),
  // Stands in for the real helper: 403 for an org member, 404 for a caller with no standing in the org.
  forbiddenOrNotFound: jest.fn(async (_u: string, _o: string, forbidden: string, notFound: string) => {
    const { NextResponse } = jest.requireActual("next/server");
    return mockStanding.value ? NextResponse.json({ error: forbidden }, { status: 403 }) : NextResponse.json({ error: notFound }, { status: 404 });
  }),
}));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/job-scheduler", () => ({ deleteScheduledJob: jest.fn().mockResolvedValue(true) }));
jest.mock("@/utils/db", () => {
  const db = { select: jest.fn(), update: jest.fn(), transaction: jest.fn() };
  db.transaction.mockImplementation((cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});
jest.mock("@/lib/execution/trial-lifecycle", () => ({ unscheduleMonitors: jest.fn() }));
import { DELETE, GET, PUT } from "./route";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@/utils/db";
import { deleteScheduledJob } from "@/lib/job-scheduler";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext } from "@/lib/auth-context";
import { logAuditEvent } from "@/lib/audit-logger";
import { unscheduleMonitors } from "@/lib/execution/trial-lifecycle";

const ID = "93ce4a2e-7846-5b60-b753-1ab3563f0fce";
const set = jest.fn();
const put = (body: unknown) =>
  PUT(
    new NextRequest(`http://localhost/api/projects/${ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: ID }) },
  );
const project = (status = "active") => ({
  from: () => ({ where: () => ({ limit: async () => [{ organizationId: "org-1", status }] }) }),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStanding.value = true;
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u1" });
  (hasPermissionForUser as jest.Mock).mockResolvedValue(true);
  (db.select as jest.Mock).mockReturnValue(project());
  set.mockReturnValue({ where: () => ({ returning: async () => [{ id: ID }] }) });
  (db.update as jest.Mock).mockReturnValue({ set });
});

describe("PUT /api/projects/[id]", () => {
  it("never writes status, even when the body supplies one", async () => {
    expect((await put({ name: "x", status: "deleted" })).status).toBe(200);
    expect(set.mock.calls[0][0]).not.toHaveProperty("status");
  });

  it("updates only the fields present", async () => {
    await put({ name: "renamed" });
    const written = set.mock.calls[0][0];
    expect(written.name).toBe("renamed");
    expect(written).not.toHaveProperty("slug");
    expect(written).not.toHaveProperty("description");
  });

  it("rejects invalid bodies", async () => {
    expect((await put({ name: "x".repeat(300) })).status).toBe(400);
    expect((await put({ name: 5 })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses to modify a deleted project", async () => {
    (db.select as jest.Mock).mockReturnValue(project("deleted"));
    expect((await put({ name: "x" })).status).toBe(404);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("denies callers without project:update", async () => {
    (hasPermissionForUser as jest.Mock).mockResolvedValue(false);
    expect((await put({ name: "x" })).status).toBe(403);
  });

  it("answers 404, not 403, for a project in an organization the caller is not in", async () => {
    (hasPermissionForUser as jest.Mock).mockResolvedValue(false);
    mockStanding.value = false;
    expect((await put({ name: "x" })).status).toBe(404);
  });
});

describe("cross-tenant GET and DELETE", () => {
  it.each([["GET", GET], ["DELETE", DELETE]] as const)("%s answers 404 without standing and 403 for a member", async (_n, handler) => {
    (hasPermissionForUser as jest.Mock).mockResolvedValue(false);
    (db.select as jest.Mock).mockReturnValue(project());
    const call = () => handler(new NextRequest(`http://localhost/api/projects/${ID}`), { params: Promise.resolve({ id: ID }) });
    expect((await call()).status).toBe(403);
    mockStanding.value = false;
    expect((await call()).status).toBe(404);
  });
});

describe("deleted projects", () => {
  it.each([["GET", GET], ["DELETE", DELETE]] as const)("%s filters deleted projects out of the lookup", async (_n, handler) => {
    let whereSql = "";
    (db.select as jest.Mock).mockReturnValue({
      from: () => ({ where: (w: never) => { whereSql = new PgDialect().sqlToQuery(w).sql; return { limit: async () => [] }; } }),
    });
    const res = await handler(new NextRequest(`http://localhost/api/projects/${ID}`), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(404);
    expect(whereSql).toContain('"status"');
  });
});

describe("CLI tokens", () => {
  it.each([["PUT", () => put({ name: "x" })], ["DELETE", () => DELETE(new NextRequest(`http://localhost/api/projects/${ID}`, { method: "DELETE" }), { params: Promise.resolve({ id: ID }) })]] as const)(
    "%s is refused for project-scoped CLI auth",
    async (_m, call) => {
      (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u1", isCliAuth: true });
      expect((await call()).status).toBe(403);
      expect(db.update).not.toHaveBeenCalled();
    },
  );
});

describe("audit, conflicts and ordering", () => {
  const del = () => DELETE(new NextRequest(`http://localhost/api/projects/${ID}`, { method: "DELETE" }), { params: Promise.resolve({ id: ID }) });
  const row = (isDefault: boolean) => ({
    from: () => ({ where: () => ({ limit: async () => [{ organizationId: "org-1", isDefault, name: "P", slug: "p", description: null }] }) }),
  });

  it("audits project updates", async () => {
    set.mockReturnValue({ where: () => ({ returning: async () => [{ id: ID, name: "n", slug: "s", description: null }] }) });
    await put({ name: "n" });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "project_updated", resourceId: ID, organizationId: "org-1" }));
  });

  it("maps a duplicate slug to 409", async () => {
    set.mockReturnValue({ where: () => ({ returning: async () => { throw Object.assign(new Error("dup"), { cause: { code: "23505" } }); } }) });
    expect((await put({ slug: "taken" })).status).toBe(409);
  });

  it("audits project deletion", async () => {
    (db.select as jest.Mock).mockReturnValue(row(false));
    set.mockReturnValue({ where: () => ({ returning: async () => [{ name: "n", slug: "s", description: null }] }) });
    expect((await del()).status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "project_deleted", resourceId: ID, organizationId: "org-1", metadata: expect.objectContaining({ projectName: "n", projectSlug: "s" }) }));
  });

  it("does not audit a deletion that lost the race to another delete", async () => {
    (db.select as jest.Mock).mockReturnValue(row(false));
    set.mockReturnValue({ where: () => ({ returning: async () => [] }) });
    expect((await del()).status).toBe(404);
    expect(logAuditEvent).not.toHaveBeenCalledWith(expect.objectContaining({ action: "project_deleted" }));
  });

  it("checks delete permission before revealing the default project", async () => {
    (db.select as jest.Mock).mockReturnValue(row(true));
    (hasPermissionForUser as jest.Mock).mockResolvedValue(false);
    expect((await del()).status).toBe(403);
    (hasPermissionForUser as jest.Mock).mockResolvedValue(true);
    expect((await del()).status).toBe(400);
  });
});

describe("DELETE schedules", () => {
  it("removes repeatables for the project's scheduled jobs after soft-deleting", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ organizationId: "org-1", isDefault: false }] }) }) })
      .mockReturnValueOnce({ from: () => ({ where: async () => [{ id: "job-1" }, { id: "job-2" }] }) });
    set.mockReturnValue({ where: () => ({ returning: async () => [{ name: "n", slug: "s", description: null }] }) });
    const res = await DELETE(new NextRequest(`http://localhost/api/projects/${ID}`, { method: "DELETE" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(deleteScheduledJob).toHaveBeenCalledWith("job-1");
    expect(deleteScheduledJob).toHaveBeenCalledWith("job-2");
  });

  it("audits the deletion even when scheduler cleanup never settles", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ organizationId: "org-1", isDefault: false }] }) }) })
      .mockReturnValueOnce({ from: () => ({ where: async () => [{ id: "job-1" }] }) });
    set.mockReturnValue({ where: () => ({ returning: async () => [{ name: "n", slug: "s", description: null }] }) });
    (deleteScheduledJob as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
    (logAuditEvent as jest.Mock).mockClear();
    void DELETE(new NextRequest(`http://localhost/api/projects/${ID}`, { method: "DELETE" }), { params: Promise.resolve({ id: ID }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "project_deleted" }));
  });

  it("pauses the project's monitors in the delete transaction and unschedules them", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ organizationId: "org-1", isDefault: false }] }) }) })
      .mockReturnValueOnce({ from: () => ({ where: async () => [] }) });
    set
      .mockReturnValueOnce({ where: () => ({ returning: async () => [{ name: "n", slug: "s", description: null }] }) })
      .mockReturnValueOnce({ where: () => ({ returning: async () => [{ id: "m1", scheduledJobId: "s1" }] }) });
    const res = await DELETE(new NextRequest(`http://localhost/api/projects/${ID}`, { method: "DELETE" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(db.transaction).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "paused" }));
    expect(unscheduleMonitors).toHaveBeenCalledWith([{ id: "m1", scheduledJobId: "s1" }], db);
  });
});
