/** @jest-environment node */
import { NextRequest } from "next/server";

const dbSelect = jest.fn();
const dbDeleteWhere = jest.fn();
jest.mock("@/utils/db", () => ({
  db: { select: (...a: unknown[]) => dbSelect(...a), delete: () => ({ where: (...a: unknown[]) => dbDeleteWhere(...a) }) },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => ({ userId: "u", organizationId: "org-1", project: { id: "project-1", name: "P" }, isCliAuth: false })),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/session-security", () => ({ checkMonitorApiRateLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: { blockUntilSubscribed: jest.fn(), requireValidPolarCustomer: jest.fn() },
  SubscriptionAccessDeniedError: class extends Error {},
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
const monitorResumeBlockedResponse = jest.fn();
jest.mock("@/lib/execution/trial-interval-response", () => ({
  trialIntervalErrorResponse: jest.fn().mockResolvedValue(null),
  monitorResumeBlockedResponse: (...a: unknown[]) => monitorResumeBlockedResponse(...a),
}));
const insertWithinPlanLimit = jest.fn();
jest.mock("@/lib/middleware/plan-limit-lock", () => ({ insertWithinPlanLimit: (...a: unknown[]) => insertWithinPlanLimit(...a) }));
jest.mock("@/lib/middleware/plan-enforcement", () => ({ checkMonitorLimit: jest.fn() }));
jest.mock("@/lib/monitor-service", () => ({ insertMonitorRecord: jest.fn(), scheduleCreatedMonitor: jest.fn() }));
jest.mock("@/lib/location-registry", () => ({
  getProjectAvailableLocationCodes: jest.fn().mockResolvedValue([]),
  getWorkloadCapableLocationCodes: jest.fn().mockResolvedValue([]),
  getAllEnabledLocationCodes: jest.fn(),
  getDefaultLocationCodes: jest.fn(),
  getFirstDefaultLocationCode: jest.fn(),
  hasProjectLocationRestrictions: jest.fn(),
  PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR: "restricted",
}));
jest.mock("@/lib/worker-registry", () => ({ getActiveWorkerQueueNames: jest.fn() }));
jest.mock("@/lib/creators", () => ({ loadCreators: jest.fn() }));

import { POST, PUT } from "./route";

const post = (alertConfig: object) =>
  POST(
    new NextRequest("http://localhost/api/monitors", {
      method: "POST",
      body: JSON.stringify({ name: "m", type: "http_request", target: "https://example.com", alertConfig }),
      headers: { "content-type": "application/json" },
    }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  dbSelect.mockReturnValue({ from: () => ({ where: async () => [] }) });
});

it("rejects notification providers outside the project before inserting (c14)", async () => {
  const res = await post({ enabled: true, notificationProviders: ["00000000-0000-4000-8000-0000000000aa"], alertOnFailure: true });
  expect(res.status).toBe(400);
  expect(insertWithinPlanLimit).not.toHaveBeenCalled();
});

it.each([2.5, 0, -3, 101])("rejects failureThreshold %p (c16)", async (failureThreshold) => {
  const res = await post({ enabled: false, notificationProviders: [], failureThreshold });
  expect(res.status).toBe(400);
  expect(insertWithinPlanLimit).not.toHaveBeenCalled();
});

it("bulk PUT refuses to resume a paused monitor without a plan", async () => {
  dbSelect.mockReturnValue({
    from: () => ({ where: () => ({ limit: async () => [{ projectId: "project-1", organizationId: "org-1", status: "paused", type: "website", target: "https://example.com", config: {} }] }) }),
  });
  monitorResumeBlockedResponse.mockResolvedValue(Response.json({ error: "Active subscription required." }, { status: 402 }));
  const res = await PUT(
    new NextRequest("http://localhost/api/monitors", {
      method: "PUT",
      body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000002", enabled: true }),
    }),
  );
  expect(res.status).toBe(402);
  expect(monitorResumeBlockedResponse).toHaveBeenCalledWith("org-1", "paused", expect.objectContaining({ enabled: true }));
});

it("removes the new monitor when it cannot be scheduled, so a retry does not duplicate it", async () => {
  const { scheduleCreatedMonitor } = jest.requireMock("@/lib/monitor-service") as { scheduleCreatedMonitor: jest.Mock };
  insertWithinPlanLimit.mockResolvedValue({ ok: true, row: { newMonitor: { id: "new-monitor" }, enabled: true } });
  scheduleCreatedMonitor.mockRejectedValue(new Error("redis down"));
  const res = await post({ enabled: false, notificationProviders: [] });
  expect(res.status).toBe(500);
  expect(dbDeleteWhere).toHaveBeenCalledTimes(1);
});

it("rejects a synthetic monitor that runs more often than every 5 minutes", async () => {
  const res = await POST(
    new NextRequest("http://localhost/api/monitors", {
      method: "POST",
      body: JSON.stringify({ name: "m", type: "synthetic_test", frequencyMinutes: 1, config: { testId: "00000000-0000-4000-8000-0000000000bb" } }),
      headers: { "content-type": "application/json" },
    }),
  );
  expect(res.status).toBe(400);
  expect(insertWithinPlanLimit).not.toHaveBeenCalled();
});
