/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { requireUserAuthContext } from "@/lib/auth-context";
import { getSelectableProjects, getUserProjects } from "@/lib/session";
import { hasPermissionForUser, getUserRole } from "@/lib/rbac/middleware";
import {
  subscriptionService,
  SubscriptionAccessDeniedError,
} from "@/lib/services/subscription-service";
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/session", () => ({
  getSelectableProjects: jest.fn(),
  getUserProjects: jest.fn(),
}));
jest.mock("@/lib/project-context", () => ({
  getCurrentProjectContext: jest.fn(async () => ({
    id: "invited-project",
    organizationId: "team",
  })),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  hasPermissionForUser: jest.fn(),
  getUserRole: jest.fn(),
}));
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/middleware/plan-enforcement", () => ({
  checkProjectLimit: jest.fn(),
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
beforeEach(() => {
  jest.clearAllMocks();
  (requireUserAuthContext as jest.Mock).mockResolvedValue({
    userId: "user",
    organizationId: "team",
    isCliAuth: false,
  });
  (hasPermissionForUser as jest.Mock).mockResolvedValue(true);
  (getSelectableProjects as jest.Mock).mockResolvedValue([
    { id: "home-project", organizationId: "home" },
    { id: "invited-project", organizationId: "team" },
  ]);
  (getUserProjects as jest.Mock).mockResolvedValue([
    { id: "invited-project", organizationId: "team" },
  ]);
});
it("lists home and invited projects for browser selection", async () => {
  const response = await GET(
    new NextRequest("https://app.supercheck.io/api/projects"),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).data).toHaveLength(2);
  expect(getSelectableProjects).toHaveBeenCalledWith("user");
  expect(getUserProjects).not.toHaveBeenCalled();
});
it("keeps CLI listing scoped to its token organization", async () => {
  (requireUserAuthContext as jest.Mock).mockResolvedValue({
    userId: "user",
    organizationId: "team",
    isCliAuth: true,
  });
  const response = await GET(
    new NextRequest("https://app.supercheck.io/api/projects"),
  );
  expect(response.status).toBe(200);
  expect(getUserProjects).toHaveBeenCalledWith("user", "team");
  expect(getSelectableProjects).not.toHaveBeenCalled();
});
it("checks explicit organization permissions before listing projects", async () => {
  (hasPermissionForUser as jest.Mock).mockResolvedValue(false);
  expect(
    (
      await GET(
        new NextRequest(
          "https://app.supercheck.io/api/projects?organizationId=other",
        ),
      )
    ).status,
  ).toBe(403);
  expect(getUserProjects).not.toHaveBeenCalled();
  expect(getSelectableProjects).not.toHaveBeenCalled();
});
it("returns 402 with the denial code, not 500, when creating a project without a subscription", async () => {
  (getUserRole as jest.Mock).mockResolvedValue("org_owner");
  (subscriptionService.blockUntilSubscribed as jest.Mock).mockRejectedValue(
    new SubscriptionAccessDeniedError(
      "Subscription required",
      "subscription_required",
    ),
  );
  const response = await POST(
    new NextRequest("https://app.supercheck.io/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "P", organizationId: "team" }),
    }),
  );
  expect(response.status).toBe(402);
  expect(await response.json()).toEqual({
    error: "Subscription required",
    code: "subscription_required",
  });
});
