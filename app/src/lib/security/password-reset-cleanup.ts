import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { db } from "@/utils/db";
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
