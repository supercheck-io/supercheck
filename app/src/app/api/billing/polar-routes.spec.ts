/** @jest-environment node */

import { NextRequest } from "next/server";

const mockEnsureCustomer = jest.fn();
jest.mock("@/lib/services/organization-customer", () => ({ ensurePolarCustomerAndLink: (...args: unknown[]) => mockEnsureCustomer(...args) }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(async () => ({ id: "user_owner", email: "owner@example.com", name: "Owner" })) }));

const mockCheckoutCreate = jest.fn();
const mockCustomerSessionCreate = jest.fn();

jest.mock("@polar-sh/sdk", () => ({
  Polar: jest.fn().mockImplementation(() => ({
    checkouts: { create: mockCheckoutCreate },
    customerSessions: { create: mockCustomerSessionCreate },
  })),
}));

jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(),
  isAuthError: jest.fn(() => false),
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
import { POST as checkoutPost } from "./checkout/route";
import { POST as portalPost } from "./portal/route";

const mockRequireUserAuthContext = requireUserAuthContext as jest.Mock;
const mockGetUserOrgRole = getUserOrgRole as jest.Mock;
const mockFindOrganization = db.query.organization.findFirst as jest.Mock;

function request(path: string, body?: unknown, origin = "https://app.supercheck.io") {
  return new NextRequest(`https://app.supercheck.io${path}`, {
    method: "POST",
    headers: {
      origin,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("Polar billing routes", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.supercheck.io",
      NODE_ENV: "test",
    };
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
    mockCheckoutCreate.mockResolvedValue({ url: "https://sandbox.polar.sh/checkout/1" });
    mockCustomerSessionCreate.mockResolvedValue({
      customerPortalUrl: "https://sandbox.polar.sh/portal/1",
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("creates checkout with only the server-selected product and organization reference", async () => {
    const response = await checkoutPost(
      request("/api/billing/checkout", { plan: "pro" })
    );

    expect(response.status).toBe(200);
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "customer_1",
        products: ["product_pro"],
        metadata: { referenceId: "org_1" },
        successUrl:
          "https://app.supercheck.io/billing/success?checkout_id={CHECKOUT_ID}&organization_id=org_1",
        returnUrl: "https://app.supercheck.io/subscribe",
      })
    );
  });

  it("reports a transient customer provisioning outage as a gateway failure", async () => {
    mockEnsureCustomer.mockRejectedValueOnce(new Error("Polar unavailable"));
    mockFindOrganization.mockResolvedValueOnce({ id: "org_1", polarCustomerId: null, subscriptionStatus: "none" });
    const response = await checkoutPost(request("/api/billing/checkout", { plan: "plus" }));
    expect(response.status).toBe(502);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it("repairs failed customer provisioning for only the selected organization", async () => {
    mockFindOrganization.mockResolvedValue({ polarCustomerId: null, subscriptionStatus: "none" });
    mockEnsureCustomer.mockResolvedValue("customer_org_1");
    const response = await checkoutPost(request("/api/billing/checkout", { plan: "plus" }));
    expect(response.status).toBe(200);
    expect(mockEnsureCustomer).toHaveBeenCalledWith("user_owner", "owner@example.com", "Owner", "org_1", { throwOnError: true });
    expect(mockCheckoutCreate).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer_org_1" }));
  });

  it("rejects stale organization checkout and portal actions before contacting Polar", async () => {
    const expected = "11111111-1111-4111-8111-111111111111";
    expect((await checkoutPost(request("/api/billing/checkout", { plan: "plus", organizationId: expected }))).status).toBe(409);
    expect((await portalPost(request("/api/billing/portal", { organizationId: expected }))).status).toBe(409);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
    expect(mockCustomerSessionCreate).not.toHaveBeenCalled();
  });

  it("rejects checkout from a non-owner", async () => {
    mockGetUserOrgRole.mockResolvedValue("org_admin");

    const response = await checkoutPost(
      request("/api/billing/checkout", { plan: "plus" })
    );

    expect(response.status).toBe(403);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it.each(["org_admin", "project_admin", "project_editor", "project_viewer"])("ownership of home does not grant %s billing rights in an invited team", async role => {
    mockRequireUserAuthContext.mockResolvedValue({ userId: "user_owner", organizationId: "invited-team", isCliAuth: false });
    mockGetUserOrgRole.mockImplementation(async (_userId, orgId) => orgId === "home" ? "org_owner" : role);
    expect((await checkoutPost(request("/api/billing/checkout", { plan: "plus" }))).status).toBe(403);
    expect((await portalPost(request("/api/billing/portal"))).status).toBe(403);
    expect(mockGetUserOrgRole).toHaveBeenCalledWith("user_owner", "invited-team");
    expect(mockFindOrganization).not.toHaveBeenCalled();
    expect(mockEnsureCustomer).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
    expect(mockCustomerSessionCreate).not.toHaveBeenCalled();
  });

  it.each(["active", "past_due", "canceled"])("prevents duplicate checkout for a %s subscription with remaining access", async status => {
    mockFindOrganization.mockResolvedValue({ polarCustomerId: "customer_1", subscriptionStatus: status, subscriptionEndsAt: new Date(Date.now() + 86400000) });
    expect((await checkoutPost(request("/api/billing/checkout", { plan: "plus" }))).status).toBe(409);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it("allows resubscription after cancellation has expired using the original customer", async () => {
    mockFindOrganization.mockResolvedValue({ polarCustomerId: "original-customer", subscriptionStatus: "canceled", subscriptionEndsAt: new Date(0) });
    expect((await checkoutPost(request("/api/billing/checkout", { plan: "plus" }))).status).toBe(200);
    expect(mockCheckoutCreate).toHaveBeenCalledWith(expect.objectContaining({ customerId: "original-customer" }));
    expect(mockEnsureCustomer).not.toHaveBeenCalled();
  });

  it("rejects a second checkout while subscription access is active", async () => {
    mockFindOrganization.mockResolvedValue({
      polarCustomerId: "customer_1",
      subscriptionStatus: "active",
      subscriptionEndsAt: null,
    });

    const response = await checkoutPost(
      request("/api/billing/checkout", { plan: "pro" })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "subscription_exists",
    });
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it("rejects cross-origin checkout requests", async () => {
    const response = await checkoutPost(
      request(
        "/api/billing/checkout",
        { plan: "plus" },
        "https://attacker.example"
      )
    );

    expect(response.status).toBe(403);
    expect(mockRequireUserAuthContext).not.toHaveBeenCalled();
  });

  it("opens the portal only for the active organization owner", async () => {
    const response = await portalPost(request("/api/billing/portal"));

    expect(response.status).toBe(200);
    expect(mockCustomerSessionCreate).toHaveBeenCalledWith({
      customerId: "customer_1",
      returnUrl: "https://app.supercheck.io/org-admin?tab=subscription",
    });
  });
});
