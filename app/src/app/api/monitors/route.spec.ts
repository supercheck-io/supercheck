/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/session-security", () => ({
  checkMonitorApiRateLimit: jest.fn(async () => ({ allowed: true })),
}));
jest.mock("@/lib/logger/index", () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));
jest.mock("@/lib/services/subscription-service", () => {
  class SubscriptionAccessDeniedError extends Error {
    constructor(
      message: string,
      readonly reason: string,
    ) {
      super(message);
      this.name = "SubscriptionAccessDeniedError";
    }
  }
  return {
    subscriptionService: {
      blockUntilSubscribed: jest.fn(),
      requireValidPolarCustomer: jest.fn(),
    },
    SubscriptionAccessDeniedError,
  };
});
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));

import { POST } from "./route";
import { SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";

const { requireAuthContext } = jest.requireMock("@/lib/auth-context") as {
  requireAuthContext: jest.Mock;
};
const { subscriptionService } = jest.requireMock(
  "@/lib/services/subscription-service",
) as {
  subscriptionService: {
    blockUntilSubscribed: jest.Mock;
    requireValidPolarCustomer: jest.Mock;
  };
};

const request = () =>
  new NextRequest("http://localhost/api/monitors", {
    method: "POST",
    body: JSON.stringify({
      name: "m",
      target: "https://example.com",
      type: "http_request",
    }),
    headers: { "content-type": "application/json" },
  });

describe("POST /api/monitors paywall", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthContext.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      project: { id: "project-1", name: "Project" },
      isCliAuth: false,
    });
  });

  it.each([
    "subscription_required",
    "polar_customer_missing",
    "polar_customer_invalid",
  ] as const)("returns 402 with code %s instead of 500", async (reason) => {
    subscriptionService.blockUntilSubscribed.mockRejectedValue(
      new SubscriptionAccessDeniedError("Subscription required", reason),
    );
    const response = await POST(request());
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "Subscription required",
      code: reason,
    });
  });

  it("also maps an invalid billing customer to 402", async () => {
    subscriptionService.requireValidPolarCustomer.mockRejectedValue(
      new SubscriptionAccessDeniedError(
        "Billing customer invalid",
        "polar_customer_invalid",
      ),
    );
    const response = await POST(request());
    expect(response.status).toBe(402);
  });
});

describe("POST /api/monitors synthetic monitor test id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The paywall tests above leave a rejecting implementation behind.
    subscriptionService.blockUntilSubscribed.mockReset();
    subscriptionService.requireValidPolarCustomer.mockReset();
    requireAuthContext.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      project: { id: "project-1", name: "Project" },
      isCliAuth: false,
    });
  });

  // `db` is an empty object here, so reaching the test lookup would throw and answer 500.
  it.each(["not-a-uuid", "123", "00000000-0000-0000-0000-00000000000g"])(
    "answers 400 for config.testId %s before looking the test up",
    async (testId) => {
      const response = await POST(
        new NextRequest("http://localhost/api/monitors", {
          method: "POST",
          body: JSON.stringify({ name: "m", type: "synthetic_test", config: { testId } }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "Invalid monitor configuration",
        details: "config.testId must be a valid test ID for synthetic monitors",
      });
    },
  );
});

