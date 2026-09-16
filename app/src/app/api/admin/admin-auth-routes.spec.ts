/** @jest-environment node */

import { NextRequest } from "next/server";

class MockAdminAccessDeniedError extends Error {}

jest.mock("@/lib/admin", () => ({
  requireAdmin: jest.fn(),
  isAdminAccessDeniedError: (error: unknown) =>
    error instanceof MockAdminAccessDeniedError,
}));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/feature-flags", () => ({
  isPolarEnabled: jest.fn(() => true),
}));
jest.mock("@/lib/services/polar-usage.service", () => ({
  polarUsageService: { syncPendingEvents: jest.fn() },
}));
jest.mock("@/lib/queue", () => ({ getQueues: jest.fn() }));
jest.mock("@/utils/db", () => ({ db: {} }));

import { POST as syncUsage } from "./sync-usage-events/route";
import { GET as getSchedulerStatus } from "./scheduler/status/route";

const { requireAdmin } = jest.requireMock("@/lib/admin") as {
  requireAdmin: jest.Mock;
};
const { requireUserAuthContext } = jest.requireMock("@/lib/auth-context") as {
  requireUserAuthContext: jest.Mock;
};

describe("admin route authorization", () => {
  beforeEach(() => jest.clearAllMocks());

  it("uses the bearer-authenticated user for usage sync authorization", async () => {
    requireUserAuthContext.mockResolvedValue({
      userId: "admin-1",
      organizationId: "org-1",
      isCliAuth: true,
    });
    requireAdmin.mockRejectedValue(new MockAdminAccessDeniedError());

    const response = await syncUsage(
      new NextRequest("http://localhost/api/admin/sync-usage-events", {
        method: "POST",
        headers: { authorization: "Bearer redacted" },
      }),
    );

    expect(requireAdmin).toHaveBeenCalledWith("admin-1");
    expect(response.status).toBe(403);
  });

  it("returns 403 for scheduler status admin denial", async () => {
    requireAdmin.mockRejectedValue(new MockAdminAccessDeniedError());

    const response = await getSchedulerStatus();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Admin privileges required",
    });
  });
});
