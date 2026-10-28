/** @jest-environment node */
import { NextRequest } from "next/server";

const dbSelect = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: (...a: unknown[]) => dbSelect(...a) } }));
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
jest.mock("@/lib/execution/trial-interval-response", () => ({ trialIntervalErrorResponse: jest.fn().mockResolvedValue(null) }));
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

import { POST } from "./route";

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
