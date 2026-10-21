import { db } from "@/utils/db";
import { user, session, oauthAccessToken, oauthRefreshToken } from "@/db/schema";
import { eq } from "drizzle-orm";

/** A suspension invalidates interactive sessions and refreshable agent credentials together. */
export async function suspendAccount(userId: string, reason: string, banExpires: Date | null): Promise<void> {
  await db.transaction(async tx => {
    await tx.update(user).set({ banned: true, banReason: reason, banExpires, updatedAt: new Date() }).where(eq(user.id, userId));
    await tx.update(session).set({ expiresAt: new Date(0) }).where(eq(session.userId, userId));
    await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId));
    await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, userId));
  });
}
