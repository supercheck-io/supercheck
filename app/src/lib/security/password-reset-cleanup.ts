import { and, eq, gt, inArray, isNull, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/utils/db";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  apikey,
  deviceAuthorizations,
  oauthAccessToken,
  oauthConsent,
  oauthRefreshToken,
  verification,
} from "@/db/schema";

/**
 * Credentials that outlive a password reset unless removed, so someone who stole one
 * before the reset cannot keep using it after the owner has recovered the account.
 *
 * Removes, in one transaction:
 * - every MCP/OAuth access token, refresh token and consent for the user;
 * - the user's CLI tokens and extension keys (job trigger keys have a jobId and are kept,
 *   since deleting them would break pipelines that merely hold the key);
 * - device sign-in grants the user approved but the CLI has not yet exchanged, which would
 *   otherwise mint a brand-new CLI token after the reset;
 * - every other pending reset link, so an older emailed link cannot overwrite the new password.
 *
 * Sessions are revoked separately by Better Auth (`revokeSessionsOnPasswordReset`).
 */
async function revokeOnce(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Access tokens reference their refresh token, so remove them first.
    await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId));
    await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, userId));
    await tx.delete(oauthConsent).where(eq(oauthConsent.userId, userId));
    await tx
      .delete(deviceAuthorizations)
      .where(
        and(eq(deviceAuthorizations.approvedUserId, userId), inArray(deviceAuthorizations.status, ["pending", "approved"])),
      );
    await tx.delete(apikey).where(and(eq(apikey.referenceId, userId), isNull(apikey.jobId)));
    await tx
      .delete(verification)
      .where(and(like(verification.identifier, "reset-password:%"), eq(verification.value, userId)));
  });
}

/**
 * Better Auth calls this after the new password is committed, so a failure here would leave the
 * old credentials alive behind a changed password. Retry briefly, then fail loudly.
 */
export async function revokeCredentialsAfterPasswordReset(userId: string): Promise<void> {
  const attempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await revokeOnce(userId);
    } catch (error) {
      if (attempt >= attempts) {
        console.error("Failed to revoke credentials after password reset", { userId, error });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

const PENDING_PREFIX = "pending-credential-revocation:";
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Runs from Better Auth after the new password is committed. The password change must not fail because
 * cleanup did: the reset link is already spent, so an error would only confuse the user. If the cleanup
 * cannot be completed it is audited, and a marker is stored so a later sweep finishes the job.
 */
export async function revokeCredentialsAfterPasswordResetSafely(userId: string): Promise<void> {
  try {
    await revokeCredentialsAfterPasswordReset(userId);
  } catch (error) {
    console.error("Credential revocation after password reset failed; it will be retried", { userId, error });
    await logAuditEvent({
      userId,
      action: "password_reset_credential_revocation_failed",
      resource: "user",
      resourceId: userId,
      metadata: { retry: "scheduled" },
      success: false,
    }).catch(() => undefined);
    await db
      .insert(verification)
      .values({
        id: randomUUID(),
        identifier: `${PENDING_PREFIX}${userId}`,
        value: userId,
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      })
      .catch((markerError: unknown) =>
        console.error("Could not record the pending credential revocation", { userId, markerError }),
      );
  }
}

/** Finishes revocations that failed earlier. Safe to run repeatedly. */
export async function retryPendingCredentialRevocations(limit = 50): Promise<number> {
  const pending = await db
    .select({ id: verification.id, userId: verification.value })
    .from(verification)
    .where(and(like(verification.identifier, `${PENDING_PREFIX}%`), gt(verification.expiresAt, new Date())))
    .limit(limit);
  let done = 0;
  for (const row of pending) {
    try {
      await revokeCredentialsAfterPasswordReset(row.userId);
      await db.delete(verification).where(eq(verification.id, row.id));
      done += 1;
    } catch (error) {
      console.error("Retry of credential revocation failed", { userId: row.userId, error });
    }
  }
  return done;
}
