/** @jest-environment node */

const findFirst = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { statusPages: { findFirst: (...a: unknown[]) => findFirst(...a) } } } }));
const requireAuthContext = jest.fn();
class FakeAuthError extends Error {}
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: (...a: unknown[]) => requireAuthContext(...a),
  isAuthError: (e: unknown) => e instanceof FakeAuthError,
}));
const checkPermissionWithContext = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...a: unknown[]) => checkPermissionWithContext(...a),
}));
jest.mock("@/lib/status-page-domain", () => ({
  getStatusPageRuntimeConfig: () => ({ domain: "d", customDomainTarget: "t" }),
}));
jest.mock("@/lib/asset-proxy", () => ({ generateProxyUrl: (v: string | null) => v }));
jest.mock("@/lib/monitor-read-config", () => ({ monitorTargetForRead: (t: string) => t }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
const updateSettings = jest.fn();
const setPublished = jest.fn();
jest.mock("@/lib/status-pages/service", () => {
  const actual = jest.requireActual("@/lib/status-pages/service");
  return {
    ...actual,
    updateStatusPageSettings: (...a: unknown[]) => updateSettings(...a),
    setStatusPagePublished: (...a: unknown[]) => setPublished(...a),
  };
});

import { NextRequest } from "next/server";
import { PUT } from "./route";

const id = "00000000-0000-4000-8000-000000000001";
const authCtx = { userId: "u1", organizationId: "o1", project: { id: "p1", name: "P" } };
const put = (body: unknown, pageId = id) =>
  PUT(new NextRequest(`http://localhost/api/status-pages/${pageId}`, { method: "PUT", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: pageId }),
  });
const row = { id, name: "A", status: "draft", createdAt: new Date(0), updatedAt: new Date(0), faviconLogo: null, transactionalLogo: null, heroCover: null };

describe("PUT /api/status-pages/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthContext.mockResolvedValue(authCtx);
    checkPermissionWithContext.mockReturnValue(true);
    updateSettings.mockResolvedValue({ ok: true, data: null });
    setPublished.mockResolvedValue({ ok: true, data: { statusPage: row } });
    findFirst.mockResolvedValue(row);
  });

  it("401 when unauthenticated", async () => {
    requireAuthContext.mockRejectedValue(new FakeAuthError("Authentication required"));
    expect((await put({ name: "B" })).status).toBe(401);
  });

  it("403 for a viewer", async () => {
    checkPermissionWithContext.mockReturnValue(false);
    expect((await put({ name: "B" })).status).toBe(403);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("400 for an invalid id, invalid body, empty body, unknown key", async () => {
    expect((await put({ name: "B" }, "nope")).status).toBe(400);
    expect((await put({ cssFontColor: "red" })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await put({ bogus: 1 })).status).toBe(400);
    expect((await put({ status: "deleted" })).status).toBe(400);
  });

  it.each([["subdomain", "x"], ["customDomainVerified", true]])("400 when %s is sent", async (key, value) => {
    const res = await put({ name: "B", [key]: value });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(key);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("404 for a page in another project", async () => {
    updateSettings.mockResolvedValue({ ok: false, code: "not_found", message: "Status page not found or access denied" });
    expect((await put({ name: "B" })).status).toBe(404);
  });

  it("400 for a reserved custom domain, 409 for a duplicate, 403 when unavailable", async () => {
    updateSettings.mockResolvedValueOnce({ ok: false, code: "validation", message: "Custom domain cannot use x" });
    expect((await put({ customDomain: "a.status.example.test" })).status).toBe(400);
    updateSettings.mockResolvedValueOnce({ ok: false, code: "conflict", message: "in use" });
    expect((await put({ customDomain: "a.acme.com" })).status).toBe(409);
    updateSettings.mockResolvedValueOnce({ ok: false, code: "forbidden", message: "upgrade" });
    expect((await put({ customDomain: "a.acme.com" })).status).toBe(403);
  });

  it("applies settings then status and returns the page", async () => {
    const res = await put({ name: "B", status: "published" });
    expect(res.status).toBe(200);
    expect((await res.json()).statusPage).toMatchObject({ id });
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1" }), id, { name: "B" });
    expect(setPublished).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1" }), id, "published");
    expect(updateSettings.mock.invocationCallOrder[0]).toBeLessThan(setPublished.mock.invocationCallOrder[0]);
  });

  it("supports status-only archive without touching settings", async () => {
    const res = await put({ status: "archived" });
    expect(res.status).toBe(200);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(setPublished).toHaveBeenCalledWith(expect.anything(), id, "archived");
  });

  it("reports that settings were saved when the status change fails", async () => {
    setPublished.mockResolvedValue({ ok: false, code: "validation", message: "Add at least one public component before publishing." });
    const res = await put({ name: "B", status: "published" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Settings were saved");
  });
});
