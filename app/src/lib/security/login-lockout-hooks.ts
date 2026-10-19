import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { getClientIP } from "@/lib/session-security";
import { checkLockout, clearLockout, recordFailedAttempt } from "./login-lockout";

// Without a proxy header getClientIP returns "unknown"; one shared bucket would lock everyone out.
const ipKeys = (ip: string) => (ip && ip !== "unknown" ? [ip] : []);

// Only verified credential outcomes may mutate lockout state.
export const loginLockoutHooks = {
  before: createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/sign-in/email" || typeof ctx.body?.email !== "string") return;
    const email = ctx.body.email.trim().toLowerCase();
    const ip = getClientIP(ctx.headers ?? new Headers());
    const locks = await Promise.all([email, ...ipKeys(ip)].map((key) => checkLockout(key)));
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
      await Promise.all([email, ...ipKeys(ip)].map((key) => recordFailedAttempt(key)));
    } else if (ctx.context.newSession) {
      await Promise.all([email, ...ipKeys(ip)].map((key) => clearLockout(key)));
    }
  }),
};
