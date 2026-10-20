/** @jest-environment node */
jest.mock("@/lib/security/login-lockout", () => ({
  LOGIN_LOCKOUT_INITIAL_ALLOWANCE: 5,
  LOGIN_LOCKOUT_MESSAGE: "Too many sign-in attempts. Please try again later.",
  blockingLockoutIdentifiers: (email: string, ip: string) =>
    ip && ip !== "unknown" ? [`ip:${ip}`, `pair:${email}|${ip}`] : [],
  checkLockout: jest.fn(),
}));
jest.mock("@/lib/session-security", () => ({ getClientIP: () => "192.0.2.1" }));
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn() }));
import { NextRequest } from "next/server";
import { checkLockout } from "@/lib/security/login-lockout";
import { getRedisConnection } from "@/lib/queue";
import { POST } from "./route";

const redis = {
  zremrangebyscore: jest.fn(async () => 0),
  zcard: jest.fn(async () => 0),
  zadd: jest.fn(async () => 1),
  expire: jest.fn(async () => 1),
};

const preCheck = (email = "user@example.test") =>
  POST(new NextRequest("http://localhost/api/auth/sign-in/check", {
    method: "POST", body: JSON.stringify({ action: "pre-check", email }),
  }));

const unlocked = { isLocked: false, attemptsRemaining: 4 };

beforeEach(() => {
  jest.clearAllMocks();
  (getRedisConnection as jest.Mock).mockResolvedValue(redis);
  (checkLockout as jest.Mock).mockResolvedValue(unlocked);
});

it.each(["failed", "success"])("rejects public lockout mutation %s", async (action) => {
  const response = await POST(new NextRequest("http://localhost/api/auth/sign-in/check", {
    method: "POST", body: JSON.stringify({ action, email: "user@example.test" }),
  }));
  expect(response.status).toBe(400);
  expect(checkLockout).not.toHaveBeenCalled();
});

it("checks only the IP and email+IP dimensions", async () => {
  await preCheck();
  expect((checkLockout as jest.Mock).mock.calls.map((call: [string]) => call[0])).toEqual([
    "ip:192.0.2.1",
    "pair:user@example.test|192.0.2.1",
  ]);
});

it("allows an unlocked identity", async () => {
  const response = await preCheck();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body).toMatchObject({ allowed: true, isLocked: false, attemptsRemaining: 4 });
});

it("rejects a locked identity with the generic 429 message", async () => {
  (checkLockout as jest.Mock).mockResolvedValue({
    isLocked: true,
    attemptsRemaining: 0,
    lockoutSeconds: 30,
    lockoutUntil: new Date("2026-01-01T00:00:00.000Z"),
  });

  const response = await preCheck();
  const body = await response.json();

  expect(response.status).toBe(429);
  expect(body).toMatchObject({
    allowed: false,
    isLocked: true,
    message: "Too many sign-in attempts. Please try again later.",
    lockoutSeconds: 30,
  });
});

it("uses the shared message for endpoint rate limiting", async () => {
  redis.zcard.mockResolvedValueOnce(20);

  const response = await preCheck();
  const body = await response.json();

  expect(response.status).toBe(429);
  expect(body.message).toBe("Too many sign-in attempts. Please try again later.");
  expect(checkLockout).not.toHaveBeenCalled();
});

it("validates the request body", async () => {
  const missingAction = await POST(new NextRequest("http://localhost/api/auth/sign-in/check", {
    method: "POST", body: JSON.stringify({ email: "user@example.test" }),
  }));
  const missingEmail = await POST(new NextRequest("http://localhost/api/auth/sign-in/check", {
    method: "POST", body: JSON.stringify({ action: "pre-check" }),
  }));

  expect(missingAction.status).toBe(400);
  expect(missingEmail.status).toBe(400);
});
