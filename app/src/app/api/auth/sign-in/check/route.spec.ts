/** @jest-environment node */
jest.mock("@/lib/security/login-lockout", () => ({ checkLockout: jest.fn(), recordFailedAttempt: jest.fn(), clearLockout: jest.fn() }));
jest.mock("@/lib/session-security", () => ({ getClientIP: () => "192.0.2.1" }));
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn() }));
import { NextRequest } from "next/server";
import { clearLockout, recordFailedAttempt, checkLockout } from "@/lib/security/login-lockout";
import { POST } from "./route";
it.each(["failed", "success"])("rejects public lockout mutation %s", async (action) => {
  const response = await POST(new NextRequest("http://localhost/api/auth/sign-in/check", {
    method: "POST", body: JSON.stringify({ action, email: "user@example.test" }),
  }));
  expect(response.status).toBe(400);
  expect(recordFailedAttempt).not.toHaveBeenCalled();
  expect(clearLockout).not.toHaveBeenCalled();
  expect(checkLockout).not.toHaveBeenCalled();
});
