import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import {
  executionEntitlements,
  member,
  monitors,
  organization,
  statusPages,
  trialSuspensions,
  user,
} from "@/db/schema";
import type { TrialNotificationKind } from "@/emails";
import { db } from "@/utils/db";
import { hasPaidAccess } from "@/lib/execution/trial-limits";

/** How many expired trials one run processes; the rest are picked up on the next run. */
const BATCH_SIZE = 50;
/** How long one run keeps draining batches of expired trials. */
const DRAIN_BUDGET_MS = 20_000;

/**
 * Stops the repeatable BullMQ schedule of paused monitors. The scheduled job is a no-op for a paused
 * monitor, but it keeps firing and would be the only trace of a stale schedule after a restart.
 * Best effort: a failure here must not undo the lifecycle change.
 */
async function unscheduleMonitors(
  monitorRows: Array<{ id: string; scheduledJobId: string | null }>,
  database: Pick<typeof db, "update">,
): Promise<void> {
  if (!monitorRows.length) return;
  const { deleteScheduledMonitor } = await import("@/lib/monitor-scheduler");
  for (const row of monitorRows) {
    try {
      if (row.scheduledJobId) await deleteScheduledMonitor(row.scheduledJobId);
      await deleteScheduledMonitor(row.id);
      await database
        .update(monitors)
        .set({ scheduledJobId: null })
        .where(eq(monitors.id, row.id));
    } catch (error) {
      console.error(`Failed to unschedule monitor ${row.id} at trial end:`, error);
    }
  }
}

/**
 * Re-creates the schedule of monitors resumed by a subscription. The status was set to pending, so
 * the first check sets the real state. Best effort: the webhook has already saved the subscription.
 */
async function rescheduleMonitors(
  monitorIds: string[],
  database: Pick<typeof db, "select" | "update">,
): Promise<void> {
  if (!monitorIds.length) return;
  const { scheduleMonitor } = await import("@/lib/monitor-scheduler");
  const rows = await database
    .select()
    .from(monitors)
    .where(inArray(monitors.id, monitorIds));
  for (const monitor of rows) {
    if (!monitor.frequencyMinutes || monitor.frequencyMinutes <= 0) continue;
    try {
      const schedulerId = await scheduleMonitor({
        monitorId: monitor.id,
        frequencyMinutes: monitor.frequencyMinutes,
        jobData: {
          monitorId: monitor.id,
          projectId: monitor.projectId ?? undefined,
          type: monitor.type as never,
          target: monitor.target,
          config: monitor.config as never,
          frequencyMinutes: monitor.frequencyMinutes,
        },
        retryLimit: 3,
      });
      await database
        .update(monitors)
        .set({ scheduledJobId: schedulerId })
        .where(eq(monitors.id, monitor.id));
    } catch (error) {
      console.error(`Failed to reschedule monitor ${monitor.id} after trial:`, error);
    }
  }
}

export interface TrialEndResult {
  organizations: number;
  monitorsPaused: number;
  statusPagesArchived: number;
}

type Database = Pick<typeof db, "select" | "selectDistinct" | "transaction" | "update">;

/**
 * Ends every expired trial exactly once. Monitors are paused and published
 * status pages are archived so an expired trial stops consuming resources.
 * Nothing is deleted: each change is recorded in trial_suspensions so
 * subscribing restores the organization's setup. Safe to run repeatedly.
 */
export async function endExpiredTrials(
  options: { now?: Date; database?: Database } = {},
): Promise<TrialEndResult> {
  const now = options.now ?? new Date();
  const database = options.database ?? db;
  const result: TrialEndResult = {
    organizations: 0,
    monitorsPaused: 0,
    statusPagesArchived: 0,
  };

  const processExpired = async (expired: Array<{ organizationId: string }>) => {
  for (const { organizationId } of expired) {
    await database.transaction(async (tx) => {
      // Serialize with a concurrent subscription or restore for this organization.
      const [org] = await tx
        .select()
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for("update");
      const markEnded = () =>
        tx
          .update(executionEntitlements)
          .set({ lifecycleEndedAt: now })
          .where(
            and(
              eq(executionEntitlements.organizationId, organizationId),
              isNull(executionEntitlements.lifecycleEndedAt),
            ),
          );

      // A paying organization keeps everything; only record that the trial is over.
      if (!org || hasPaidAccess(org, now)) {
        await markEnded();
        return;
      }

      const running = await tx
        .select({
          id: monitors.id,
          status: monitors.status,
          scheduledJobId: monitors.scheduledJobId,
        })
        .from(monitors)
        .where(
          and(
            eq(monitors.organizationId, organizationId),
            ne(monitors.status, "paused"),
          ),
        );
      const published = await tx
        .select({ id: statusPages.id })
        .from(statusPages)
        .where(
          and(
            eq(statusPages.organizationId, organizationId),
            eq(statusPages.status, "published"),
          ),
        );

      const suspensions = [
        ...running.map((monitor) => ({
          organizationId,
          resourceType: "monitor" as const,
          resourceId: monitor.id,
          previousStatus: monitor.status as string,
        })),
        ...published.map((page) => ({
          organizationId,
          resourceType: "status_page" as const,
          resourceId: page.id,
          previousStatus: "published",
        })),
      ];
      if (suspensions.length)
        await tx
          .insert(trialSuspensions)
          .values(suspensions)
          .onConflictDoNothing();

      if (running.length) {
        await tx
          .update(monitors)
          .set({ status: "paused", updatedAt: now })
          .where(
            inArray(
              monitors.id,
              running.map((m) => m.id),
            ),
          );
      }
      if (published.length) {
        await tx
          .update(statusPages)
          .set({ status: "archived", updatedAt: now })
          .where(
            inArray(
              statusPages.id,
              published.map((p) => p.id),
            ),
          );
      }
      await markEnded();

      result.organizations += 1;
      result.monitorsPaused += running.length;
      result.statusPagesArchived += published.length;
      toUnschedule.push(...running);
    });
  }
  };

  const toUnschedule: Array<{ id: string; scheduledJobId: string | null }> = [];
  const deadline = Date.now() + DRAIN_BUDGET_MS;
  // A cohort of trials that began together also ends together: keep draining batches (within a time
  // budget) instead of leaving most of them running until later runs of the job.
  for (;;) {
    const expired = await database
      .select({ organizationId: executionEntitlements.organizationId })
      .from(executionEntitlements)
      .where(
        and(
          lte(executionEntitlements.expiresAt, now),
          isNull(executionEntitlements.lifecycleEndedAt),
        ),
      )
      .orderBy(executionEntitlements.expiresAt)
      .limit(BATCH_SIZE);
    await processExpired(expired);
    if (expired.length < BATCH_SIZE || Date.now() >= deadline) break;
  }

  // After every transaction has committed, so a rolled-back pause never loses a schedule.
  await unscheduleMonitors(toUnschedule, database);

  return result;
}

/**
 * Brings back what the trial end paused or archived once the organization
 * subscribes. A resource the user changed since is left as they set it.
 */
export async function restoreTrialSuspensions(
  organizationId: string,
  database: Pick<typeof db, "transaction" | "select" | "update"> = db,
): Promise<{ monitorsResumed: number; statusPagesRestored: number }> {
  const resumedIds: string[] = [];
  const result = await database.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(trialSuspensions)
      .where(eq(trialSuspensions.organizationId, organizationId));
    const monitorIds = rows
      .filter((row) => row.resourceType === "monitor")
      .map((row) => row.resourceId);
    const pageIds = rows
      .filter((row) => row.resourceType === "status_page")
      .map((row) => row.resourceId);
    const now = new Date();

    // A resumed monitor starts as pending so its first check sets the real state.
    const resumed = monitorIds.length
      ? await tx
          .update(monitors)
          .set({ status: "pending", updatedAt: now })
          .where(
            and(
              inArray(monitors.id, monitorIds),
              eq(monitors.status, "paused"),
            ),
          )
          .returning({ id: monitors.id })
      : [];
    const restored = pageIds.length
      ? await tx
          .update(statusPages)
          .set({ status: "published", updatedAt: now })
          .where(
            and(
              inArray(statusPages.id, pageIds),
              eq(statusPages.status, "archived"),
            ),
          )
          .returning({ id: statusPages.id })
      : [];
    if (rows.length)
      await tx
        .delete(trialSuspensions)
        .where(eq(trialSuspensions.organizationId, organizationId));

    resumedIds.push(...resumed.map((row) => row.id));
    return {
      monitorsResumed: resumed.length,
      statusPagesRestored: restored.length,
    };
  });
  // Scheduling is a Redis side effect, so it runs once the status change is written.
  await rescheduleMonitors(resumedIds, database);
  return result;
}

/**
 * Safety net for the activation webhook: restoring is best effort there, so a failure would leave a
 * paying organization paused. Any organization with outstanding suspensions that now has paid access
 * is restored here on every lifecycle run. Idempotent.
 */
export async function reconcilePaidTrialSuspensions(
  options: { now?: Date; database?: Database & Pick<typeof db, "update"> } = {},
): Promise<{ organizations: number; monitorsResumed: number; statusPagesRestored: number }> {
  const now = options.now ?? new Date();
  const database = options.database ?? db;
  const result = { organizations: 0, monitorsResumed: 0, statusPagesRestored: 0 };
  // Filter on paid access in SQL: expired trials that never subscribe keep their rows forever, and
  // they must not fill the batch ahead of a paying organization that still needs its restore.
  const orgs = await database
    .selectDistinct({
      id: organization.id,
      polarCustomerId: organization.polarCustomerId,
      subscriptionPlan: organization.subscriptionPlan,
      subscriptionStatus: organization.subscriptionStatus,
      subscriptionEndsAt: organization.subscriptionEndsAt,
    })
    .from(trialSuspensions)
    .innerJoin(organization, eq(organization.id, trialSuspensions.organizationId))
    .where(
      and(
        isNotNull(organization.polarCustomerId),
        inArray(organization.subscriptionPlan, ["plus", "pro"]),
        or(
          inArray(organization.subscriptionStatus, ["active", "past_due"]),
          and(eq(organization.subscriptionStatus, "canceled"), gt(organization.subscriptionEndsAt, now)),
        ),
      ),
    )
    .limit(BATCH_SIZE);
  for (const org of orgs) {
    if (!hasPaidAccess(org, now)) continue;
    try {
      const restored = await restoreTrialSuspensions(org.id, database);
      result.organizations += 1;
      result.monitorsResumed += restored.monitorsResumed;
      result.statusPagesRestored += restored.statusPagesRestored;
    } catch (error) {
      console.error(`Failed to restore trial resources for org ${org.id}:`, error);
    }
  }
  return result;
}

export interface TrialReminderDelivery {
  kind: TrialNotificationKind;
  organizationId: string;
  organizationName: string;
  daysRemaining: number;
  recipients: string[];
}

/** Sends one reminder; resolves true only if it reached at least one recipient. */
export type DeliverTrialReminder = (
  delivery: TrialReminderDelivery,
) => Promise<boolean>;

export interface TrialReminderResult {
  midway: number;
  ending: number;
  ended: number;
}

const DAY_MS = 86_400_000;
const MIDWAY_DAYS = 7;
const REMINDER_BATCH_SIZE = 50;

const REMINDER_COLUMN = {
  midway: executionEntitlements.midwayNotifiedAt,
  ending: executionEntitlements.endingNotifiedAt,
  ended: executionEntitlements.endedNotifiedAt,
} as const;

/** Trials that currently qualify for the reminder, never one already sent. */
function reminderCondition(kind: TrialNotificationKind, now: Date) {
  const ends = executionEntitlements.expiresAt;
  if (kind === "midway") {
    return and(
      gt(ends, new Date(now.getTime() + DAY_MS)),
      lte(ends, new Date(now.getTime() + MIDWAY_DAYS * DAY_MS)),
      isNull(executionEntitlements.midwayNotifiedAt),
    );
  }
  if (kind === "ending") {
    return and(
      gt(ends, now),
      lte(ends, new Date(now.getTime() + DAY_MS)),
      isNull(executionEntitlements.endingNotifiedAt),
    );
  }
  return and(
    lte(ends, now),
    isNotNull(executionEntitlements.lifecycleEndedAt),
    isNull(executionEntitlements.endedNotifiedAt),
  );
}

/**
 * Emails the organization owners at the middle of the trial, in its last day,
 * and after it ends. Each reminder is sent at most once, only to verified
 * owners, and never to an organization that has since subscribed. A reminder
 * that could not be delivered is retried on the next run.
 */
export async function sendTrialReminders(options: {
  deliver: DeliverTrialReminder;
  now?: Date;
  database?: Pick<typeof db, "select" | "update">;
}): Promise<TrialReminderResult> {
  const now = options.now ?? new Date();
  const database = options.database ?? db;
  const result: TrialReminderResult = { midway: 0, ending: 0, ended: 0 };

  for (const kind of ["midway", "ending", "ended"] as const) {
    const due = await database
      .select({
        organizationId: executionEntitlements.organizationId,
        expiresAt: executionEntitlements.expiresAt,
        name: organization.name,
        polarCustomerId: organization.polarCustomerId,
        subscriptionPlan: organization.subscriptionPlan,
        subscriptionStatus: organization.subscriptionStatus,
        subscriptionEndsAt: organization.subscriptionEndsAt,
      })
      .from(executionEntitlements)
      .innerJoin(
        organization,
        eq(organization.id, executionEntitlements.organizationId),
      )
      .where(reminderCondition(kind, now))
      .limit(REMINDER_BATCH_SIZE);

    const markSent = (organizationId: string) =>
      database
        .update(executionEntitlements)
        .set({ [columnKey(kind)]: now })
        .where(
          and(
            eq(executionEntitlements.organizationId, organizationId),
            isNull(REMINDER_COLUMN[kind]),
          ),
        );

    for (const entry of due) {
      // A subscriber does not need trial reminders; record it so it is not reconsidered.
      if (hasPaidAccess(entry, now)) {
        await markSent(entry.organizationId);
        continue;
      }
      const owners = await database
        .select({ email: user.email, role: member.role })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(
          and(
            eq(member.organizationId, entry.organizationId),
            inArray(member.role, ["org_owner", "org_admin"]),
            eq(user.emailVerified, true),
          ),
        );
      // Owners first; when none has a verified address, the admins hear about the trial instead.
      const owned = owners.filter((owner) => owner.role === "org_owner");
      const recipients = [
        ...new Set((owned.length ? owned : owners).map((owner) => owner.email)),
      ];
      if (recipients.length === 0) {
        await markSent(entry.organizationId);
        continue;
      }
      const delivered = await options.deliver({
        kind,
        organizationId: entry.organizationId,
        organizationName: entry.name,
        daysRemaining: Math.max(
          0,
          Math.ceil((entry.expiresAt.getTime() - now.getTime()) / DAY_MS),
        ),
        recipients,
      });
      if (!delivered) continue;
      await markSent(entry.organizationId);
      result[kind] += 1;
    }
  }

  return result;
}

function columnKey(kind: TrialNotificationKind) {
  return kind === "midway"
    ? "midwayNotifiedAt"
    : kind === "ending"
      ? "endingNotifiedAt"
      : "endedNotifiedAt";
}
