/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: jest.fn(() => false),
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

import { POST } from "./route";
import { SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";

const { requireAuthContext } = jest.requireMock("@/lib/auth-context") as {
  requireAuthContext: jest.Mock;
};
const { subscriptionService } = jest.requireMock(
  "@/lib/services/subscription-service",
) as { subscriptionService: { blockUntilSubscribed: jest.Mock } };

describe("POST /api/tests", () => {
  it("returns 402 when subscription access is denied", async () => {
    requireAuthContext.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      project: { id: "project-1", name: "Project" },
      isCliAuth: false,
    });
    subscriptionService.blockUntilSubscribed.mockRejectedValue(
      new SubscriptionAccessDeniedError(
        "An active subscription is required",
        "subscription_required",
      ),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/tests", {
        method: "POST",
        body: JSON.stringify({ title: "Smoke test" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "An active subscription is required",
      code: "subscription_required",
    });
  });
});
