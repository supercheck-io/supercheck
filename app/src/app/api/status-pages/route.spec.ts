/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: {} }));
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
const createStatusPageService = jest.fn();
jest.mock("@/lib/status-pages/service", () => {
  const actual = jest.requireActual("@/lib/status-pages/service");
  return { ...actual, createStatusPage: (...a: unknown[]) => createStatusPageService(...a) };
});

import { NextRequest } from "next/server";
import { POST } from "./route";

const authCtx = { userId: "u1", organizationId: "o1", project: { id: "p1", name: "P" } };
const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/status-pages", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/status-pages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthContext.mockResolvedValue(authCtx);
    checkPermissionWithContext.mockReturnValue(true);
  });

  it("401 when unauthenticated", async () => {
    requireAuthContext.mockRejectedValue(new FakeAuthError("Authentication required"));
    expect((await post({ name: "A" })).status).toBe(401);
  });

  it("403 for a viewer", async () => {
    checkPermissionWithContext.mockReturnValue(false);
    expect((await post({ name: "A" })).status).toBe(403);
    expect(checkPermissionWithContext).toHaveBeenCalledWith("status_page", "create", authCtx);
    expect(createStatusPageService).not.toHaveBeenCalled();
  });

  it("400 for an invalid body", async () => {
    expect((await post({ name: "" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  it.each([["subdomain"], ["customDomainVerified"]])("400 when %s is sent", async (key) => {
    const res = await post({ name: "A", [key]: key === "subdomain" ? "x" : true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(key);
    expect(createStatusPageService).not.toHaveBeenCalled();
  });

  it("403 with the plan-limit message", async () => {
    createStatusPageService.mockResolvedValue({ ok: false, code: "forbidden", message: "Limit reached" });
    const res = await post({ name: "A" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Limit reached" });
  });

  it("201 with the created page", async () => {
    createStatusPageService.mockResolvedValue({
      ok: true,
      data: { statusPage: { id: "s1", name: "A", subdomain: "abc", status: "draft", createdAt: new Date(0), updatedAt: new Date(0), faviconLogo: null, transactionalLogo: null, heroCover: null } },
    });
    const res = await post({ name: "A", headline: "H" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.statusPage).toMatchObject({ id: "s1", status: "draft", createdAt: new Date(0).toISOString() });
    expect(createStatusPageService).toHaveBeenCalledWith(
      { userId: "u1", organizationId: "o1", projectId: "p1", projectName: "P" },
      { name: "A", headline: "H" }
    );
  });
});
