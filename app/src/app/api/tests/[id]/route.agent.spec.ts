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

const assertAgentTestSwitchRunnable = jest.fn();
jest.mock("@/lib/monitor-write", () => ({ ...jest.requireActual("@/lib/monitor-write"), assertAgentTestSwitchRunnable: (...a: unknown[]) => assertAgentTestSwitchRunnable(...a) }));

import { DELETE, PUT } from "./route";
import { ExecutionQueueError } from "@/lib/execution-errors";
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
const put = (type: unknown = "agent") =>
  PUT(new NextRequest(`http://localhost/api/tests/${ID}`, { method: "PUT", body: JSON.stringify({ type }), headers: { "content-type": "application/json" } }), {
    params: Promise.resolve({ id: ID }),
  });

beforeEach(() => {
  findFirst.mockReset().mockResolvedValue(stored);
  set.mockClear();
  assertAgentTestSwitchRunnable.mockReset().mockResolvedValue(undefined);
});

describe("PUT /api/tests/[id] with type agent", () => {
  it("stores the agent type for an editor", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    expect((await put()).status).toBe(200);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ type: "agent" }));
  });

  it("stores \" Agent \" as agent, and refuses an invalid type with 400 without writing", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    expect((await put(" Agent ")).status).toBe(200);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ type: "agent" }));
    set.mockClear();
    expect((await put("agents")).status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it.each([null, ""])("keeps the stored type when type is %j", async (type) => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    findFirst.mockResolvedValue({ ...stored, type: "agent" });
    expect((await put(type)).status).toBe(200);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ type: "agent" }));
  });

  it("refuses the switch with 503 AGENT_WORKERS_PENDING while its monitors' workers are pending, writing nothing", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    assertAgentTestSwitchRunnable.mockRejectedValue(new ExecutionQueueError("agent_workers_pending", "pending"));
    const res = await put();
    expect(assertAgentTestSwitchRunnable).toHaveBeenCalledWith(ID, "org-1", "p1");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect((await res.json()).code).toBe("AGENT_WORKERS_PENDING");
    expect(set).not.toHaveBeenCalled();
  });

  it("does not gate a test that is already an agent test", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    findFirst.mockResolvedValue({ ...stored, type: "agent" });
    await put();
    expect(assertAgentTestSwitchRunnable).not.toHaveBeenCalled();
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

describe("DELETE origin check", () => {
  const del = (origin: string) =>
    DELETE(new NextRequest(`http://localhost/api/tests/${ID}`, { method: "DELETE", headers: { origin } }), { params: Promise.resolve({ id: ID }) });
  it("refuses a cross-origin cookie request before any permission or data check", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_admin", { isCliAuth: false }));
    const res = await del("https://evil.example");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Cross-origin/i);
  });
  it("lets a CLI token through the origin check to the permission check", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_viewer"));
    const res = await del("https://evil.example");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Insufficient permissions to delete tests");
  });
});

it("refuses an oversize PUT body with 413 before writing", async () => {
  const H = jest.requireActual("@/lib/security/request-hardening.spec-helpers") as typeof import("@/lib/security/request-hardening.spec-helpers");
  const { MAX_SCRIPT_BODY_BYTES } = jest.requireActual("@/lib/validations/common") as typeof import("@/lib/validations/common");
  requireAuthContext.mockResolvedValue(ctx("project_editor"));
  const res = await PUT(H.declaredOversizeRequest(`/api/tests/${ID}`, "PUT", MAX_SCRIPT_BODY_BYTES + 1), { params: Promise.resolve({ id: ID }) });
  expect(res.status).toBe(413);
  expect(set).not.toHaveBeenCalled();
});
