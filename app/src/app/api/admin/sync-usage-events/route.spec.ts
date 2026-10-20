/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/services/polar-usage.service", () => ({ polarUsageService: { syncPendingEvents: jest.fn() } }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: jest.fn(() => false) }));
jest.mock("@/lib/admin", () => ({ requireAdmin: jest.fn(), isAdminAccessDeniedError: jest.fn(() => false) }));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn((e) => e?.message === "unauthorized") }));

import { POST } from "./route";
import { requireAdmin } from "@/lib/admin";
import { requireUserAuthContext } from "@/lib/auth-context";

const originalSecret = process.env.CRON_SECRET;
const post = (secret?: string) => POST(new NextRequest("http://localhost/api/admin/sync-usage-events", {
  method: "POST", headers: secret === undefined ? {} : { "x-cron-secret": secret },
}));
beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = "secret-value";
  (requireUserAuthContext as jest.Mock).mockRejectedValue(new Error("unauthorized"));
});
afterAll(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});
it("accepts an exact nonempty cron secret", async () => {
  expect((await post("secret-value")).status).toBe(200);
  expect(requireUserAuthContext).not.toHaveBeenCalled();
});
it.each([undefined, "", "wrong", "secret-valuE", "é-value"])("rejects incorrect cron secret %p without admin session", async (secret) => {
  expect((await post(secret)).status).toBe(401);
  expect(requireUserAuthContext).toHaveBeenCalled();
});
it("rejects an empty configured secret", async () => {
  process.env.CRON_SECRET = "";
  expect((await post("")).status).toBe(401);
});
it("preserves admin-session fallback", async () => {
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "admin-user" });
  expect((await post("incorrect")).status).toBe(200);
  expect(requireAdmin).toHaveBeenCalledWith("admin-user");
});
