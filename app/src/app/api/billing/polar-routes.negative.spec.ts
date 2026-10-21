/** @jest-environment node */

import { NextRequest } from "next/server";

const mockEnsureCustomer = jest.fn();
jest.mock("@/lib/services/organization-customer", () => ({
  ensurePolarCustomerAndLink: (...args: unknown[]) =>
    mockEnsureCustomer(...args),
}));
jest.mock("@/lib/session", () => ({
  getCurrentUser: jest.fn(async () => ({
    id: "user_owner",
    email: "owner@example.com",
    name: "Owner",
  })),
}));

const mockCheckoutCreate = jest.fn();
const mockCustomerSessionCreate = jest.fn();

jest.mock("@polar-sh/sdk/2026-10", () => ({
  createPolar: jest.fn().mockImplementation(() => ({
    checkouts: { create: mockCheckoutCreate },
    customerSessions: { create: mockCustomerSessionCreate },
  })),
}));

jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(),
  isAuthError: jest.fn(
    (e: unknown) => e instanceof Error && e.name === "AuthError",
  ),
}));

jest.mock("@/lib/feature-flags", () => ({
  isPolarEnabled: jest.fn(() => true),
  getPolarConfig: jest.fn(() => ({
    accessToken: "polar_test_token",
    server: "sandbox",
    webhookSecret: "webhook_secret",
  })),
  getPolarProducts: jest.fn(() => ({
    plusProductId: "product_plus",
    proProductId: "product_pro",
  })),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  getUserOrgRole: jest.fn(),
}));

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      organization: { findFirst: jest.fn() },
    },
  },
}));

jest.mock("@/db/schema", () => ({
  organization: { id: "organization.id" },
}));

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((left, right) => ({ left, right })),
}));

import { db } from "@/utils/db";
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { isPolarEnabled, getPolarConfig } from "@/lib/feature-flags";
import { POST as checkoutPost } from "./checkout/route";
import { POST as portalPost } from "./portal/route";

const mockRequireUserAuthContext = requireUserAuthContext as jest.Mock;
const mockGetUserOrgRole = getUserOrgRole as jest.Mock;
const mockFindOrganization = db.query.organization.findFirst as jest.Mock;

function request(
  path: string,
  body?: unknown,
  origin = "https://app.supercheck.io",
) {
  return new NextRequest(`https://app.supercheck.io${path}`, {
    method: "POST",
    headers: {
      origin,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const mockPolarEnabled = isPolarEnabled as jest.Mock;
const mockPolarConfig = getPolarConfig as jest.Mock;

describe("Polar billing routes: hostile and failing inputs", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.supercheck.io",
      NODE_ENV: "test",
    };
    mockPolarEnabled.mockReturnValue(true);
    mockRequireUserAuthContext.mockResolvedValue({
      userId: "user_owner",
      organizationId: "org_1",
      isCliAuth: false,
    });
    mockGetUserOrgRole.mockResolvedValue("org_owner");
    mockFindOrganization.mockResolvedValue({
      polarCustomerId: "customer_1",
      subscriptionStatus: "none",
      subscriptionEndsAt: null,
    });
    mockCheckoutCreate.mockResolvedValue({
      url: "https://sandbox.polar.sh/checkout/1",
    });
    mockCustomerSessionCreate.mockResolvedValue({
      customer_portal_url: "https://sandbox.polar.sh/portal/1",
    });
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  describe("checkout", () => {
    it.each([
      ["products", { plan: "pro", products: ["product_free"] }],
      ["a customer id", { plan: "pro", customerId: "customer_attacker" }],
      [
        "a snake_case customer id",
        { plan: "pro", customer_id: "customer_attacker" },
      ],
      [
        "a redirect",
        { plan: "pro", success_url: "https://evil.example/steal" },
      ],
      ["metadata", { plan: "pro", metadata: { referenceId: "org_attacker" } }],
    ])(
      "rejects a body carrying %s instead of forwarding it",
      async (_name, body) => {
        const response = await checkoutPost(
          request("/api/billing/checkout", body),
        );
        expect(response.status).toBe(400);
        expect(mockCheckoutCreate).not.toHaveBeenCalled();
      },
    );

    it("builds the checkout only from server-side state", async () => {
      const response = await checkoutPost(
        request("/api/billing/checkout", { plan: "pro" }),
      );
      expect(response.status).toBe(200);
      const sent = mockCheckoutCreate.mock.calls[0][0];
      expect(sent.products).toEqual(["product_pro"]);
      expect(sent.customer_id).toBe("customer_1");
      expect(sent.metadata).toEqual({ referenceId: "org_1" });
      expect(sent.success_url.startsWith("https://app.supercheck.io/")).toBe(
        true,
      );
      expect(sent.return_url.startsWith("https://app.supercheck.io/")).toBe(
        true,
      );
    });

    it.each([
      ["an unknown plan", { plan: "enterprise" }],
      ["a missing plan", {}],
      ["a numeric plan", { plan: 1 }],
      ["an array", []],
    ])(
      "rejects %s with 400 before contacting the provider",
      async (_name, body) => {
        const response = await checkoutPost(
          request("/api/billing/checkout", body),
        );
        expect(response.status).toBe(400);
        expect(mockCheckoutCreate).not.toHaveBeenCalled();
      },
    );

    it("rejects an unparsable body", async () => {
      const bad = new NextRequest(
        "https://app.supercheck.io/api/billing/checkout",
        {
          method: "POST",
          headers: {
            origin: "https://app.supercheck.io",
            "content-type": "application/json",
          },
          body: "{not json",
        },
      );
      expect((await checkoutPost(bad)).status).toBe(400);
    });

    it("rejects CLI tokens", async () => {
      mockRequireUserAuthContext.mockResolvedValue({
        userId: "u",
        organizationId: "org_1",
        isCliAuth: true,
      });
      expect(
        (await checkoutPost(request("/api/billing/checkout", { plan: "pro" })))
          .status,
      ).toBe(403);
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
    });

    it("requires an active organization", async () => {
      mockRequireUserAuthContext.mockResolvedValue({
        userId: "u",
        organizationId: null,
        isCliAuth: false,
      });
      expect(
        (await checkoutPost(request("/api/billing/checkout", { plan: "pro" })))
          .status,
      ).toBe(400);
    });

    it("maps authentication failures to 401", async () => {
      mockRequireUserAuthContext.mockRejectedValue(
        Object.assign(new Error("Authentication required"), {
          name: "AuthError",
        }),
      );
      expect(
        (await checkoutPost(request("/api/billing/checkout", { plan: "pro" })))
          .status,
      ).toBe(401);
    });

    it("reports billing as unavailable when it is not configured", async () => {
      mockPolarEnabled.mockReturnValue(false);
      expect(
        (await checkoutPost(request("/api/billing/checkout", { plan: "pro" })))
          .status,
      ).toBe(503);
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
    });

    it("hides provider error details from the client", async () => {
      mockCheckoutCreate.mockRejectedValue(
        new Error("Invalid token polar_oat_SECRET"),
      );
      const response = await checkoutPost(
        request("/api/billing/checkout", { plan: "pro" }),
      );
      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).not.toContain("SECRET");
    });

    it("refuses to build return URLs over http in production", async () => {
      process.env = {
        ...process.env,
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://app.supercheck.io",
      };
      expect(
        (await checkoutPost(request("/api/billing/checkout", { plan: "pro" })))
          .status,
      ).toBe(502);
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
    });

    it("refuses when the organization does not exist", async () => {
      mockFindOrganization.mockResolvedValue(null);
      const response = await checkoutPost(
        request("/api/billing/checkout", { plan: "pro" }),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
    });
  });

  describe("portal", () => {
    it("rejects CLI tokens, non-owners and cross-origin requests", async () => {
      mockRequireUserAuthContext.mockResolvedValue({
        userId: "u",
        organizationId: "org_1",
        isCliAuth: true,
      });
      expect((await portalPost(request("/api/billing/portal"))).status).toBe(
        403,
      );
      mockRequireUserAuthContext.mockResolvedValue({
        userId: "u",
        organizationId: "org_1",
        isCliAuth: false,
      });
      mockGetUserOrgRole.mockResolvedValue("org_admin");
      expect((await portalPost(request("/api/billing/portal"))).status).toBe(
        403,
      );
      mockGetUserOrgRole.mockResolvedValue("org_owner");
      expect(
        (
          await portalPost(
            request("/api/billing/portal", undefined, "https://evil.example"),
          )
        ).status,
      ).toBe(403);
      expect(mockCustomerSessionCreate).not.toHaveBeenCalled();
    });

    it("requires an organization and a linked customer", async () => {
      mockRequireUserAuthContext.mockResolvedValue({
        userId: "u",
        organizationId: null,
        isCliAuth: false,
      });
      expect((await portalPost(request("/api/billing/portal"))).status).toBe(
        400,
      );
      mockRequireUserAuthContext.mockResolvedValue({
        userId: "u",
        organizationId: "org_1",
        isCliAuth: false,
      });
      mockFindOrganization.mockResolvedValue({ polarCustomerId: null });
      expect((await portalPost(request("/api/billing/portal"))).status).toBe(
        409,
      );
      expect(mockCustomerSessionCreate).not.toHaveBeenCalled();
    });

    it("reports billing as unavailable when it is not configured", async () => {
      mockPolarEnabled.mockReturnValue(false);
      expect((await portalPost(request("/api/billing/portal"))).status).toBe(
        503,
      );
    });

    it("rejects a body carrying a customer id or redirect", async () => {
      const response = await portalPost(
        request("/api/billing/portal", {
          customer_id: "customer_attacker",
          returnUrl: "https://evil.example",
        }),
      );
      expect(response.status).toBe(400);
      expect(mockCustomerSessionCreate).not.toHaveBeenCalled();
    });

    it("opens the portal for the stored customer only, returning to a fixed same-origin path", async () => {
      const response = await portalPost(request("/api/billing/portal"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        url: "https://sandbox.polar.sh/portal/1",
      });
      expect(mockCustomerSessionCreate).toHaveBeenCalledWith({
        customer_id: "customer_1",
        return_url: "https://app.supercheck.io/org-admin?tab=subscription",
      });
    });

    it("hides provider error details and maps authentication failures", async () => {
      mockCustomerSessionCreate.mockRejectedValue(
        new Error("token polar_oat_SECRET rejected"),
      );
      const failed = await portalPost(request("/api/billing/portal"));
      expect(failed.status).toBe(502);
      expect(JSON.stringify(await failed.json())).not.toContain("SECRET");
      mockRequireUserAuthContext.mockRejectedValue(
        Object.assign(new Error("Authentication required"), {
          name: "AuthError",
        }),
      );
      expect((await portalPost(request("/api/billing/portal"))).status).toBe(
        401,
      );
    });

    it("treats a missing provider configuration as incomplete setup", async () => {
      mockPolarConfig.mockReturnValueOnce(null);
      expect((await portalPost(request("/api/billing/portal"))).status).toBe(
        409,
      );
    });
  });
});
