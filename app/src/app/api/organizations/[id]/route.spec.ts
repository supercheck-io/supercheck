/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn(), isImpersonatedSession: jest.fn(async () => false) }));
jest.mock("@/lib/session-security", () => ({ checkAdminRateLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock("@/utils/db", () => ({
  db: { select: jest.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [{ name: "Acme Corp" }] }) }) })) },
}));
jest.mock("@/lib/deletion/reauth", () => ({
  isFreshSession: jest.fn(async () => true),
  reauthRequiredResponse: jest.fn(() => new Response(JSON.stringify({ code: "REAUTH_REQUIRED" }), { status: 403 })),
}));
jest.mock("@/lib/deletion/organization", () => {
  class OrganizationMembershipChangedError extends Error {}
  return { OrganizationMembershipChangedError, requestOrganizationDeletion: jest.fn() };
});
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole, isImpersonatedSession } from "@/lib/rbac/middleware";
import { isFreshSession } from "@/lib/deletion/reauth";
import { requestOrganizationDeletion } from "@/lib/deletion/organization";
import { DELETE } from "./route";

const ORG_ID = "267cc333-3242-5fc2-821c-51a1a17b9580";
const params = { params: Promise.resolve({ id: ORG_ID }) };
const del = (body: unknown = { confirmName: "Acme Corp" }, origin = "https://app.supercheck.io") =>
  DELETE(new NextRequest(`https://app.supercheck.io/api/organizations/${ORG_ID}`, { method: "DELETE", headers: { origin }, body: JSON.stringify(body) }), params);
const errors = jest.requireMock("@/lib/deletion/organization") as Record<string, new (m: string) => Error>;

describe("owner organization deletion request", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "owner", isCliAuth: false });
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_owner");
    (isFreshSession as jest.Mock).mockResolvedValue(true);
    (requestOrganizationDeletion as jest.Mock).mockResolvedValue({ status: "requested", purgeAfter: new Date("2026-12-01T00:00:00Z"), billing: "cancelled" });
  });

  it("schedules the deletion for the owner (never an immediate teardown), rechecking ownership under the lock", async () => {
    const response = await del();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, status: "requested", billing: "cancelled" });
    expect(requestOrganizationDeletion).toHaveBeenCalledWith({ organizationId: ORG_ID, actorUserId: "owner", guard: { ownerUserId: "owner" }, reason: "owner" });
  });

  it("requires the exact organization name", async () => {
    for (const body of [{}, null, { confirmName: "acme corp" }, { confirmName: "Acme" }, { confirmOrganizationId: ORG_ID }]) {
      const response = await del(body);
      expect(response.status).toBe(400);
    }
    expect(requestOrganizationDeletion).not.toHaveBeenCalled();
  });

  it("asks for a fresh sign-in with a stable code when the session is old", async () => {
    (isFreshSession as jest.Mock).mockResolvedValueOnce(false);
    const response = await del();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(requestOrganizationDeletion).not.toHaveBeenCalled();
  });

  it("refuses non-owners, cross-origin requests, CLI tokens and impersonated sessions", async () => {
    (getUserOrgRole as jest.Mock).mockResolvedValueOnce("org_admin");
    expect((await del()).status).toBe(403);
    expect((await del(undefined, "https://foreign.example")).status).toBe(403);
    (requireUserAuthContext as jest.Mock).mockResolvedValueOnce({ userId: "owner", isCliAuth: true });
    expect((await del()).status).toBe(403);
    (isImpersonatedSession as jest.Mock).mockResolvedValueOnce(true);
    expect((await del()).status).toBe(403);
    expect(requestOrganizationDeletion).not.toHaveBeenCalled();
  });

  it("answers 404 to a non-member and 403 when the owner check fails under the lock", async () => {
    (getUserOrgRole as jest.Mock).mockResolvedValueOnce(null);
    expect((await del()).status).toBe(404);
    (requestOrganizationDeletion as jest.Mock).mockRejectedValueOnce(new errors.OrganizationMembershipChangedError("x"));
    expect((await del()).status).toBe(403);
  });

  it("returns 429 without requesting when the rate limit is exhausted", async () => {
    const { checkAdminRateLimit } = jest.requireMock("@/lib/session-security") as { checkAdminRateLimit: jest.Mock };
    checkAdminRateLimit.mockResolvedValueOnce({ allowed: false });
    expect((await del()).status).toBe(429);
    expect(requestOrganizationDeletion).not.toHaveBeenCalled();
  });

  it("answers 409 when the organization row is busy (lock timeout)", async () => {
    (requestOrganizationDeletion as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("lock"), { code: "55P03" }));
    expect((await del()).status).toBe(409);
  });
});
