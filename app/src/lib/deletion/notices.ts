import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { member, organization, user } from "@/db/schema";
import { EmailService, isEmailConfigured } from "@/lib/email-service";
import { renderOrganizationDeletionEmail } from "@/lib/email-renderer";
import type { OrganizationDeletionKind } from "@/emails";
import { metaPatch, type DeletionMeta } from "./org-state";

/**
 * Emails to organization owners about a deletion: on request, 7 and 1 day before the purge, and on completion.
 * Each is claimed with an atomic marker in organization.deletion_meta before sending, so concurrent pods and repeated
 * sweeps send it at most once; a failed send releases the marker for the next sweep. Without SMTP nothing is attempted.
 */

export type NoticeKey = "noticeRequested" | "notice7d" | "notice1d";
const KIND: Record<NoticeKey, OrganizationDeletionKind> = { noticeRequested: "requested", notice7d: "reminder", notice1d: "reminder" };
const DAYS: Partial<Record<NoticeKey, number>> = { notice7d: 7, notice1d: 1 };
const SWEEP_PAGE = 500;
const DAY_MS = 24 * 60 * 60_000;

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/+$/, "");

export async function sendOrganizationNotice(organizationId: string, key: NoticeKey): Promise<"sent" | "skipped" | "failed"> {
  if (!isEmailConfigured()) return "skipped";
  // Claim: only the pod that flips the marker sends.
  const [org] = await db.update(organization)
    .set({ deletionMeta: sql`${organization.deletionMeta} || ${JSON.stringify({ [key]: new Date().toISOString() })}::jsonb` })
    .where(and(eq(organization.id, organizationId), sql`NOT (${organization.deletionMeta} ? ${key})`))
    .returning({ name: organization.name, purgeAfter: organization.deletionPurgeAfter });
  if (!org) return "skipped";
  const deliveredKey = `${key}To` as const;
  const release = () => db.update(organization).set({ deletionMeta: sql`${organization.deletionMeta} - ${key}::text` }).where(eq(organization.id, organizationId));
  try {
    const owners = await db.select({ email: user.email }).from(member).innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, organizationId), eq(member.role, "org_owner"), isNotNull(user.email)));
    const recipients = [...new Set(owners.map((owner) => owner.email))];
    if (recipients.length === 0) return "skipped"; // sole-member account deletion: the owner is already gone
    // Owners an earlier, partly failed attempt already reached are skipped, so a retry never mails them twice.
    const [current] = await db.select({ meta: organization.deletionMeta }).from(organization).where(eq(organization.id, organizationId));
    const delivered = new Set(((current?.meta as DeletionMeta | undefined)?.[deliveredKey]) ?? []);
    const todo = recipients.filter((email) => !delivered.has(email));
    const rendered = await renderOrganizationDeletionEmail({
      organizationName: org.name,
      kind: KIND[key],
      purgeDate: org.purgeAfter ? org.purgeAfter.toUTCString() : undefined,
      daysRemaining: DAYS[key],
      settingsUrl: `${appUrl()}/org-admin`,
    });
    const result = todo.length
      ? await EmailService.getInstance().sendEmailToMultiple({ recipients: todo, subject: rendered.subject, text: rendered.text, html: rendered.html })
      : { sentCount: 0, failedAddresses: [] as string[], skippedAddresses: [] as string[] };
    if (result.failedAddresses.length === 0) return "sent";
    // Some owners failed: remember who got it, release the marker, and let the next sweep retry only the rest.
    const reached = new Set(delivered);
    for (const email of todo) if (!result.failedAddresses.includes(email)) reached.add(email);
    await db.update(organization).set({ deletionMeta: metaPatch(organization.deletionMeta, { [deliveredKey]: [...reached] }) }).where(eq(organization.id, organizationId));
    await release();
    return "failed";
  } catch (error) {
    console.error(`[ORG_DELETION] Could not send ${key} for organization ${organizationId}:`, error);
    await release().catch(() => undefined);
    return "failed";
  }
}

/** Sweep: send the request email that did not go out, and the 7 day and 1 day reminders that are due. Short windows (self-hosted) skip reminders that no longer make sense. */
export async function sendDueReminders(now = new Date()): Promise<number> {
  let sent = 0;
  // Keyset pages over every pending organization, so a large backlog of rows that need nothing never starves the rest.
  for (let after: string | undefined; ;) {
    const pending = await db.select({ id: organization.id, requestedAt: organization.deletionRequestedAt, purgeAfter: organization.deletionPurgeAfter, meta: organization.deletionMeta })
      .from(organization).where(and(isNotNull(organization.deletionRequestedAt), after ? gt(organization.id, after) : undefined)).orderBy(asc(organization.id)).limit(SWEEP_PAGE);
    if (pending.length === 0) break;
    after = pending[pending.length - 1].id;
    for (const org of pending) {
      if (!org.requestedAt || !org.purgeAfter) continue;
      const remaining = org.purgeAfter.getTime() - now.getTime();
      const window = org.purgeAfter.getTime() - org.requestedAt.getTime();
      if (remaining <= 0) continue;
      // A request email that failed at request time (SMTP outage) released its marker: send it now.
      if (!org.meta.noticeRequested && (await sendOrganizationNotice(org.id, "noticeRequested")) === "sent") sent++;
      if (remaining <= DAY_MS && window > DAY_MS && !org.meta.notice1d) { if ((await sendOrganizationNotice(org.id, "notice1d")) === "sent") sent++; }
      else if (remaining <= 7 * DAY_MS && remaining > DAY_MS && window > 7 * DAY_MS && !org.meta.notice7d) { if ((await sendOrganizationNotice(org.id, "notice7d")) === "sent") sent++; }
    }
    if (pending.length < SWEEP_PAGE) break;
  }
  return sent;
}

/** After the organization row is gone there is no marker to claim: best effort, once, from the purge's final step. */
export async function sendCompletionNotice(organizationName: string, recipients: string[]): Promise<void> {
  if (!isEmailConfigured() || recipients.length === 0) return;
  const rendered = await renderOrganizationDeletionEmail({ organizationName, kind: "completed" });
  await EmailService.getInstance().sendEmailToMultiple({ recipients: [...new Set(recipients)], subject: rendered.subject, text: rendered.text, html: rendered.html });
}
