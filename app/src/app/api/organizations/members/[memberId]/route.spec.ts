/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), transaction: jest.fn() } }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
import { PUT } from "./route";
import { db } from "@/utils/db";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { requireUserAuthContext } from "@/lib/auth-context";
const lock = jest.fn();
const returning = jest.fn();
const tx = { select: jest.fn(), update: jest.fn(() => ({ set: () => ({ where: () => ({ returning }) }) })), delete: jest.fn(), insert: jest.fn() };
const post = () => PUT(new NextRequest("http://localhost/api/organizations/members/target", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "project_editor", projectAssignments: [{ projectId: "11111111-1111-4111-8111-111111111111" }] }) }), { params: Promise.resolve({ memberId: "target" }) });
beforeEach(() => {
  jest.clearAllMocks();
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "actor", organizationId: "org-1", isCliAuth: false });
  (getUserOrgRole as jest.Mock).mockResolvedValue("org_owner");
  (db.select as jest.Mock).mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [{ id: "target", role: "project_viewer" }] }) }) }) }).mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ where: async () => [] }) }) });
  (db.transaction as jest.Mock).mockImplementation(async fn => fn(tx));
  tx.select.mockReturnValue({ from: () => ({ where: () => ({ for: lock }) }) });
  lock.mockResolvedValue([]);
});
it("rechecks membership after a concurrent leave has acquired the membership lock", async () => {
  let release!: (rows: unknown[]) => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  lock.mockImplementation(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const response = post();
  await waiting;
  expect(tx.update).not.toHaveBeenCalled();
  release([]);
  expect((await response).status).toBe(404);
  expect(tx.insert).not.toHaveBeenCalled();
});
it("revalidates owner protection after waiting for a concurrent role change", async () => {
  lock.mockResolvedValue([{ role: "org_owner" }]);
  expect((await post()).status).toBe(403);
  expect(tx.update).not.toHaveBeenCalled();
});
it("does not create assignments when the membership update affects no rows", async () => {
  lock.mockResolvedValue([{ role: "project_viewer" }]);
  returning.mockResolvedValue([]);
  expect((await post()).status).toBe(404);
  expect(tx.insert).not.toHaveBeenCalled();
});
