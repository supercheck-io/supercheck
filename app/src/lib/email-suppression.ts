import { and, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { emailSuppressions } from "@/db/schema";

const MAX_DIAGNOSTIC = 500;
/** Mailboxes recover; a bounce older than this no longer blocks sending. */
export const SUPPRESSION_TTL_DAYS = 90;

/** The lowercased addresses in `emails` that hard-bounced before. */
export async function findSuppressedEmails(emails: string[]): Promise<Set<string>> {
  const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (unique.length === 0) return new Set();
  const rows = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(
      and(
        inArray(emailSuppressions.email, unique),
        gt(emailSuppressions.lastBouncedAt, new Date(Date.now() - SUPPRESSION_TTL_DAYS * 86_400_000)),
      ),
    );
  return new Set(rows.map((row) => row.email));
}

/** Records a hard bounce so the address is never mailed again; repeats bump the counter. */
export async function suppressEmail(input: {
  email: string;
  reason: string;
  source: string;
  diagnostic?: string | null;
  bouncedAt?: Date;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) return;
  const at = input.bouncedAt ?? new Date();
  const diagnostic = input.diagnostic ? input.diagnostic.slice(0, MAX_DIAGNOSTIC) : null;
  await db
    .insert(emailSuppressions)
    .values({ email, reason: input.reason.slice(0, 100), source: input.source, diagnostic, firstBouncedAt: at, lastBouncedAt: at })
    .onConflictDoUpdate({
      target: emailSuppressions.email,
      set: {
        bounceCount: sql`${emailSuppressions.bounceCount} + 1`,
        lastBouncedAt: at,
        reason: input.reason.slice(0, 100),
        diagnostic,
      },
    });
}
