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
  pendingDeletionResponse: () => Response.json({ code: "ORG_PENDING_DELETION" }, { status: 403 }),
  permissionDeniedResponse: async (_org: string, error: string) => Response.json({ error }, { status: 403 }),
}));
jest.mock("@/lib/execution/execution-policy", () => ({
  getExecutionPolicy: async () => ({ tier: "free" }),
  ExecutionWorkloadError: class extends Error {},
}));
jest.mock("@/lib/services/subscription-service", () => ({ SubscriptionAccessDeniedError: class extends Error {} }));
jest.mock("@/lib/services/polar-usage.service", () => ({ polarUsageService: { shouldBlockUsage: jest.fn() } }));
jest.mock("@/lib/execution-rate-limiter", () => ({ checkExecutionRateLimit: async () => ({ allowed: true }) }));
jest.mock("@/lib/location-registry", () => ({
  assertProjectSupportsBrowser: async () => undefined,
  LocationWorkloadUnavailableError: class extends Error {},
  resolveProjectK6Location: jest.fn(),
}));
jest.mock("@/lib/variable-resolver", () => ({ resolveProjectVariables: async () => ({ variables: {}, secrets: {}, files: [] }) }));
jest.mock("@/lib/test-script", () => ({ decodeStoredTestScript: (s: string) => s }));
jest.mock("@/lib/k6-validator", () => ({ validateK6Script: jest.fn() }));
const addTestToQueue = jest.fn();
jest.mock("@/lib/queue", () => ({ addTestToQueue: (...a: unknown[]) => addTestToQueue(...a), addK6TestToQueue: jest.fn() }));
const findFirst = jest.fn();
const insert = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    query: { tests: { findFirst: (...a: unknown[]) => findFirst(...a) } },
    insert: () => ({ values: (v: unknown) => (insert(v), { returning: async () => [{ id: "run-1" }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

import { POST } from "./route";
import { AuthError } from "@/lib/auth-context";
import { ExecutionQueueError } from "@/lib/execution-errors";

const ID = "00000000-0000-4000-8000-000000000001";
const agentTest = { id: ID, type: "agent", script: "code", projectId: "p1", organizationId: "org-1" };
const ctx = (role: string, extra: Record<string, unknown> = {}) => ({
  userId: "u1",
  organizationId: "org-1",
  orgPendingDeletion: false,
  isCliAuth: true, // CLI callers send no Origin header
  project: { id: "p1", name: "P", userRole: role },
  ...extra,
});
const post = () =>
  POST(new NextRequest(`http://localhost/api/tests/${ID}/execute`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), {
    params: Promise.resolve({ id: ID }),
  });

beforeEach(() => {
  findFirst.mockReset().mockResolvedValue(agentTest);
  addTestToQueue.mockReset().mockResolvedValue({ status: "queued", position: 1 });
  insert.mockClear();
});

describe("POST /api/tests/[id]/execute for an agent test", () => {
  it("queues the run with testType agent for an editor", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    const res = await post();
    expect(res.status).toBe(200);
    expect(addTestToQueue).toHaveBeenCalledWith(expect.objectContaining({ testId: ID, testType: "agent" }));
  });

  it("leaves testType off for a browser test", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    findFirst.mockResolvedValue({ ...agentTest, type: "browser" });
    await post();
    expect(addTestToQueue.mock.calls[0][0]).not.toHaveProperty("testType");
  });

  it("answers a retryable 503 with the worker message while agent workers are not running", async () => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    addTestToQueue.mockRejectedValue(new ExecutionQueueError("agent_workers_pending", "Agent tests need updated workers, which are not running yet. Try again after the worker update finishes."));
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(await res.json()).toMatchObject({ code: "AGENT_WORKERS_PENDING", error: expect.stringContaining("updated workers") });
  });

  it.each([
    ["viewer", ctx("project_viewer")],
    ["viewer CLI token", ctx("project_viewer", { isCliAuth: true })],
    ["org pending deletion", ctx("project_editor", { orgPendingDeletion: true })],
  ])("denies %s before touching the test or the queue", async (_name, context) => {
    requireAuthContext.mockResolvedValue(context);
    expect((await post()).status).toBe(403);
    expect(findFirst).not.toHaveBeenCalled();
    expect(addTestToQueue).not.toHaveBeenCalled();
  });

  it.each([
    ["another project", { projectId: "p2" }],
    ["another organization", { organizationId: "org-2" }],
  ])("answers 404 for a test in %s and queues nothing", async (_name, patch) => {
    requireAuthContext.mockResolvedValue(ctx("project_editor"));
    findFirst.mockResolvedValue({ ...agentTest, ...patch });
    expect((await post()).status).toBe(404);
    expect(insert).not.toHaveBeenCalled();
    expect(addTestToQueue).not.toHaveBeenCalled();
  });

  it("answers 401 when unauthenticated", async () => {
    requireAuthContext.mockRejectedValue(new AuthError("Authentication required"));
    expect((await post()).status).toBe(401);
    expect(addTestToQueue).not.toHaveBeenCalled();
  });
});
