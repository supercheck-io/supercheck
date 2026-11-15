/** @jest-environment node */

import { NextRequest } from "next/server";

const requireAuthContext = jest.fn();
jest.mock("@/lib/auth-context", () => {
  class AuthError extends Error {
    constructor(message: string, readonly status: 401 | 403 = 401) {
      super(message);
    }
  }
  return {
    AuthError,
    requireAuthContext: (...a: unknown[]) => requireAuthContext(...a),
    isAuthError: (e: unknown) => e instanceof AuthError,
    authErrorStatus: (e: { status: number }) => e.status,
  };
});
jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: async (_org: string, error: string) => Response.json({ error }, { status: 403 }),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/resource-deletion/linked-records", () => ({ removeServiceResourceLinks: jest.fn() }));
const findFirst = jest.fn();
const set = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    query: { tests: { findFirst: (...a: unknown[]) => findFirst(...a) } },
    update: () => ({ set: (v: unknown) => (set(v), { where: () => ({ returning: async () => [{ id: ID, ...(v as object) }] }) }) }),
  },
}));

import { PUT } from "./route";
import { AuthError } from "@/lib/auth-context";

const ID = "00000000-0000-4000-8000-000000000001";
const stored = { id: ID, title: "Bot", description: null, script: "", priority: "medium", type: "browser" };
const ctx = (role: string, extra: Record<string, unknown> = {}) => ({
  userId: "u1",
  organizationId: "org-1",
  orgPendingDeletion: false,
  isCliAuth: true, // CLI callers send no Origin header
  project: { id: "p1", name: "P", userRole: role },
  ...extra,
});
const put = () =>
  PUT(new NextRequest(`http://localhost/api/tests/${ID}`, { method: "PUT", body: JSON.stringify({ type: "agent" }), headers: { "content-type": "application/json" } }), {
    params: Promise.resolve({ id: ID }),
  });

beforeEach(() => {
  findFirst.mockReset().mockResolvedValue(stored);
  set.mockClear();
});

describe("PUT /api/tests/[id] with type agent", () => {
  it("stores the agent type for an editor", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    expect((await put()).status).toBe(200);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ type: "agent" }));
  });

  it.each([
    ["viewer", ctx("project_viewer")],
    ["viewer CLI token", ctx("project_viewer", { isCliAuth: true })],
    ["org pending deletion", ctx("project_editor", { orgPendingDeletion: true })],
  ])("denies %s without reading or writing", async (_name, context) => {
    requireAuthContext.mockResolvedValue(context);
    expect((await put()).status).toBe(403);
    expect(findFirst).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("answers 404 for a test outside the caller's organization or project (the lookup is scoped to both)", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    findFirst.mockResolvedValue(undefined);
    expect((await put()).status).toBe(404);
    expect(set).not.toHaveBeenCalled();
  });

  it("answers 401 when unauthenticated", async () => {
    requireAuthContext.mockRejectedValue(new AuthError("Authentication required"));
    expect((await put()).status).toBe(401);
  });
});
