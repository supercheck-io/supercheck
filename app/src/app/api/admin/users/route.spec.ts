/** @jest-environment node */
import { NextRequest } from "next/server";

const mockSuspend = jest.fn();
jest.mock("@/lib/security/suspend-account", () => ({ suspendAccount: (...a: unknown[]) => mockSuspend(...a) }));
jest.mock("@/lib/admin", () => ({ requireAdmin: jest.fn(), getAllUsers: jest.fn() }));
jest.mock("@/lib/session", () => ({ getCurrentUser: async () => ({ id: "admin" }) }));
jest.mock("@/lib/audit-logger", () => ({ logAdminEvent: jest.fn() }));
const mockReturning = jest.fn();
jest.mock("@/utils/db", () => ({ db: { update: () => ({ set: () => ({ where: () => ({ returning: mockReturning }) }) }) } }));

import { GET, PATCH } from "./route";
import { getAllUsers, requireAdmin } from "@/lib/admin";
import { logAdminEvent } from "@/lib/audit-logger";

const ban = (duration: unknown) =>
  PATCH(
    new NextRequest("https://app.example.com/api/admin/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "u1", action: "ban", reason: "abuse", duration }),
    }),
  );

beforeEach(() => mockSuspend.mockReset().mockResolvedValue(undefined));

describe("PATCH /api/admin/users ban duration", () => {
  it.each([-1000, -1, "1h"])("rejects %p without suspending", async (duration) => {
    expect((await ban(duration)).status).toBe(400);
    expect(mockSuspend).not.toHaveBeenCalled();
  });

  it("bans permanently without a duration and temporarily with a positive one", async () => {
    await ban(undefined);
    await ban(0);
    await ban(3600_000);
    expect(mockSuspend.mock.calls[0][2]).toBeNull();
    expect(mockSuspend.mock.calls[1][2]).toBeNull();
    expect(mockSuspend.mock.calls[2][2]).toBeInstanceOf(Date);
  });
});

const UID = "0c11ab1e-7460-5139-b3b8-920f69f95082";
const unban = () =>
  PATCH(new NextRequest("https://app.example.com/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: UID, action: "unban" }) }));

describe("admin users API hardening", () => {
  beforeEach(() => (logAdminEvent as jest.Mock).mockClear());
  it("returns 403, not 500, when a non-admin PATCHes", async () => {
    (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error("Admin privileges required"));
    expect((await unban()).status).toBe(403);
  });

  it("404s an unban for an unknown user and audits a real one", async () => {
    mockReturning.mockResolvedValueOnce([]);
    expect((await unban()).status).toBe(404);
    expect(logAdminEvent).not.toHaveBeenCalled();
    mockReturning.mockResolvedValueOnce([{ id: "u1" }]);
    expect((await unban()).status).toBe(200);
    expect(logAdminEvent).toHaveBeenCalledWith("admin", "user_unbanned", UID, "user", UID);
  });

  it("rejects a malformed unban id before touching the database", async () => {
    const res = await PATCH(new NextRequest("https://app.example.com/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: "u1", action: "unban" }) }));
    expect(res.status).toBe(400);
  });

  it("clamps list pagination", async () => {
    (getAllUsers as jest.Mock).mockResolvedValue([]);
    await GET(new NextRequest("https://app.example.com/api/admin/users?limit=abc&offset=-5"));
    expect(getAllUsers).toHaveBeenLastCalledWith(50, 0);
    await GET(new NextRequest("https://app.example.com/api/admin/users?limit=99999&offset=10"));
    expect(getAllUsers).toHaveBeenLastCalledWith(200, 10);
  });
});
