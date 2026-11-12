import { createHmac } from "node:crypto";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { auditLogs } from "@/db/schema";

/** Audit rows keep their history for this long, then are purged (owner decision: 12 months). */
export const AUDIT_RETENTION_DAYS = 365;
/** After this long the people in audit details are no longer identifiable by email: addresses are replaced by a hash. */
export const AUDIT_EMAIL_SCRUB_DAYS = Math.max(1, Number(process.env.AUDIT_EMAIL_SCRUB_DAYS) || 30);
export const AUDIT_SCRUBBED_MARKER = "emailsScrubbed";

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * Keyed with a key derived from the server secret, so a hash cannot be reversed by hashing a list of known emails
 * (an unkeyed hash of an email is guessable). Stable for one deployment, so a user's events can still be correlated.
 */
let cachedKey: string | null = null;
function emailHashKey(): string {
  if (cachedKey) return cachedKey;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== "test") throw new Error("BETTER_AUTH_SECRET is required to scrub audit emails");
    return "test-only-audit-key";
  }
  cachedKey = createHmac("sha256", secret).update("supercheck:audit-email:v1").digest("hex");
  return cachedKey;
}
export const hashEmail = (email: string) => `email:${createHmac("sha256", emailHashKey()).update(email.trim().toLowerCase()).digest("hex").slice(0, 16)}`;

/** Replace every email address found in strings anywhere in the value, keys included in nothing: values only. */
export function scrubEmails<T>(value: T): T {
  if (typeof value === "string") return value.replace(EMAIL, (match) => hashEmail(match)) as T;
  if (Array.isArray(value)) return value.map((item) => scrubEmails(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, scrubEmails(item)])) as T;
  }
  return value;
}

// Must match the partial index audit_logs_unscrubbed_created_idx so finished rows are not walked again. The marker is a constant, not input.
const AUDIT_UNSCRUBBED = sql`(${auditLogs.details} IS NULL OR NOT (${auditLogs.details} ? ${sql.raw(`'${AUDIT_SCRUBBED_MARKER}'`)}))`;

export async function scrubAuditEmails(options: { dryRun: boolean; batchSize: number; maxRecords: number }): Promise<number> {
  const cutoff = new Date(Date.now() - AUDIT_EMAIL_SCRUB_DAYS * 24 * 60 * 60 * 1000);
  let scrubbed = 0;
  while (scrubbed < options.maxRecords) {
    const where = and(lt(auditLogs.createdAt, cutoff), AUDIT_UNSCRUBBED);
    if (options.dryRun) {
      const rows = await db.select({ id: auditLogs.id }).from(auditLogs).where(where).limit(options.batchSize);
      return scrubbed + rows.length;
    }
    // Select and update in one transaction with FOR UPDATE: account deletion also rewrites old rows (deletedUserId), and a
    // details object read before its commit must never be written back over it. A row it changed while we waited is re-read.
    const count = await db.transaction(async (tx) => {
      const rows = await tx.select({ id: auditLogs.id, details: auditLogs.details }).from(auditLogs).where(where)
        .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)).limit(options.batchSize).for("update");
      for (const row of rows) {
        // The teardown marker carries only a subscription id and is read by billing webhooks: nothing in it is an email.
        await tx.update(auditLogs).set({ details: { ...scrubEmails(row.details ?? {}), [AUDIT_SCRUBBED_MARKER]: true } as typeof row.details })
          .where(eq(auditLogs.id, row.id));
      }
      return rows.length;
    });
    if (count === 0) break;
    scrubbed += count;
    if (count < options.batchSize) break;
  }
  return scrubbed;
}

