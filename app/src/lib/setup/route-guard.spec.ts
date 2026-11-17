/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";

const requireAuth = jest.fn();
const resolveProjectPermissionContext = jest.fn();
const checkPermissionWithContext = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  resolveProjectPermissionContext: (...a: unknown[]) => resolveProjectPermissionContext(...a),
  checkPermissionWithContext: (...a: unknown[]) => checkPermissionWithContext(...a),
}));
jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: async () => Response.json({ error: "Insufficient permissions" }, { status: 403 }),
}));

import { guardProject } from "./route-guard";

const PROJECT = "00000000-0000-7000-8000-000000000001";
const allow = async () => ({ allowed: true, remaining: 1 });
const call = (method: string, headers: Record<string, string> = {}) =>
  guardProject(new NextRequest(`http://localhost/api/projects/${PROJECT}/setup`, { method, headers }), PROJECT, { resource: "monitor", action: "view" }, allow);

beforeEach(() => {
  jest.clearAllMocks();
  requireAuth.mockResolvedValue({ userId: "u1" });
  resolveProjectPermissionContext.mockResolvedValue({ organizationId: "o1" });
  checkPermissionWithContext.mockReturnValue(true);
});

describe("guardProject", () => {
  it("answers 401 to a signed-out caller even from another origin", async () => {
    requireAuth.mockRejectedValue(new Error("no session"));
    const res = (await call("POST", { origin: "https://evil.example" })) as NextResponse;
    expect(res.status).toBe(401);
  });

  it("refuses a cross-origin write from a signed-in session before resolving the project", async () => {
    const res = (await call("POST", { origin: "https://evil.example" })) as NextResponse;
    expect(res.status).toBe(403);
    expect(resolveProjectPermissionContext).not.toHaveBeenCalled();
  });

  it("does not check the origin of a GET", async () => {
    expect(await call("GET", { origin: "https://evil.example" })).toEqual({ userId: "u1", ctx: { organizationId: "o1" } });
  });

  it("lets a same-origin write through and refuses any bearer token", async () => {
    expect(await call("POST", { origin: "http://localhost" })).toEqual({ userId: "u1", ctx: { organizationId: "o1" } });
    expect(((await call("POST", { authorization: "Bearer sck_live_x" })) as NextResponse).status).toBe(401);
  });
});
