/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false), authErrorStatus: jest.fn(() => 401) }));
jest.mock("@/lib/feature-flags", () => ({
  isPolarEnabled: jest.fn(() => true),
  getPolarConfig: jest.fn(() => ({ accessToken: "tok", server: "sandbox" })),
}));
const mockImpersonation = jest.fn(async (): Promise<string> => "none");
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn(), getImpersonationState: () => mockImpersonation() }));
jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: { getSubscriptionAccessStatus: jest.fn(), getPlanLimits: jest.fn() },
}));
const mockUpdate = jest.fn();
jest.mock("@/lib/billing/polar-client", () => ({ createPolarClient: () => ({ subscriptions: { update: mockUpdate } }) }));
const mockCountSeats = jest.fn();
jest.mock("@/lib/billing/member-seats", () => ({
  ...jest.requireActual("@/lib/billing/member-seats"),
  countSeatsInUse: () => mockCountSeats(),
}));
jest.mock("@/lib/audit-log", () => ({ createAuditLog: jest.fn() }));
const mockReturning = jest.fn(async () => [{ id: "org" }]);
const mockSet = jest.fn(() => ({ where: jest.fn(() => ({ returning: mockReturning })) }));
jest.mock("@/utils/db", () => ({
  db: { query: { organization: { findFirst: jest.fn() } }, update: jest.fn(() => ({ set: mockSet })) },
}));

import { POST } from "./route";
import { db } from "@/utils/db";
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { subscriptionService } from "@/lib/services/subscription-service";
import { createAuditLog } from "@/lib/audit-log";

const ORG = "0190a6a0-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a6a0-0000-7000-8000-000000000002";

function post(body: unknown, origin = "https://app.supercheck.io") {
  return POST(new NextRequest("https://app.supercheck.io/api/billing/members", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/billing/members", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockImpersonation.mockResolvedValue("none");
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "user-1", organizationId: ORG, isCliAuth: false });
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_admin");
    (subscriptionService.getSubscriptionAccessStatus as jest.Mock).mockResolvedValue({ isActive: true, plan: "pro", status: "active" });
    (subscriptionService.getPlanLimits as jest.Mock).mockResolvedValue({ plan: "pro", maxTeamMembers: 25 });
    (db.query.organization.findFirst as jest.Mock).mockResolvedValue({ id: ORG, subscriptionId: "sub_1", memberUnits: 25 });
    mockCountSeats.mockResolvedValue(20);
    mockUpdate.mockImplementation(async (_id: string, body: { units: number }) => ({ id: "sub_1", units: body.units }));
  });

  it("buys seats through the provider, stores what it reports, and audits the change", async () => {
    const response = await post({ organizationId: ORG, totalMembers: 28 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ included: 25, purchasedSeats: 28, limit: 28, used: 20, extraMemberPriceCents: 800 });
    expect(mockUpdate).toHaveBeenCalledWith("sub_1", { units: 28, proration_behavior: "invoice" });
    expect(mockSet).toHaveBeenCalledWith({ memberUnits: 28 });
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG, userId: "user-1", action: "billing_member_seats_updated",
      details: expect.objectContaining({ changes: { memberSeats: { before: 25, after: 28 } } }),
    }));
  });

  it("lets the owner lower seats down to the members in use", async () => {
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_owner");
    (db.query.organization.findFirst as jest.Mock).mockResolvedValue({ id: ORG, subscriptionId: "sub_1", memberUnits: 40 });
    mockCountSeats.mockResolvedValue(30);
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("sub_1", { units: 30, proration_behavior: "invoice" });
  });

  it("does not call the provider when the seats are unchanged", async () => {
    const response = await post({ organizationId: ORG, totalMembers: 25 });
    expect(response.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each(["project_admin", "project_editor", "project_viewer", null])("refuses role %s", async (role) => {
    (getUserOrgRole as jest.Mock).mockResolvedValue(role);
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses CLI tokens, impersonation, and cross-site requests", async () => {
    (requireUserAuthContext as jest.Mock).mockResolvedValueOnce({ userId: "user-1", organizationId: ORG, isCliAuth: true });
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(403);
    mockImpersonation.mockResolvedValueOnce("impersonated");
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(403);
    mockImpersonation.mockResolvedValueOnce("unknown");
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(503);
    expect((await post({ organizationId: ORG, totalMembers: 30 }, "https://evil.example")).status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each([24, 1001, 25.5, "30", null])("rejects totalMembers %p", async (totalMembers) => {
    expect((await post({ organizationId: ORG, totalMembers })).status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a request for another organization than the active one", async () => {
    expect((await post({ organizationId: OTHER_ORG, totalMembers: 30 })).status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each([
    [{ isActive: true, plan: "plus", status: "active" }],
    [{ isActive: false, plan: "pro", status: "none" }],
  ])("refuses seats outside an active Pro plan (%j)", async (access) => {
    (subscriptionService.getSubscriptionAccessStatus as jest.Mock).mockResolvedValue(access);
    const response = await post({ organizationId: ORG, totalMembers: 30 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Pro plan");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses fewer seats than members plus pending invitations", async () => {
    mockCountSeats.mockResolvedValue(31);
    const response = await post({ organizationId: ORG, totalMembers: 30 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("at least 31");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each([
    [402, 402, "payment method"],
    [403, 409, "right now"],
    [409, 409, "already pending"],
    [422, 409, "Contact support"],
    [500, 502, "Try again later"],
  ])("maps a provider %s to %s without storing seats", async (statusCode, status, message) => {
    mockUpdate.mockRejectedValue(Object.assign(new Error("provider detail"), { statusCode }));
    const response = await post({ organizationId: ORG, totalMembers: 30 });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).toContain(message);
    expect(body.error).not.toContain("provider detail");
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("fails cleanly when the subscription has no seat price", async () => {
    mockUpdate.mockResolvedValue({ id: "sub_1", units: null });
    const response = await post({ organizationId: ORG, totalMembers: 30 });
    expect(response.status).toBe(409);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("does not report success when the subscription was replaced while saving", async () => {
    mockReturning.mockResolvedValueOnce([]);
    const response = await post({ organizationId: ORG, totalMembers: 30 });
    expect(response.status).toBe(409);
    // The provider already changed the subscription, so the change is still audited.
    expect(createAuditLog).toHaveBeenCalled();
  });

  it("reports success when the provider changed seats but the local write failed", async () => {
    mockReturning.mockRejectedValueOnce(new Error("db down"));
    const response = await post({ organizationId: ORG, totalMembers: 30 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ purchasedSeats: 30, pending: true });
    expect(createAuditLog).toHaveBeenCalled();
  });

  it("requires an active organization", async () => {
    (requireUserAuthContext as jest.Mock).mockResolvedValueOnce({ userId: "user-1", organizationId: null, isCliAuth: false });
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(400);
  });

  it("refuses seat changes when cloud billing is off", async () => {
    const { isPolarEnabled } = jest.requireMock("@/lib/feature-flags");
    isPolarEnabled.mockReturnValueOnce(false);
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("maps auth failures and unexpected errors", async () => {
    const { isAuthError } = jest.requireMock("@/lib/auth-context");
    (requireUserAuthContext as jest.Mock).mockRejectedValueOnce(new Error("Authentication required"));
    isAuthError.mockReturnValueOnce(true);
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(401);
    (requireUserAuthContext as jest.Mock).mockRejectedValueOnce(new Error("boom"));
    const response = await post({ organizationId: ORG, totalMembers: 30 });
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("Failed to change member seats");
  });

  it("refuses an organization without a bound subscription", async () => {
    (db.query.organization.findFirst as jest.Mock).mockResolvedValue({ id: ORG, subscriptionId: null, memberUnits: null });
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
