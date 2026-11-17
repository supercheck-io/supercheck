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
jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: { blockUntilSubscribed: jest.fn(), requireValidPolarCustomer: jest.fn() },
  SubscriptionAccessDeniedError: class extends Error {},
}));
jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: async (_org: string, error: string) => Response.json({ error }, { status: 403 }),
}));
const values = jest.fn();
jest.mock("@/utils/db", () => ({
  db: { insert: () => ({ values: (v: unknown) => (values(v), { returning: async () => [{ id: "t1", ...(v as object) }] }) }) },
}));

import { POST } from "./route";
import { AuthError } from "@/lib/auth-context";

const ctx = (role: string, extra: Record<string, unknown> = {}) => ({
  userId: "u1",
  organizationId: "org-1",
  orgPendingDeletion: false,
  isCliAuth: false,
  project: { id: "p1", name: "P", userRole: role },
  ...extra,
});
const post = (body: unknown = { title: "Bot", type: "agent" }) =>
  POST(new NextRequest("http://localhost/api/tests", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

beforeEach(() => values.mockClear());

describe("POST /api/tests with type agent", () => {
  it("stores the agent type for an editor, in the caller's organization and project", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    const res = await post();
    expect(res.status).toBe(201);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ type: "agent", projectId: "p1", organizationId: "org-1" }));
    expect((await res.json()).test.type).toBe("agent");
  });

  it.each([
    ["viewer", ctx("project_viewer")],
    ["viewer CLI token", ctx("project_viewer", { isCliAuth: true })],
    ["org pending deletion", ctx("project_editor", { orgPendingDeletion: true })],
  ])("denies %s without writing", async (_name, context) => {
    requireAuthContext.mockResolvedValue(context);
    expect((await post()).status).toBe(403);
    expect(values).not.toHaveBeenCalled();
  });

  it("answers 401 when unauthenticated", async () => {
    requireAuthContext.mockRejectedValue(new AuthError("Authentication required"));
    expect((await post()).status).toBe(401);
    expect(values).not.toHaveBeenCalled();
  });

  it.each(["Agent", " agent ", "AGENT"])("accepts the case and whitespace variant %j as agent", async (type) => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    const res = await post({ title: "Bot", type });
    expect(res.status).toBe(201);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ type: "agent" }));
  });

  it.each(["agents", "bogus", 7])("refuses the invalid type %j with 400 instead of storing a browser test", async (type) => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    const res = await post({ title: "Bot", type });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid test type");
    expect(values).not.toHaveBeenCalled();
  });

  it("still defaults an omitted type to browser", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    expect((await post({ title: "Bot" })).status).toBe(201);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ type: "browser" }));
  });
});
