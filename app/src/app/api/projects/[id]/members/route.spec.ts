/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn() }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), transaction: jest.fn() } }));
import { POST } from "./route";
import { db } from "@/utils/db";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext } from "@/lib/auth-context";
const lock = jest.fn();
const insert = jest.fn();
const tx = { select: jest.fn(), insert };
const rows = (data: unknown[]) => ({ from: () => ({ where: () => ({ limit: async () => data, for: lock }) }) });
const post = () => POST(new NextRequest("http://localhost/api/projects/93ce4a2e-7846-5b60-b753-1ab3563f0fce/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: "target-user", role: "project_admin" }) }), { params: Promise.resolve({ id: "93ce4a2e-7846-5b60-b753-1ab3563f0fce" }) });
beforeEach(() => {
  jest.clearAllMocks();
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "admin-1" });
  (hasPermissionForUser as jest.Mock).mockResolvedValue(true);
  (db.select as jest.Mock).mockReturnValueOnce(rows([{ organizationId: "org-1" }])).mockReturnValueOnce(rows([{ id: "target-user" }]));
  (db.transaction as jest.Mock).mockImplementation(async fn => fn(tx));
  tx.select.mockReturnValue(rows([]));
  lock.mockResolvedValue([]);
});
it("rejects a user outside the project's organization inside the insert transaction", async () => {
  expect((await post()).status).toBe(400);
  expect(lock).toHaveBeenCalledWith("update");
  expect(insert).not.toHaveBeenCalled();
});
it("waits for a concurrent leave then rejects instead of recreating project assignments", async () => {
  let release!: (rows: unknown[]) => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  lock.mockImplementation(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const response = post();
  await waiting;
  expect(insert).not.toHaveBeenCalled();
  release([]);
  expect((await response).status).toBe(400);
  expect(insert).not.toHaveBeenCalled();
});
it("inserts only while holding a valid organization membership lock", async () => {
  lock.mockResolvedValue([{ id: "membership-1" }]);
  insert.mockReturnValue({ values: () => ({ returning: async () => [{ id: "assignment-1" }] }) });
  expect((await post()).status).toBe(201);
  expect(insert).toHaveBeenCalledTimes(1);
});
