import { safeErrorFields } from "@/lib/log-safe-error";
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { session, user } from "@/db/schema";
import { getCachedAuthSession } from "@/lib/session-cache";

type PersonRef = { id: string; name: string; email: string };

export interface ImpersonationStatus {
  isImpersonating: boolean;
  impersonatedUser?: PersonRef | null;
  originalAdmin?: PersonRef | null;
}

const person = (row: { id: string; name: string; email: string } | undefined): PersonRef | null =>
  row ? { id: row.id, name: row.name, email: row.email } : null;

/**
 * Whether the caller's session is an impersonation, read from the session row (the source of truth).
 * Null when the lookup failed: callers must not treat that as "not impersonating".
 */
export async function getImpersonationStatus(): Promise<ImpersonationStatus | null> {
  try {
    const sessionData = await getCachedAuthSession();
    if (!sessionData?.session?.token) return { isImpersonating: false };

    const [current] = await db
      .select({ userId: session.userId, impersonatedBy: session.impersonatedBy })
      .from(session)
      .where(eq(session.token, sessionData.session.token))
      .limit(1);
    if (!current?.impersonatedBy) return { isImpersonating: false };

    const columns = { id: user.id, name: user.name, email: user.email };
    const [[impersonated], [admin]] = await Promise.all([
      db.select(columns).from(user).where(eq(user.id, current.userId)).limit(1),
      db.select(columns).from(user).where(eq(user.id, current.impersonatedBy)).limit(1),
    ]);
    return { isImpersonating: true, impersonatedUser: person(impersonated), originalAdmin: person(admin) };
  } catch (error) {
    // The failed query's parameters include the session token, so log only safe fields.
    console.error("Error checking impersonation status:", safeErrorFields(error));
    return null;
  }
}
