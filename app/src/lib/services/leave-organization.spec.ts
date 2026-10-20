/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";
import { member, projectMembers, session } from "@/db/schema";
import { db } from "@/utils/db";
import { requireUserAuthContext } from "@/lib/auth-context";
import { clearRequestCache } from "@/lib/session-cache";
import { logAuditEvent } from "@/lib/audit-logger";
import { leaveOrganization } from "./leave-organization";
jest.mock("@/utils/db", () => ({ db: { transaction: jest.fn() } }));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn() }));
jest.mock("@/lib/session-cache", () => ({ clearRequestCache: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
const lock = jest.fn();
const deleteWhere = jest.fn();
const updateWhere = jest.fn();
const set = jest.fn(() => ({ where: updateWhere }));
const tx = { select: jest.fn(), delete: jest.fn(() => ({ where: deleteWhere })), update: jest.fn(() => ({ set })) };
let memberships: { id: string; role: string }[];
let orgProjects: { id: string }[];
const sql = (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(condition);
beforeEach(() => {
  jest.clearAllMocks();
  memberships = [{ id: "membership-1", role: "project_viewer" }];
  orgProjects = [{ id: "project-1" }, { id: "project-2" }];
  lock.mockImplementation(async () => memberships);
  tx.select.mockImplementation(() => ({ from: (table: unknown) => ({ where: () => table === member ? { for: lock } : Promise.resolve(orgProjects) }) }));
  (db.transaction as jest.Mock).mockImplementation(async fn => fn(tx));
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "user-1", organizationId: "org-1", isCliAuth: false });
});
it.each(["project_viewer", "project_editor", "project_admin", "org_admin"])("lets %s leave while scoping cleanup to their organization", async role => {
  memberships[0].role = role;
  expect(await leaveOrganization("org-1")).toEqual({ organizationId: "org-1" });
  expect(lock).toHaveBeenCalledWith("update");
  expect(tx.delete).toHaveBeenNthCalledWith(1, projectMembers);
  expect(sql(deleteWhere.mock.calls[0][0]).params).toEqual(["user-1", "project-1", "project-2"]);
  expect(tx.delete).toHaveBeenNthCalledWith(2, member);
  expect(sql(deleteWhere.mock.calls[1][0]).params).toEqual(["membership-1"]);
  expect(tx.update).toHaveBeenCalledWith(session);
  expect(set).toHaveBeenCalledWith({ activeOrganizationId: null, activeProjectId: null, updatedAt: expect.any(Date) });
  const query = sql(updateWhere.mock.calls[0][0]);
  expect(query.params).toEqual(["user-1", "org-1", "project-1", "project-2"]);
  expect(query.sql).toContain('"active_organization_id"');
  expect(query.sql).toContain('"active_project_id"');
  expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "member_left", organizationId: "org-1", userId: "user-1" }), tx);
  expect(clearRequestCache).toHaveBeenCalledTimes(1);
});
it("allows leaving an organization with no projects", async () => {
  orgProjects = [];
  await leaveOrganization("org-1");
  expect(tx.delete).toHaveBeenCalledTimes(1);
  expect(sql(updateWhere.mock.calls[0][0]).params).toEqual(["user-1", "org-1"]);
});
it("rejects an owner before any destructive operation", async () => {
  memberships[0].role = "org_owner";
  await expect(leaveOrganization("org-1")).rejects.toMatchObject({ status: 403 });
  expect(tx.delete).not.toHaveBeenCalled();
  expect(tx.update).not.toHaveBeenCalled();
  expect(clearRequestCache).not.toHaveBeenCalled();
});
it("rejects absent membership", async () => {
  memberships = [];
  await expect(leaveOrganization("org-1")).rejects.toMatchObject({ status: 404 });
  expect(tx.delete).not.toHaveBeenCalled();
});
it("rejects CLI tokens before a transaction", async () => {
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ isCliAuth: true });
  await expect(leaveOrganization("org-1")).rejects.toMatchObject({ status: 403 });
  expect(db.transaction).not.toHaveBeenCalled();
});
it("rejects unauthenticated callers", async () => {
  (requireUserAuthContext as jest.Mock).mockRejectedValue(new Error("Authentication required"));
  await expect(leaveOrganization("org-1")).rejects.toThrow("Authentication required");
  expect(db.transaction).not.toHaveBeenCalled();
});
it("rejects a missing active organization", async () => {
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "user-1", organizationId: null, isCliAuth: false });
  await expect(leaveOrganization("org-1")).rejects.toMatchObject({ status: 400 });
});
it("does not clear state or report success when cleanup fails", async () => {
  updateWhere.mockRejectedValueOnce(new Error("database failure"));
  await expect(leaveOrganization("org-1")).rejects.toThrow("database failure");
  expect(clearRequestCache).not.toHaveBeenCalled();
  expect(logAuditEvent).not.toHaveBeenCalled();
});

it("rejects a stale confirmation if the session switched organizations", async () => {
  await expect(leaveOrganization("org-other")).rejects.toMatchObject({ status: 409 });
  expect(db.transaction).not.toHaveBeenCalled();
});
