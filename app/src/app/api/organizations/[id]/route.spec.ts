/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn(), isImpersonatedSession: jest.fn(async () => false) }));
jest.mock("@/lib/session-security", () => ({ checkAdminRateLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock("@/utils/db", () => ({ db: { transaction: jest.fn() } }));
jest.mock("@/lib/organization-teardown", () => {
  class BillingCancellationError extends Error {}
  class OrganizationMembershipChangedError extends Error {}
  class StorageCleanupError extends Error {}
  return { BillingCancellationError, OrganizationMembershipChangedError, StorageCleanupError, deleteOrganizationCompletely: jest.fn() };
});
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole, isImpersonatedSession } from "@/lib/rbac/middleware";
import { deleteOrganizationCompletely } from "@/lib/organization-teardown";
import { DELETE } from "./route";

const ORG_ID = "267cc333-3242-5fc2-821c-51a1a17b9580";
const params = { params: Promise.resolve({ id: ORG_ID }) };
const del = (body: unknown = { confirmOrganizationId: ORG_ID }, origin = "https://app.supercheck.io") =>
  DELETE(new NextRequest(`https://app.supercheck.io/api/organizations/${ORG_ID}`, { method: "DELETE", headers: { origin }, body: JSON.stringify(body) }), params);
const errors = jest.requireMock("@/lib/organization-teardown") as Record<string, new (m: string) => Error>;

describe("owner organization deletion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "owner", isCliAuth: false });
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_owner");
    (deleteOrganizationCompletely as jest.Mock).mockResolvedValue({ subscriptionCancelled: true });
  });

  it("tears the organization down for its owner, rechecking ownership under the lock", async () => {
    expect((await del()).status).toBe(200);
    expect(deleteOrganizationCompletely).toHaveBeenCalledWith(ORG_ID, { ownerUserId: "owner" }, "owner");
  });

  it("requires the organization to be confirmed", async () => {
    expect((await del({})).status).toBe(400);
    expect((await del(null)).status).toBe(400);
    expect(deleteOrganizationCompletely).not.toHaveBeenCalled();
  });

  it("refuses non-owners, cross-origin requests, CLI tokens and impersonated sessions", async () => {
    (getUserOrgRole as jest.Mock).mockResolvedValueOnce("org_admin");
    expect((await del()).status).toBe(403);
    expect((await del(undefined, "https://foreign.example")).status).toBe(403);
    (requireUserAuthContext as jest.Mock).mockResolvedValueOnce({ userId: "owner", isCliAuth: true });
    expect((await del()).status).toBe(403);
    (isImpersonatedSession as jest.Mock).mockResolvedValueOnce(true);
    expect((await del()).status).toBe(403);
    expect(deleteOrganizationCompletely).not.toHaveBeenCalled();
  });

  it.each([
    ["OrganizationMembershipChangedError", 403],
    ["BillingCancellationError", 502],
    ["StorageCleanupError", 502],
  ])("maps %s to %i", async (name, status) => {
    (deleteOrganizationCompletely as jest.Mock).mockRejectedValueOnce(new errors[name]("x"));
    expect((await del()).status).toBe(status);
  });

  it("answers 409 when the organization row is busy (lock timeout)", async () => {
    (deleteOrganizationCompletely as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("lock"), { code: "55P03" }));
    expect((await del()).status).toBe(409);
  });
});
