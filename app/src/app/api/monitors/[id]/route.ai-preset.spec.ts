/** @jest-environment node */
// Permission denials ask whether the organization is pending deletion; these specs run without a database.
jest.mock("@/lib/deletion/org-state", () => {
  const overrides: Record<string, unknown> = {
    isOrgPendingDeletion: async () => false,
    isProjectDeleted: async () => false,
    isProjectOrgPending: async () => false,
    permissionDeniedResponse: async (_org: unknown, message: string) => Response.json({ error: message }, { status: 403 }),
    permissionDeniedResult: async (_org: unknown, message: string) => ({ success: false, error: message, message }),
  };
  return new Proxy({}, { get: (_t, key: string) => (key in overrides ? overrides[key] : jest.requireActual("@/lib/deletion/org-state")[key]) });
});

const findFirst = jest.fn();
const update = jest.fn();
const transaction = jest.fn();

jest.mock("@/utils/db", () => ({
  db: { query: { monitors: { findFirst: (...args: unknown[]) => findFirst(...args) } }, update: (...args: unknown[]) => update(...args), transaction: (...args: unknown[]) => transaction(...args) },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn().mockResolvedValue({
    userId: "user-1",
    organizationId: "org-1",
    project: { id: "project-1" },
  }),
  isAuthError: (e: unknown) => (e as { name?: string })?.name === "AuthError",
  authErrorStatus: (e: { status: number }) => e.status,
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn().mockReturnValue(true),
}));
jest.mock("@/lib/monitor-scheduler", () => ({
  scheduleMonitor: jest.fn(),
  deleteScheduledMonitor: jest.fn(),
}));
jest.mock("@/lib/monitor-schedule-reconcile", () => ({ reconcileMonitorSchedule: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
const trialIntervalErrorResponse = jest.fn();
const monitorResumeBlockedResponse = jest.fn();
jest.mock("@/lib/execution/trial-interval-response", () => ({
  trialIntervalErrorResponse: (...args: unknown[]) => trialIntervalErrorResponse(...args),
  monitorResumeBlockedResponse: (...args: unknown[]) => monitorResumeBlockedResponse(...args),
}));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: jest.fn() }));
jest.mock("@/lib/queue", () => ({}));
jest.mock("@/lib/monitor-validation", () => ({
  validateMonitorConfiguration: jest.fn().mockReturnValue({ success: true }),
}));
const validateMonitorSecretRefs = jest.fn();
jest.mock("@/lib/monitor-secret-refs", () => ({ validateMonitorSecretRefs: (...a: unknown[]) => validateMonitorSecretRefs(...a) }));
jest.mock("@/lib/location-registry", () => ({
  // Browser-capable: EU only. Project may use all three regions.
  getWorkloadCapableLocationCodes: jest.fn().mockResolvedValue(["eu-central"]),
  getProjectAvailableLocationCodes: jest
    .fn()
    .mockResolvedValue(["eu-central", "us-east", "asia-pacific"]),
  getAllEnabledLocationCodes: jest.fn(),
  getDefaultLocationCodes: jest.fn(),
  getFirstDefaultLocationCode: jest.fn(),
  hasProjectLocationRestrictions: jest.fn(),
  PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR: "restricted",
}));
jest.mock("@/lib/worker-registry", () => ({ getActiveWorkerQueueNames: jest.fn() }));

import { NextRequest } from "next/server";
jest.mock("@/lib/sre/connectors/endpoint-policy", () => ({
  lookupBounded: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
import { PATCH, PUT } from "./route";


const existing = {
  id: "00000000-0000-4000-8000-000000000002",
  type: "http_request",
  target: "https://api.example.com/v1/chat/completions",
  projectId: "project-1",
  organizationId: "org-1",
  status: "up",
  config: {},
};
const preset = { aiEndpoint: { model: "gpt-4o-mini", secretKey: "OPENAI_KEY" } };
const call = (handler: typeof PUT | typeof PATCH, method: "PUT" | "PATCH", body: object) =>
  handler(new NextRequest("http://localhost/api/monitors/00000000-0000-4000-8000-000000000002", { method, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000002" }),
  });
const { checkPermissionWithContext } = jest.requireMock("@/lib/rbac/middleware") as { checkPermissionWithContext: jest.Mock };
const { requireAuthContext } = jest.requireMock("@/lib/auth-context") as { requireAuthContext: jest.Mock };
const auth = { userId: "user-1", organizationId: "org-1", project: { id: "project-1" } };

beforeEach(() => {
  jest.clearAllMocks();
  checkPermissionWithContext.mockReturnValue(true);
  requireAuthContext.mockResolvedValue(auth);
  findFirst.mockResolvedValue(existing);
  monitorResumeBlockedResponse.mockResolvedValue(null);
  trialIntervalErrorResponse.mockResolvedValue(null);
  validateMonitorSecretRefs.mockResolvedValue({ success: true });
  update.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([]) }) }) });
});

describe.each([[PUT, "PUT"], [PATCH, "PATCH"]] as const)("%s monitor with the AI endpoint preset", (handler, method) => {
  it("checks the named secrets against the caller's own project and refuses an unknown one", async () => {
    validateMonitorSecretRefs.mockResolvedValue({ success: false, error: "Invalid monitor configuration", details: "Secret OPENAI_KEY was not found in this project" });
    const res = await call(handler, method, { config: preset });
    expect(res.status).toBe(400);
    expect(validateMonitorSecretRefs).toHaveBeenCalledWith(auth, preset, existing.target, expect.objectContaining({ targetChanged: false }));
    expect(update).not.toHaveBeenCalled();
  });

  it("gates a target-only change on a monitor that stores a secret reference", async () => {
    const stored = { aiEndpoint: { model: "m", secretKey: "OPENAI_KEY" } };
    findFirst.mockResolvedValue({ ...existing, config: stored });
    validateMonitorSecretRefs.mockResolvedValue({ success: false, error: "Forbidden", details: "Secrets cannot be used while impersonating a user", status: 403 });
    const res = await call(handler, method, { target: "https://collector.example/v1/chat/completions" });
    expect(res.status).toBe(403);
    expect(validateMonitorSecretRefs).toHaveBeenCalledWith(
      auth,
      undefined,
      "https://collector.example/v1/chat/completions",
      { effectiveConfig: stored, targetChanged: true },
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("passes a secret-use denial (no view_secrets, or impersonating) through as 403 without the internal status field", async () => {
    validateMonitorSecretRefs.mockResolvedValue({ success: false, error: "Forbidden", details: "Insufficient permissions to use project secrets", status: 403 });
    const res = await call(handler, method, { config: preset });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Forbidden", details: "Insufficient permissions to use project secrets" });
    expect(body).not.toHaveProperty("status");
    expect(update).not.toHaveBeenCalled();
  });

  it("denies a viewer, and a viewer's CLI token, before any secret lookup", async () => {
    checkPermissionWithContext.mockReturnValue(false);
    for (const ctx of [auth, { ...auth, isCliAuth: true }]) {
      requireAuthContext.mockResolvedValue(ctx);
      expect((await call(handler, method, { config: preset })).status).toBe(403);
    }
    expect(checkPermissionWithContext).toHaveBeenCalledWith("monitor", "update", expect.objectContaining({ organizationId: "org-1" }));
    expect(validateMonitorSecretRefs).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("answers 404 for a monitor in another organization or project, without touching secrets", async () => {
    findFirst.mockResolvedValue(undefined);
    expect((await call(handler, method, { config: preset })).status).toBe(404);
    expect(validateMonitorSecretRefs).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    requireAuthContext.mockRejectedValue(Object.assign(new Error("Authentication required"), { name: "AuthError", status: 401 }));
    expect((await call(handler, method, { config: preset })).status).toBe(401);
    expect(validateMonitorSecretRefs).not.toHaveBeenCalled();
  });
});
