/** @jest-environment node */
import { NextRequest } from "next/server";

const mockSuspend = jest.fn();
jest.mock("@/lib/security/suspend-account", () => ({ suspendAccount: (...a: unknown[]) => mockSuspend(...a) }));
jest.mock("@/lib/admin", () => ({ requireAdmin: jest.fn(), getAllUsers: jest.fn() }));
jest.mock("@/lib/session", () => ({ getCurrentUser: async () => ({ id: "admin" }) }));
jest.mock("@/lib/audit-logger", () => ({ logAdminEvent: jest.fn() }));
jest.mock("@/utils/db", () => ({ db: {} }));

import { PATCH } from "./route";

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
