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
  checkLockout: jest.fn(), clearLockout: jest.fn(), recordFailedAttempt: jest.fn(),
}));
import { APIError } from "better-auth/api";
import { getClientIP } from "@/lib/session-security";
import { loginLockoutHooks } from "./login-lockout-hooks";
import { checkLockout, clearLockout, recordFailedAttempt } from "./login-lockout";
const context = (returned?: unknown, newSession?: unknown) => ({
  path: "/sign-in/email", body: { email: " User@Example.test " }, headers: new Headers(),
  context: { returned, newSession },
});
const before = loginLockoutHooks.before as unknown as (ctx: ReturnType<typeof context>) => Promise<void>;
const after = loginLockoutHooks.after as unknown as typeof before;
beforeEach(() => {
  jest.clearAllMocks();
  (checkLockout as jest.Mock).mockResolvedValue({ isLocked: false });
});
it.each(["email", "ip"])("blocks direct credential verification when %s is locked", async (locked) => {
  (checkLockout as jest.Mock).mockImplementation(async (id) => ({ isLocked: id === (locked === "email" ? "user@example.test" : "192.0.2.1") }));
  await expect(before(context())).rejects.toThrow("temporarily locked");
  expect(recordFailedAttempt).not.toHaveBeenCalled();
});
it("allows unlocked logins and records only verified credential failures", async () => {
  await expect(before(context())).resolves.toBeUndefined();
  await after(context(new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD" })));
  expect(recordFailedAttempt).toHaveBeenCalledWith("user@example.test");
  expect(recordFailedAttempt).toHaveBeenCalledWith("192.0.2.1");
  expect(clearLockout).not.toHaveBeenCalled();
});
it.each(["CAPTCHA_FAILED", "EMAIL_NOT_VERIFIED", "INTERNAL_ERROR"])("does not count %s as a password failure", async (code) => {
  await after(context(new APIError("BAD_REQUEST", { code })));
  expect(recordFailedAttempt).not.toHaveBeenCalled();
  expect(clearLockout).not.toHaveBeenCalled();
});
it("clears counters only after successful session creation", async () => {
  await after(context({ user: {} }));
  expect(clearLockout).not.toHaveBeenCalled();
  await after(context({ user: {} }, { user: { id: "user" } }));
  expect(clearLockout).toHaveBeenCalledWith("user@example.test");
  expect(clearLockout).toHaveBeenCalledWith("192.0.2.1");
});
it("ignores other auth endpoints and invalid bodies", async () => {
  await before({ ...context(), path: "/sign-up/email" });
  await after({ ...context(), path: "/sign-out" });
  await before({ ...context(), body: {} } as ReturnType<typeof context>);
  expect(checkLockout).not.toHaveBeenCalled();
  expect(recordFailedAttempt).not.toHaveBeenCalled();
});
it("skips the IP dimension when the client IP is unknown", async () => {
  (getClientIP as jest.Mock).mockReturnValueOnce("unknown").mockReturnValueOnce("unknown");
  await before(context());
  expect(checkLockout).toHaveBeenCalledTimes(1);
  expect(checkLockout).toHaveBeenCalledWith("user@example.test");
  await after(context(new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD" })));
  expect(recordFailedAttempt).toHaveBeenCalledTimes(1);
  expect(recordFailedAttempt).not.toHaveBeenCalledWith("unknown");
});
