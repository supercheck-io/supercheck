/** @jest-environment node */
jest.mock("@/lib/admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/utils/auth", () => ({ auth: {} }));
jest.mock("@/lib/audit-logger", () => ({ logAdminEvent: jest.fn(), logImpersonationEvent: jest.fn() }));
jest.mock("@/lib/session-security", () => ({ checkAdminRateLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock("@/lib/rbac/middleware", () => ({ isImpersonatedSession: jest.fn(async () => false) }));
import { isImpersonatedSession } from "@/lib/rbac/middleware";
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), transaction: jest.fn() } }));
jest.mock("@/lib/user-avatar", () => ({ pruneAvatars: jest.fn() }));
jest.mock("@/lib/organization-teardown", () => {
  class BillingCancellationError extends Error {}
  class OrganizationMembershipChangedError extends Error {}
  class StorageCleanupError extends Error {}
  return { BillingCancellationError, OrganizationMembershipChangedError, StorageCleanupError, deleteOrganizationCompletely: jest.fn(), soleMemberOrganizations: jest.fn(async () => []) };
});
import { BillingCancellationError, deleteOrganizationCompletely, soleMemberOrganizations } from "@/lib/organization-teardown";
import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { getCurrentUser } from "@/lib/session";
import { logAdminEvent } from "@/lib/audit-logger";
import { pruneAvatars } from "@/lib/user-avatar";
import { DELETE, PUT } from "./route";
beforeEach(() => {
  jest.clearAllMocks();
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

describe("organizations where the user is the only member", () => {
  const ID = "0c11ab1e-7460-5139-b3b8-920f69f95082";
  const org = { id: "org-solo", name: "Solo", hasActiveSubscription: true };
  const del = (body?: unknown) =>
    DELETE(new NextRequest("http://localhost/api/admin/users/target", { method: "DELETE", body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ id: ID }) });
  beforeEach(() => jest.mocked(soleMemberOrganizations).mockResolvedValue([org]));

  it("asks for confirmation listing the organizations, deleting nothing", async () => {
    const response = await del();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "confirm_organization_deletion", organizations: [org] });
    expect(deleteOrganizationCompletely).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects a confirmation for a different set of organizations", async () => {
    expect((await del({ confirmDeleteOrganizationIds: ["org-other"] })).status).toBe(409);
    expect(deleteOrganizationCompletely).not.toHaveBeenCalled();
  });

  it("deletes the confirmed organizations, then the user", async () => {
    jest.mocked(deleteOrganizationCompletely).mockResolvedValue({ subscriptionCancelled: true });
    const response = await del({ confirmDeleteOrganizationIds: ["org-solo"] });
    expect(response.status).toBe(200);
    expect(deleteOrganizationCompletely).toHaveBeenCalledWith("org-solo", { onlyMemberUserId: ID }, "admin");
    expect(logAdminEvent).toHaveBeenCalledWith("admin", "organization_deleted", "org-solo", "organization", "org-solo", expect.objectContaining({ reason: "sole_member_user_deleted" }));
    expect(db.transaction).toHaveBeenCalled();
  });

  it("refuses from an impersonated session", async () => {
    jest.mocked(isImpersonatedSession).mockResolvedValueOnce(true);
    expect((await del({ confirmDeleteOrganizationIds: ["org-solo"] })).status).toBe(403);
    expect(deleteOrganizationCompletely).not.toHaveBeenCalled();
  });

  it("asks again when the organization gained a member after confirmation", async () => {
    const { OrganizationMembershipChangedError } = jest.requireMock("@/lib/organization-teardown") as { OrganizationMembershipChangedError: new (m: string) => Error };
    jest.mocked(deleteOrganizationCompletely).mockRejectedValue(new OrganizationMembershipChangedError("changed"));
    const response = await del({ confirmDeleteOrganizationIds: ["org-solo"] });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("confirm_organization_deletion");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("keeps the user and reports nothing deleted when stored files cannot be removed", async () => {
    const { StorageCleanupError } = jest.requireMock("@/lib/organization-teardown") as { StorageCleanupError: new (m: string) => Error };
    jest.mocked(deleteOrganizationCompletely).mockRejectedValue(new StorageCleanupError("2 stored file(s) could not be removed"));
    const response = await del({ confirmDeleteOrganizationIds: ["org-solo"] });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ deletedOrganizationIds: [] });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("keeps the user when cancelling the subscription fails", async () => {
    jest.mocked(deleteOrganizationCompletely).mockRejectedValue(new BillingCancellationError("Could not cancel the subscription: down"));
    expect((await del({ confirmDeleteOrganizationIds: ["org-solo"] })).status).toBe(502);
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
