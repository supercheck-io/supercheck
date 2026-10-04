/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn() }));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: { getSubscriptionAccessStatus: jest.fn() } }));

import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { subscriptionService } from "@/lib/services/subscription-service";
import { GET } from "./route";

const paidOrg = "11111111-1111-4111-8111-111111111111";
const selectedOrg = "22222222-2222-4222-8222-222222222222";
const request = (id?: string) => new NextRequest(`https://app.supercheck.io/api/subscription/status${id ? `?organizationId=${id}` : ""}`);

describe("organization subscription confirmation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "owner", organizationId: selectedOrg, isCliAuth: false });
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_owner");
    (subscriptionService.getSubscriptionAccessStatus as jest.Mock).mockResolvedValue({ isActive: true, plan: "plus", status: "active" });
  });

  it("checks the checkout organization after the selected organization changes", async () => {
    const response = await GET(request(paidOrg));
    expect(response.status).toBe(200);
    expect((await response.json()).organizationId).toBe(paidOrg);
    expect(getUserOrgRole).toHaveBeenCalledWith("owner", paidOrg);
    expect(subscriptionService.getSubscriptionAccessStatus).toHaveBeenCalledWith(paidOrg);
  });

  it("does not expose another organization's subscription to a nonmember", async () => {
    (getUserOrgRole as jest.Mock).mockResolvedValue(null);
    expect((await GET(request(paidOrg))).status).toBe(403);
    expect(subscriptionService.getSubscriptionAccessStatus).not.toHaveBeenCalled();
  });

  it("preserves the selected organization for ordinary subscription checks", async () => {
    await GET(request());
    expect(subscriptionService.getSubscriptionAccessStatus).toHaveBeenCalledWith(selectedOrg);
  });

  it.each([true, false])("uses the invited host's access instead of the owner's home plan (host active: %s)", async isActive => {
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "home-owner", organizationId: selectedOrg, isCliAuth: false });
    (subscriptionService.getSubscriptionAccessStatus as jest.Mock).mockImplementation(async id => ({
      isActive: id === paidOrg || isActive,
      plan: id === paidOrg ? "pro" : isActive ? "plus" : null,
      status: id === paidOrg || isActive ? "active" : "none",
    }));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ organizationId: selectedOrg, isActive, plan: isActive ? "plus" : null });
    expect(subscriptionService.getSubscriptionAccessStatus).toHaveBeenCalledTimes(1);
    expect(subscriptionService.getSubscriptionAccessStatus).toHaveBeenCalledWith(selectedOrg);
  });

  it("rejects a CLI override and malformed organization identifiers", async () => {
    expect((await GET(request("invalid"))).status).toBe(400);
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "owner", organizationId: selectedOrg, isCliAuth: true });
    expect((await GET(request(paidOrg))).status).toBe(403);
    expect(subscriptionService.getSubscriptionAccessStatus).not.toHaveBeenCalled();
  });
});
