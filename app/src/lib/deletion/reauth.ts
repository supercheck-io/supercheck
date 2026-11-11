import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { session } from "@/db/schema";
import { getCachedAuthSession } from "@/lib/session-cache";

/**
 * Fresh sign-in check for irreversible account actions. A session row is created at every sign-in (password, social
 * or device), so `session.created_at` is when the user last proved who they are; Better Auth only refreshes
 * expires_at and updated_at while a session is in use. Read from the database by token, never from the cookie cache.
 */
export const REAUTH_REQUIRED_CODE = "REAUTH_REQUIRED";
const DEFAULT_MAX_AGE_MINUTES = 10;

export function reauthMaxAgeSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const minutes = Number(env.ORG_DELETION_REAUTH_MINUTES);
  return (Number.isFinite(minutes) && minutes >= 1 && minutes <= 60 ? minutes : DEFAULT_MAX_AGE_MINUTES) * 60;
}

/** True when the current browser session was created within the window. A session that cannot be read counts as stale. */
export async function isFreshSession(maxAgeSeconds = reauthMaxAgeSeconds(), now = Date.now()): Promise<boolean> {
  const current = await getCachedAuthSession();
  const token = current?.session?.token;
  if (!token) return false;
  const [row] = await db.select({ createdAt: session.createdAt }).from(session).where(eq(session.token, token)).limit(1);
  return !!row && now - row.createdAt.getTime() <= maxAgeSeconds * 1000;
}

/** 403 the UI acts on: sign in again, then retry. */
export function reauthRequiredResponse(): NextResponse {
  return NextResponse.json(
    { error: "Confirm it is you: sign in again, then retry within a few minutes.", code: REAUTH_REQUIRED_CODE, maxAgeSeconds: reauthMaxAgeSeconds() },
    { status: 403 },
  );
}
