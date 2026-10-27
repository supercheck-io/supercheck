import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { getClientIP } from "@/lib/session-security";
import {
  CLIENT_IP_UNAVAILABLE_MESSAGE,
  LOGIN_LOCKOUT_MESSAGE,
  type AttemptReservation,
  blockingLockoutIdentifiers,
  clearLockout,
  emailLockoutIdentifier,
  recordEmailFailure,
  releaseLoginAttempt,
  reserveLoginAttempt,
  shouldRejectUnknownClientIp,
  warnUnknownClientIp,
} from "./login-lockout";

/**
 * Reservation made in before() and settled in after(). Keyed by the shared auth
 * context object so both hooks in the same dispatch see the same reservation.
 */
const pendingReservations = new WeakMap<object, AttemptReservation>();

const signInEmail = (body: unknown): string | null => {
  if (!body || typeof body !== "object" || !("email" in body)) return null;
  const email = body.email;
  return typeof email === "string" ? email.trim().toLowerCase() : null;
};

// Only credential outcomes may convert a reservation into a recorded failure.
export type AuthHookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** The lockout check as a plain function, so auth.ts can run it alongside other before-hooks in one middleware. */
export async function loginLockoutBefore(ctx: AuthHookContext) {
  if (ctx.path !== "/sign-in/email") return;
  const email = signInEmail(ctx.body);
  if (!email) return;

  const ip = getClientIP(ctx.headers ?? new Headers());
  const identifiers = blockingLockoutIdentifiers(email, ip);
  if (identifiers.length === 0) {
    if (shouldRejectUnknownClientIp()) {
      throw new APIError("SERVICE_UNAVAILABLE", {
        message: CLIENT_IP_UNAVAILABLE_MESSAGE,
      });
    }
    warnUnknownClientIp();
    return;
  }

  // Reserve before the password check so a parallel burst cannot all pass
  // the check before any failure is counted.
  const reservation = await reserveLoginAttempt(identifiers);
  pendingReservations.set(ctx.context, reservation);

  if (reservation.isLocked) {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: LOGIN_LOCKOUT_MESSAGE,
    });
  }
}

export const loginLockoutHooks = {
  before: createAuthMiddleware(loginLockoutBefore),
  after: createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/sign-in/email") return;
    const email = signInEmail(ctx.body);
    if (!email) return;

    const reservation = pendingReservations.get(ctx.context);
    pendingReservations.delete(ctx.context);

    const result = ctx.context.returned;
    const invalidPassword =
      isAPIError(result) && result.body?.code === "INVALID_EMAIL_OR_PASSWORD";

    if (invalidPassword) {
      // Reservation stays consumed. The per-email counter is telemetry only.
      await recordEmailFailure(email);
      return;
    }

    if (ctx.context.newSession) {
      const releases = reservation?.releases ?? [];
      // Reset the dimensions that identify this account, but only release the
      // shared IP attempt: wiping the IP counter would let anyone with an
      // account reset the ladder for every other user behind the same address.
      const accountIdentifiers = releases
        .map(({ identifier }) => identifier)
        .filter((identifier) => !identifier.startsWith("ip:"));

      await Promise.all(
        [emailLockoutIdentifier(email), ...accountIdentifiers].map((identifier) =>
          clearLockout(identifier)
        )
      );
      await releaseLoginAttempt(
        releases.filter(({ identifier }) => identifier.startsWith("ip:"))
      );
      return;
    }

    // Captcha, unverified email, transport or other API errors say nothing
    // about the password: give the reserved attempt back.
    if (reservation) {
      await releaseLoginAttempt(reservation.releases);
    }
  }),
};
