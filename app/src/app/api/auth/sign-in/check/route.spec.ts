/** @jest-environment node */
jest.mock("@/lib/security/login-lockout", () => ({
  CLIENT_IP_UNAVAILABLE_MESSAGE:
    "Sign-in is temporarily unavailable. Please try again later.",
  LOGIN_LOCKOUT_INITIAL_ALLOWANCE: 5,
  LOGIN_LOCKOUT_MESSAGE: "Too many sign-in attempts. Please try again later.",
  blockingLockoutIdentifiers: (email: string, ip: string) =>
    ip && ip !== "unknown" ? [`ip:${ip}`, `pair:${email}|${ip}`] : [],
  checkLockout: jest.fn(),
  shouldRejectUnknownClientIp: jest.fn(() => false),
  warnUnknownClientIp: jest.fn(),
}));
jest.mock("@/lib/session-security", () => ({
  getClientIP: jest.fn(() => "192.0.2.1"),
}));
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn() }));
import { NextRequest } from "next/server";
import {
  checkLockout,
  shouldRejectUnknownClientIp,
  warnUnknownClientIp,
} from "@/lib/security/login-lockout";
import { getClientIP } from "@/lib/session-security";
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

it("fails closed when a deployment requires a client IP but none is available", async () => {
  (getClientIP as jest.Mock).mockReturnValueOnce("unknown");
  (shouldRejectUnknownClientIp as jest.Mock).mockReturnValueOnce(true);

  const response = await preCheck();

  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    allowed: false,
    isLocked: true,
    message: "Sign-in is temporarily unavailable. Please try again later.",
  });
  expect(checkLockout).not.toHaveBeenCalled();
});

it("still pre-checks without a client IP when the deployment allows it", async () => {
  (getClientIP as jest.Mock).mockReturnValueOnce("unknown");
  (shouldRejectUnknownClientIp as jest.Mock).mockReturnValueOnce(false);

  const response = await preCheck();

  expect(response.status).toBe(200);
  expect(warnUnknownClientIp).toHaveBeenCalled();
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
