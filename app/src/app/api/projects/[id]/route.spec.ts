/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
import { DELETE, GET, PUT } from "./route";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@/utils/db";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext } from "@/lib/auth-context";
import { logAuditEvent } from "@/lib/audit-logger";

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
