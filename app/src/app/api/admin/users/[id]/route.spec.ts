/** @jest-environment node */
jest.mock("@/lib/admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/utils/auth", () => ({ auth: {} }));
jest.mock("@/lib/audit-logger", () => ({ logAdminEvent: jest.fn(), logImpersonationEvent: jest.fn() }));
jest.mock("@/lib/session-security", () => ({ checkAdminRateLimit: jest.fn() }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), transaction: jest.fn() } }));
import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { getCurrentUser } from "@/lib/session";
import { logAdminEvent } from "@/lib/audit-logger";
import { DELETE, PUT } from "./route";
beforeEach(() => {
  jest.clearAllMocks();
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: "admin" });
  (db.select as jest.Mock).mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ id: "target", email: "target@example.test" }] }) }) });
  const tx = {
    delete: () => ({ where: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  (db.transaction as jest.Mock).mockImplementation(async (fn) => fn(tx));
});
it("records the administrator and deleted account after the transaction commits", async () => {
  const response = await DELETE(new NextRequest("http://localhost/api/admin/users/target"), { params: Promise.resolve({ id: "target" }) });
  expect(response.status).toBe(200);
  expect(logAdminEvent).toHaveBeenCalledWith("admin", "user_deleted", "target", "user", "target", { targetEmail: "target@example.test" });
  expect((db.transaction as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((logAdminEvent as jest.Mock).mock.invocationCallOrder[0]);
});
it("does not claim deletion when the transaction fails", async () => {
  (db.transaction as jest.Mock).mockRejectedValue(new Error("rollback"));
  const response = await DELETE(new NextRequest("http://localhost/api/admin/users/target"), { params: Promise.resolve({ id: "target" }) });
  expect(response.status).toBe(500);
  expect(logAdminEvent).not.toHaveBeenCalled();
});

describe("PUT validation and audit", () => {
  const put = (body: unknown) => PUT(new NextRequest("http://localhost/api/admin/users/target", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "target" }) });
  beforeEach(() => {
    (db.select as jest.Mock).mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ name: "T", email: "t@example.test", role: null }] }) }) });
    (db as unknown as { update: jest.Mock }).update = jest.fn(() => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "target", role: "super_admin" }] }) }) }));
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
  it("audits a super-admin grant", async () => {
    expect((await put({ role: "super_admin" })).status).toBe(200);
    expect(logAdminEvent).toHaveBeenCalledWith("admin", "user_updated", "target", "user", "target", { changedFields: ["role"], previousRole: null, newRole: "super_admin" });
  });
});
