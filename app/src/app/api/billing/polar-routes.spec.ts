/** @jest-environment node */

import { NextRequest } from "next/server";

const mockEnsureCustomer = jest.fn();
jest.mock("@/lib/services/organization-customer", () => ({ ensurePolarCustomerAndLink: (...args: unknown[]) => mockEnsureCustomer(...args) }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(async () => ({ id: "user_owner", email: "owner@example.com", name: "Owner" })) }));

const mockCheckoutCreate = jest.fn();
const mockGetCustomerState = jest.fn();
const mockCustomerSessionCreate = jest.fn();

jest.mock("@polar-sh/sdk/2026-10", () => ({
  createPolar: jest.fn().mockImplementation(() => ({
    checkouts: { create: mockCheckoutCreate },
    customerSessions: { create: mockCustomerSessionCreate },
    customers: { getState: mockGetCustomerState },
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

const mockImpersonationState = jest.fn(async (): Promise<string> => "none");
jest.mock("@/lib/rbac/middleware", () => ({
  getUserOrgRole: jest.fn(),
  getImpersonationState: () => mockImpersonationState(),
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
    mockImpersonationState.mockResolvedValue("none");
    mockGetCustomerState.mockResolvedValue({ active_subscriptions: [] });
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
      customer_portal_url: "https://sandbox.polar.sh/portal/1",
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
        customer_id: "customer_1",
        products: ["product_pro"],
        metadata: { referenceId: "org_1" },
        success_url:
          "https://app.supercheck.io/billing/success?checkout_id={CHECKOUT_ID}&organization_id=org_1",
        return_url: "https://app.supercheck.io/subscribe",
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
    expect(mockCheckoutCreate).toHaveBeenCalledWith(expect.objectContaining({ customer_id: "customer_org_1" }));
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
    expect(mockCheckoutCreate).toHaveBeenCalledWith(expect.objectContaining({ customer_id: "original-customer" }));
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

  it("rejects checkout when Polar already has an active subscription the webhooks have not recorded", async () => {
    mockGetCustomerState.mockResolvedValue({ active_subscriptions: [{ id: "sub_1", product_id: "product_plus" }] });

    const response = await checkoutPost(request("/api/billing/checkout", { plan: "pro" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "subscription_exists" });
    expect(mockGetCustomerState).toHaveBeenCalledWith("customer_1");
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it("allows checkout when the shared customer's only active subscription belongs to another organization", async () => {
    mockGetCustomerState.mockResolvedValue({
      active_subscriptions: [{ id: "sub_other", product_id: "product_plus", metadata: { referenceId: "org_other" } }],
    });

    const response = await checkoutPost(request("/api/billing/checkout", { plan: "pro" }));

    expect(response.status).toBe(200);
    expect(mockCheckoutCreate).toHaveBeenCalled();
  });

  it.each([
    ["tagged to this organization", { referenceId: "org_1" }],
    ["untagged", undefined],
    ["with a non-string tag", { referenceId: 42 }],
  ])("still blocks checkout when an active subscription is %s", async (_label, metadata) => {
    mockGetCustomerState.mockResolvedValue({
      active_subscriptions: [
        { id: "sub_other", product_id: "product_plus", metadata: { referenceId: "org_other" } },
        { id: "sub_1", product_id: "product_plus", metadata },
      ],
    });

    const response = await checkoutPost(request("/api/billing/checkout", { plan: "pro" }));

    expect(response.status).toBe(409);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it("returns a retryable 503 from checkout and portal when the session lookup fails", async () => {
    mockImpersonationState.mockResolvedValue("unknown");

    const checkout = await checkoutPost(request("/api/billing/checkout", { plan: "pro" }));
    const portal = await portalPost(request("/api/billing/portal"));

    expect(checkout.status).toBe(503);
    expect(portal.status).toBe(503);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
    expect(mockCustomerSessionCreate).not.toHaveBeenCalled();
  });

  it("fails closed without creating a checkout when Polar customer state is unavailable", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockGetCustomerState.mockRejectedValue(new Error("Polar unavailable"));

    const response = await checkoutPost(request("/api/billing/checkout", { plan: "plus" }));

    expect(response.status).toBe(502);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("refuses checkout and portal while a super admin impersonates the owner", async () => {
    mockImpersonationState.mockResolvedValue("impersonated");

    const checkout = await checkoutPost(request("/api/billing/checkout", { plan: "pro" }));
    const portal = await portalPost(request("/api/billing/portal"));

    expect(checkout.status).toBe(403);
    expect(portal.status).toBe(403);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
    expect(mockCustomerSessionCreate).not.toHaveBeenCalled();
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
      customer_id: "customer_1",
      return_url: "https://app.supercheck.io/org-admin?tab=subscription",
    });
  });
});
