import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { getClientIP } from "@/lib/session-security";
import { checkLockout, clearLockout, recordFailedAttempt } from "./login-lockout";

// Only verified credential outcomes may mutate lockout state.
export const loginLockoutHooks = {
  before: createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/sign-in/email" || typeof ctx.body?.email !== "string") return;
    const email = ctx.body.email.trim().toLowerCase();
    const ip = getClientIP(ctx.headers ?? new Headers());
    const locks = await Promise.all([checkLockout(email), checkLockout(ip)]);
    if (locks.some((lock) => lock.isLocked)) {
      throw new APIError("TOO_MANY_REQUESTS", {
        message: "Account temporarily locked. Please try again later.",
      });
    }
  }),
  after: createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/sign-in/email" || typeof ctx.body?.email !== "string") return;
    const email = ctx.body.email.trim().toLowerCase();
    const ip = getClientIP(ctx.headers ?? new Headers());
    const result = ctx.context.returned;
    if (isAPIError(result) && result.body?.code === "INVALID_EMAIL_OR_PASSWORD") {
      await Promise.all([recordFailedAttempt(email), recordFailedAttempt(ip)]);
    } else if (ctx.context.newSession) {
      await Promise.all([clearLockout(email), clearLockout(ip)]);
    }
  }),
};
