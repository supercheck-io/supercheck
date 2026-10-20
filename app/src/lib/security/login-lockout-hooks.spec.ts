/** @jest-environment node */
jest.mock("better-auth/api", () => ({
  createAuthMiddleware: (fn: unknown) => fn,
  APIError: class extends Error {
    body: { code?: string };
    constructor(status: string, body: { code?: string; message?: string }) {
      super(body.message ?? status);
      this.body = body;
    }
  },
  isAPIError: (value: unknown) => value instanceof Error && "body" in value,
}));
jest.mock("@/lib/session-security", () => ({ getClientIP: jest.fn(() => "192.0.2.1") }));
jest.mock("./login-lockout", () => ({
  LOGIN_LOCKOUT_MESSAGE: "Too many sign-in attempts. Please try again later.",
  blockingLockoutIdentifiers: jest.fn((email: string, ip: string) =>
    ip && ip !== "unknown" ? [`ip:${ip}`, `pair:${email}|${ip}`] : []
  ),
  emailLockoutIdentifier: jest.fn((email: string) => `email:${email}`),
  reserveLoginAttempt: jest.fn(),
  releaseLoginAttempt: jest.fn(),
  recordEmailFailure: jest.fn(),
  clearLockout: jest.fn(),
}));
import { APIError } from "better-auth/api";
import { getClientIP } from "@/lib/session-security";
import { loginLockoutHooks } from "./login-lockout-hooks";
import {
  clearLockout,
  recordEmailFailure,
  releaseLoginAttempt,
  reserveLoginAttempt,
} from "./login-lockout";

const context = (returned?: unknown, newSession?: unknown) => ({
  path: "/sign-in/email",
  body: { email: " User@Example.test " },
  headers: new Headers(),
  context: { returned: returned as unknown, newSession },
});
const before = loginLockoutHooks.before as unknown as (ctx: ReturnType<typeof context>) => Promise<void>;
const after = loginLockoutHooks.after as unknown as typeof before;

const reservation = (isLocked = false) => ({
  isLocked,
  attemptsRemaining: 4,
  lockoutSeconds: isLocked ? 30 : undefined,
  releases: isLocked ? [] : [
    { identifier: "ip:192.0.2.1", appliedLockoutSeconds: 0 },
    { identifier: "pair:user@example.test|192.0.2.1", appliedLockoutSeconds: 0 },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  (reserveLoginAttempt as jest.Mock).mockResolvedValue(reservation());
});

it("reserves an attempt on IP and email+IP before the password check", async () => {
  await before(context());
  expect(reserveLoginAttempt).toHaveBeenCalledWith([
    "ip:192.0.2.1",
    "pair:user@example.test|192.0.2.1",
  ]);
});

it("rejects a locked identity with the shared generic message", async () => {
  (reserveLoginAttempt as jest.Mock).mockResolvedValue(reservation(true));
  await expect(before(context())).rejects.toThrow("Too many sign-in attempts");
});

it("never checks or blocks on an email-only identity", async () => {
  await before(context());
  expect((reserveLoginAttempt as jest.Mock).mock.calls[0][0]).not.toContain(
    "email:user@example.test"
  );
});

it("keeps the reservation only for a wrong password", async () => {
  const ctx = context();
  await before(ctx);
  ctx.context.returned = new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD" });
  await after(ctx);
  expect(recordEmailFailure).toHaveBeenCalledWith("user@example.test");
  expect(releaseLoginAttempt).not.toHaveBeenCalled();
  expect(clearLockout).not.toHaveBeenCalled();
});

it.each(["CAPTCHA_FAILED", "EMAIL_NOT_VERIFIED", "INTERNAL_ERROR"])(
  "releases the reservation when the password was not verified (%s)",
  async (code) => {
    const ctx = context();
    await before(ctx);
    ctx.context.returned = new APIError("BAD_REQUEST", { code });
    await after(ctx);

    expect(recordEmailFailure).not.toHaveBeenCalled();
    expect(releaseLoginAttempt).toHaveBeenCalledWith(reservation().releases);
    expect(clearLockout).not.toHaveBeenCalled();
  }
);

it("releases the reservation on a non-API failure", async () => {
  const ctx = context();
  await before(ctx);
  ctx.context.returned = new Error("network down");
  await after(ctx);
  expect(releaseLoginAttempt).toHaveBeenCalled();
});

it("clears account counters and releases only the IP attempt after a successful session", async () => {
  const ctx = context({ user: {} }, { user: { id: "user" } });
  await before(ctx);
  await after(ctx);

  expect(clearLockout).toHaveBeenCalledWith("email:user@example.test");
  expect(clearLockout).toHaveBeenCalledWith("pair:user@example.test|192.0.2.1");
  expect(clearLockout).not.toHaveBeenCalledWith("ip:192.0.2.1");
  // A success must not wipe the shared IP ladder for everyone behind that IP.
  expect(releaseLoginAttempt).toHaveBeenCalledWith([
    { identifier: "ip:192.0.2.1", appliedLockoutSeconds: 0 },
  ]);
});

it("does not clear counters on a session-less success response", async () => {
  const ctx = context({ user: {} });
  await before(ctx);
  await after(ctx);
  expect(clearLockout).not.toHaveBeenCalled();
  expect(releaseLoginAttempt).toHaveBeenCalled();
});

it("ignores other auth endpoints and invalid bodies", async () => {
  await before({ ...context(), path: "/sign-up/email" });
  await after({ ...context(), path: "/sign-out" });
  await before({ ...context(), body: {} } as ReturnType<typeof context>);
  expect(reserveLoginAttempt).not.toHaveBeenCalled();
  expect(recordEmailFailure).not.toHaveBeenCalled();
  expect(releaseLoginAttempt).not.toHaveBeenCalled();
});

it("skips reservations when the client IP is unknown", async () => {
  (getClientIP as jest.Mock).mockReturnValueOnce("unknown");
  await before(context());
  expect(reserveLoginAttempt).not.toHaveBeenCalled();
});
