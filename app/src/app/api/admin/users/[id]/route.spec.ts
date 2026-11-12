/** @jest-environment node */
jest.mock("@/lib/admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/utils/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers()) }));
jest.mock("@/lib/audit-logger", () => ({ logAdminEvent: jest.fn(), logImpersonationEvent: jest.fn() }));
jest.mock("@/lib/session-security", () => ({ checkAdminRateLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock("@/lib/rbac/middleware", () => ({ isImpersonatedSession: jest.fn(async () => false) }));
import { isImpersonatedSession } from "@/lib/rbac/middleware";
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), transaction: jest.fn(), update: jest.fn() } }));
jest.mock("@/lib/user-avatar", () => ({ pruneAvatars: jest.fn() }));
jest.mock("@/lib/deletion/org-state");
jest.mock("@/lib/deletion/organization", () => {
  class OrganizationMembershipChangedError extends Error {}
  return { OrganizationMembershipChangedError, requestOrganizationDeletion: jest.fn(), soleMemberOrganizations: jest.fn(async () => []) };
});
import { requestOrganizationDeletion, soleMemberOrganizations } from "@/lib/deletion/organization";
import { readOrgPendingOn } from "@/lib/deletion/org-state";
import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { getCurrentUser } from "@/lib/session";
import { logAdminEvent } from "@/lib/audit-logger";
import { pruneAvatars } from "@/lib/user-avatar";
import { DELETE, POST, PUT } from "./route";
beforeEach(() => {
  jest.clearAllMocks();
  (readOrgPendingOn as jest.Mock).mockResolvedValue(true); // organizations this request scheduled are still pending
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: "admin" });
  (db.select as jest.Mock).mockReset()
    .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ id: "0c11ab1e-7460-5139-b3b8-920f69f95082", email: "target@example.test" }] }) }) })
    .mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) }); // no sole-owned organizations
  const tx = {
    delete: () => ({ where: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  (db.transaction as jest.Mock).mockImplementation(async (fn) => fn(tx));
});
it("records the administrator and deleted account inside the deletion transaction", async () => {
  const response = await DELETE(new NextRequest("http://localhost/api/admin/users/target"), { params: Promise.resolve({ id: "0c11ab1e-7460-5139-b3b8-920f69f95082" }) });
  expect(response.status).toBe(200);
  // The audit row is written through the transaction handle, not the shared pool.
  expect(pruneAvatars).toHaveBeenCalledWith("0c11ab1e-7460-5139-b3b8-920f69f95082", null, 0);
  expect(logAdminEvent).toHaveBeenCalledWith("admin", "user_deleted", "0c11ab1e-7460-5139-b3b8-920f69f95082", "user", "0c11ab1e-7460-5139-b3b8-920f69f95082", { targetEmail: "target@example.test" }, expect.objectContaining({ delete: expect.any(Function) }));
});
it("does not claim deletion when the transaction fails", async () => {
  (db.transaction as jest.Mock).mockRejectedValue(new Error("rollback"));
  const response = await DELETE(new NextRequest("http://localhost/api/admin/users/target"), { params: Promise.resolve({ id: "0c11ab1e-7460-5139-b3b8-920f69f95082" }) });
  expect(response.status).toBe(500);
  expect(logAdminEvent).not.toHaveBeenCalled();
  expect(pruneAvatars).not.toHaveBeenCalled();
});

it("blocks deleting a user who is the only owner of an organization that has other members", async () => {
  (db.select as jest.Mock).mockReset()
    .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ id: "0c11ab1e-7460-5139-b3b8-920f69f95082", email: "target@example.test" }] }) }) })
    .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ organizationId: "org-1" }] }) }) });
  const response = await DELETE(new NextRequest("http://localhost/api/admin/users/target"), { params: Promise.resolve({ id: "0c11ab1e-7460-5139-b3b8-920f69f95082" }) });
  expect(response.status).toBe(409);
  expect(db.transaction).not.toHaveBeenCalled();
});

it("refuses to impersonate from an already impersonated session", async () => {
  jest.mocked(isImpersonatedSession).mockResolvedValueOnce(true);
  const request = new NextRequest("http://localhost/api/admin/users/target", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "impersonate" }),
  });
  const response = await POST(request, { params: Promise.resolve({ id: "0c11ab1e-7460-5139-b3b8-920f69f95082" }) });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("Stop the current impersonation first");
  expect(db.select).not.toHaveBeenCalled();
});

it("refuses when a concurrent request already turned the session into an impersonation", async () => {
  const { auth } = jest.requireMock("@/utils/auth") as { auth: { api: { getSession: jest.Mock } } };
  auth.api.getSession.mockResolvedValueOnce({ session: { id: "s1", token: "t1" }, user: { id: "admin" } });
  const update = { set: () => update, where: () => update, returning: async () => [] };
  (db.update as jest.Mock).mockReturnValueOnce(update);
  const request = new NextRequest("http://localhost/api/admin/users/target", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "impersonate" }),
  });
  const response = await POST(request, { params: Promise.resolve({ id: "0c11ab1e-7460-5139-b3b8-920f69f95082" }) });
  expect(response.status).toBe(400);
  const { logImpersonationEvent } = jest.requireMock("@/lib/audit-logger") as { logImpersonationEvent: jest.Mock };
  expect(logImpersonationEvent).not.toHaveBeenCalled();
});

describe("organizations where the user is the only member", () => {
  const ID = "0c11ab1e-7460-5139-b3b8-920f69f95082";
  const org = { id: "org-solo", name: "Solo", hasActiveSubscription: true, alreadyPending: false };
  const del = (body?: unknown) =>
    DELETE(new NextRequest("http://localhost/api/admin/users/target", { method: "DELETE", body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ id: ID }) });
  beforeEach(() => jest.mocked(soleMemberOrganizations).mockResolvedValue([org]));

  it("asks for confirmation listing the organizations, deleting nothing", async () => {
    const response = await del();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "confirm_organization_deletion", organizations: [org] });
    expect(requestOrganizationDeletion).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects a confirmation for a different set of organizations", async () => {
    expect((await del({ confirmDeleteOrganizationIds: ["org-other"] })).status).toBe(409);
    expect(requestOrganizationDeletion).not.toHaveBeenCalled();
  });

  it("schedules the confirmed organizations for deletion (pending window), then deletes the user", async () => {
    jest.mocked(requestOrganizationDeletion).mockResolvedValue({ status: "requested", purgeAfter: new Date("2026-12-01T00:00:00Z"), deletionId: "d", billing: "none" });
    const response = await del({ confirmDeleteOrganizationIds: ["org-solo"] });
    expect(response.status).toBe(200);
    expect(requestOrganizationDeletion).toHaveBeenCalledWith({ organizationId: "org-solo", actorUserId: "admin", guard: { onlyMemberUserId: ID }, reason: "account_deletion" });
    expect(logAdminEvent).toHaveBeenCalledWith("admin", "organization_deletion_requested", "org-solo", "organization", "org-solo", expect.objectContaining({ reason: "sole_member_user_deleted" }));
    expect(db.transaction).toHaveBeenCalled();
  });

  it("keeps the user when an organization it scheduled was cancelled before the user is deleted", async () => {
    jest.mocked(requestOrganizationDeletion).mockResolvedValue({ status: "requested", purgeAfter: new Date("2026-12-01T00:00:00Z"), deletionId: "d", billing: "none" });
    (readOrgPendingOn as jest.Mock).mockResolvedValue(false);
    const response = await del({ confirmDeleteOrganizationIds: ["org-solo"] });
    expect(response.status).toBe(409);
    expect(logAdminEvent).not.toHaveBeenCalledWith("admin", "user_deleted", expect.anything(), "user", expect.anything(), expect.anything(), expect.anything());
  });

  it("refuses from an impersonated session", async () => {
    jest.mocked(isImpersonatedSession).mockResolvedValueOnce(true);
    expect((await del({ confirmDeleteOrganizationIds: ["org-solo"] })).status).toBe(403);
    expect(requestOrganizationDeletion).not.toHaveBeenCalled();
  });

  it("asks again when the organization gained a member after confirmation", async () => {
    const { OrganizationMembershipChangedError } = jest.requireMock("@/lib/deletion/organization") as { OrganizationMembershipChangedError: new (m: string) => Error };
    jest.mocked(requestOrganizationDeletion).mockRejectedValue(new OrganizationMembershipChangedError("changed"));
    const response = await del({ confirmDeleteOrganizationIds: ["org-solo"] });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("confirm_organization_deletion");
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe("PUT validation and audit", () => {
  const put = (body: unknown) => PUT(new NextRequest("http://localhost/api/admin/users/target", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "0c11ab1e-7460-5139-b3b8-920f69f95082" }) });
  beforeEach(() => {
    (db.select as jest.Mock).mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ name: "T", email: "t@example.test", role: null }] }) }) });
    (db as unknown as { update: jest.Mock }).update = jest.fn(() => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "0c11ab1e-7460-5139-b3b8-920f69f95082", role: "super_admin" }] }) }) }));
  });
  it.each([{ role: "owner" }, { admin: true }, {}, { email: "nope" }])("rejects invalid update %j", async (body) => {
    expect((await put(body)).status).toBe(400);
    expect(logAdminEvent).not.toHaveBeenCalled();
  });
  it("rejects self-demotion", async () => {
    const response = await PUT(new NextRequest("http://localhost/api/admin/users/admin", { method: "PUT", body: JSON.stringify({ role: "project_viewer" }) }), { params: Promise.resolve({ id: "admin" }) });
    expect(response.status).toBe(400);
    expect(logAdminEvent).not.toHaveBeenCalled();
  });
  describe("demoting a super admin", () => {
    const demote = () => put({ role: "project_viewer" });
    const withAdmins = (ids: string[]) => {
      const tx = {
        select: () => ({ from: () => ({ where: () => ({ for: async () => ids.map((id) => ({ id })) }) }) }),
        update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "0c11ab1e-7460-5139-b3b8-920f69f95082", role: "project_viewer" }] }) }) }),
      };
      (db.transaction as jest.Mock).mockReset().mockImplementation(async (fn) => fn(tx));
      (db.select as jest.Mock).mockReset().mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ name: "T", email: "t@example.test", role: "super_admin" }] }) }) });
    };
    it("refuses to demote the last super admin", async () => {
      withAdmins(["0c11ab1e-7460-5139-b3b8-920f69f95082"]);
      expect((await demote()).status).toBe(409);
      expect(logAdminEvent).not.toHaveBeenCalled();
    });
    it("allows it while another super admin remains", async () => {
      withAdmins(["0c11ab1e-7460-5139-b3b8-920f69f95082", "admin"]);
      (db as unknown as { delete: jest.Mock }).delete = jest.fn(() => ({ where: async () => undefined }));
      expect((await demote()).status).toBe(200);
    });
  });
  it("audits a super-admin grant", async () => {
    expect((await put({ role: "super_admin" })).status).toBe(200);
    expect(logAdminEvent).toHaveBeenCalledWith("admin", "user_updated", "0c11ab1e-7460-5139-b3b8-920f69f95082", "user", "0c11ab1e-7460-5139-b3b8-920f69f95082", { changedFields: ["role"], previousRole: null, newRole: "super_admin" });
  });
});
