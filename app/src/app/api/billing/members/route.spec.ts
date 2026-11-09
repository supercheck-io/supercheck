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
const mockGet = jest.fn();
jest.mock("@/lib/billing/polar-client", () => ({ createPolarClient: () => ({ subscriptions: { update: mockUpdate, get: mockGet } }) }));
const mockCountSeats = jest.fn();
jest.mock("@/lib/billing/member-seats", () => ({
  ...jest.requireActual("@/lib/billing/member-seats"),
  countSeatsInUse: () => mockCountSeats(),
}));
jest.mock("@/lib/audit-log", () => ({ createAuditLog: jest.fn() }));
jest.mock("drizzle-orm", () => ({
  ...jest.requireActual("drizzle-orm"),
  eq: (column: { name?: string }, value: unknown) => ({ eq: [column?.name, value] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
}));
const mockOrgRow = jest.fn();
const mockWhere = jest.fn();
const mockSet = jest.fn(() => ({ where: mockWhere }));
const mockTx = {
  select: () => ({ from: () => ({ where: () => ({ for: () => mockOrgRow() }) }) }),
  update: () => ({ set: mockSet }),
};
const mockLock = jest.fn();
jest.mock("@/lib/middleware/plan-limit-lock", () => {
  class PlanLimitBusyError extends Error {}
  return {
    PlanLimitBusyError,
    withPlanLimitLock: (...args: unknown[]) => mockLock(...args),
  };
});

import { POST } from "./route";
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { subscriptionService } from "@/lib/services/subscription-service";
import { createAuditLog } from "@/lib/audit-log";

const ORG = "0190a6a0-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a6a0-0000-7000-8000-000000000002";

// The seat total the dialog previewed from; tests whose live seats differ pass it explicitly.
function post(body: unknown, origin = "https://app.supercheck.io") {
  const withExpected = body && typeof body === "object" && !("expectedCurrentMembers" in body)
    ? { ...body, expectedCurrentMembers: 25 } : body;
  return POST(new NextRequest("https://app.supercheck.io/api/billing/members", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(withExpected),
  }));
}

describe("POST /api/billing/members", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockImpersonation.mockResolvedValue("none");
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "user-1", organizationId: ORG, isCliAuth: false });
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_owner");
    (subscriptionService.getSubscriptionAccessStatus as jest.Mock).mockResolvedValue({ isActive: true, plan: "pro", status: "active" });
    (subscriptionService.getPlanLimits as jest.Mock).mockResolvedValue({ plan: "pro", maxTeamMembers: 25 });
    mockOrgRow.mockResolvedValue([{ subscriptionId: "sub_1", memberUnits: 25 }]);
    mockGet.mockResolvedValue({ id: "sub_1", units: 25, modified_at: "2026-11-01T00:00:00Z" });
    mockWhere.mockResolvedValue(undefined);
    mockLock.mockImplementation(async (_org: string, _resource: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));
    mockCountSeats.mockResolvedValue(20);
    mockUpdate.mockImplementation(async (_id: string, body: { units: number }) => ({ id: "sub_1", units: body.units, modified_at: "2026-11-09T10:00:00Z" }));
  });

  it("buys seats under the members lock, stores what the provider reports, and audits the change", async () => {
    const response = await post({ organizationId: ORG, totalMembers: 28 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ included: 25, purchasedSeats: 28, limit: 28, used: 20, extraMemberPriceCents: 800 });
    expect(mockLock).toHaveBeenCalledWith(ORG, "members", expect.any(Function));
    expect(mockUpdate).toHaveBeenCalledWith("sub_1", { units: 28, proration_behavior: "invoice" });
    // The ordering marker moves to the changed subscription version, so older events can't restore the old seats.
    expect(mockSet).toHaveBeenCalledWith({
      memberUnits: 28,
      polarWebhookTimestamp: new Date("2026-11-09T10:00:00Z"),
      polarWebhookEventKey: "seats:sub_1:2026-11-09T10:00:00.000Z",
    });
    // The write stays bound to the subscription that was changed.
    expect(mockWhere).toHaveBeenCalledWith({ and: [{ eq: ["id", ORG] }, { eq: ["subscription_id", "sub_1"] }] });
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG, userId: "user-1", action: "billing_member_seats_updated",
      details: expect.objectContaining({ changes: { memberSeats: { before: 25, after: 28 } } }),
    }));
  });

  it("lowers seats down to the members in use, crediting the next invoice", async () => {
    mockGet.mockResolvedValue({ id: "sub_1", units: 40 });
    mockCountSeats.mockResolvedValue(30);
    expect((await post({ organizationId: ORG, totalMembers: 30, expectedCurrentMembers: 40 })).status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("sub_1", { units: 30, proration_behavior: "prorate" });
  });

  it("accepts the member maximum and charges an increase now even when no seats were stored locally", async () => {
    mockOrgRow.mockResolvedValue([{ subscriptionId: "sub_1", memberUnits: null }]);
    expect((await post({ organizationId: ORG, totalMembers: 100 })).status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("sub_1", { units: 100, proration_behavior: "invoice" });
  });

  it("compares with the provider's live seats, not a stale local copy", async () => {
    // A previous increase reached the provider, but the local copy still says 25.
    mockGet.mockResolvedValue({ id: "sub_1", units: 30 });
    expect((await post({ organizationId: ORG, totalMembers: 25, expectedCurrentMembers: 30 })).status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("sub_1", { units: 25, proration_behavior: "prorate" });
  });

  it("refuses a change previewed from a seat count that is no longer current", async () => {
    // The dialog showed 40 seats and previewed 30 as a credit, but another change already lowered them to 25.
    mockGet.mockResolvedValue({ id: "sub_1", units: 25 });
    const response = await post({ organizationId: ORG, totalMembers: 30, expectedCurrentMembers: 40 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "seats_changed" });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("stores the live seats when refusing a stale preview, so the refresh shows them", async () => {
    // A change reached the provider (30 seats) but its local write failed; the dialog still shows 25.
    mockGet.mockResolvedValue({ id: "sub_1", units: 30, modified_at: "2026-11-05T00:00:00Z" });
    const response = await post({ organizationId: ORG, totalMembers: 28, expectedCurrentMembers: 25 });
    expect(response.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith({
      memberUnits: 30,
      polarWebhookTimestamp: new Date("2026-11-05T00:00:00Z"),
      polarWebhookEventKey: "seats:sub_1:2026-11-05T00:00:00.000Z",
    });
  });

  it("does not move the ordering marker backwards", async () => {
    mockOrgRow.mockResolvedValue([{ subscriptionId: "sub_1", memberUnits: 25, polarWebhookTimestamp: new Date("2026-12-01T00:00:00Z") }]);
    expect((await post({ organizationId: ORG, totalMembers: 28 })).status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith({ memberUnits: 28 });
  });

  it("does not change the provider when the seats are unchanged, but repairs a stale local copy", async () => {
    mockOrgRow.mockResolvedValue([{ subscriptionId: "sub_1", memberUnits: null }]);
    const response = await post({ organizationId: ORG, totalMembers: 25 });
    expect(response.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ memberUnits: 25 }));
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it.each(["org_admin", "project_admin", "project_editor", "project_viewer", null])("refuses role %s", async (role) => {
    (getUserOrgRole as jest.Mock).mockResolvedValue(role);
    const response = await post({ organizationId: ORG, totalMembers: 30 });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("Only the organization owner can change member seats");
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

  it.each([24, 101, 25.5, "30", null])("rejects totalMembers %p", async (totalMembers) => {
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
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("maps a failed lookup of the live seats without changing anything", async () => {
    mockGet.mockRejectedValue(Object.assign(new Error("provider detail"), { statusCode: 404 }));
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("fails cleanly before charging when the subscription has no seat price", async () => {
    mockGet.mockResolvedValue({ id: "sub_1", units: null });
    const response = await post({ organizationId: ORG, totalMembers: 30 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Contact support");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("asks to retry while another member change holds the lock", async () => {
    const { PlanLimitBusyError } = jest.requireMock("@/lib/middleware/plan-limit-lock");
    mockLock.mockRejectedValueOnce(new PlanLimitBusyError());
    const response = await post({ organizationId: ORG, totalMembers: 30 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("in progress");
  });

  it("reports a pending success and audits when the provider changed seats but the local write failed", async () => {
    mockWhere.mockRejectedValueOnce(new Error("db down"));
    const response = await post({ organizationId: ORG, totalMembers: 30 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ purchasedSeats: 30, pending: true });
    expect(createAuditLog).toHaveBeenCalled();
  });

  it("rethrows a failure before the provider changed anything", async () => {
    mockOrgRow.mockRejectedValueOnce(new Error("db down"));
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(500);
    expect(createAuditLog).not.toHaveBeenCalled();
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
    mockOrgRow.mockResolvedValue([{ subscriptionId: null, memberUnits: null }]);
    expect((await post({ organizationId: ORG, totalMembers: 30 })).status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
