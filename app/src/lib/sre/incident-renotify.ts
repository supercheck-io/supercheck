import { and, eq, sql } from "drizzle-orm";
import { Queue, Worker } from "bullmq";

import { notificationProviders, sreIncidents, sreIncidentTimelineEvents } from "@/db/schema";
import { notInPendingOrganization } from "@/lib/deletion/visibility";
import { decryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
import { getRedisConnection, queueLogger } from "@/lib/queue";
import { incidentHeldForMaintenance } from "@/lib/sre/incident-maintenance";
import { notifyIncidentEvent } from "@/lib/sre/incident-notifier";
import { isPagingWebhook } from "@/lib/sre/notification-policy";
import { sweepSreIncidents } from "@/sre/lib/incident-sweep";
import { db } from "@/utils/db";
import { checkedTick } from "@/lib/sentry-lazy";

const QUEUE_NAME = "sre-incident-renotify";
const TICK_MS = 60_000;
// A policy switched on late must not wake incidents from long ago.
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

// Claim small batches so a restart mid-tick loses at most one batch; the cap keeps a late-enabled
// policy on a busy project from bursting (the rest follows on later ticks).
const CLAIM_BATCH = 10;
const MAX_PER_TICK = 50;

/** Reminder and escalation sends per organization per hour; a flapping monitor restarts the schedule on each reopen. */
export const ORG_SENDS_PER_HOUR = 30;

/** Counts one send for the org this hour; false once over the cap. Fails open without Redis (like the send dedupe). */
export async function allowOrgIncidentSend(organizationId: string, now = new Date()): Promise<boolean> {
  try {
    const redis = await getRedisConnection();
    const key = `supercheck:sre:renotify:org:${organizationId}:${Math.floor(now.getTime() / 3_600_000)}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 7200);
    return count <= ORG_SENDS_PER_HOUR;
  } catch (error) {
    queueLogger.warn({ err: error }, "Incident reminder rate limit unavailable; sending anyway");
    return true;
  }
}

type Claimed = {
  id: string;
  organizationId: string;
  projectId: string;
  reopenedAt: Date | null;
  openedAt: Date;
  count: number;
  max: number;
  prevAt: Date | null;
};

const toDate = (value: unknown) => (value == null ? null : value instanceof Date ? value : new Date(String(value)));

/**
 * Claims due reminders in one statement (FOR UPDATE SKIP LOCKED), counting each, so ticks and replicas never send the
 * same reminder twice. First reminder: N minutes after opening (count 0; `renotified_at IS NULL` also skips incidents an
 * older replica already claimed). Later ones: every M minutes while count < K.
 */
async function claimReminders(now: Date, limit: number, skip: string[]): Promise<Claimed[]> {
  const nowTs = sql`${now.toISOString()}::timestamptz`;
  const result = await db.execute(sql`
    UPDATE sre_incidents i
    SET renotified_at = ${nowTs}, renotify_count = i.renotify_count + 1
    FROM (
      SELECT i2.id, i2.renotified_at AS prev_at, p.renotify_max AS max
      FROM sre_incidents i2
      JOIN notification_policies p ON p.project_id = i2.project_id
      WHERE i2.status <> 'resolved' AND i2.acknowledged_at IS NULL AND i2.renotify_stopped_at IS NULL
        AND ${notInPendingOrganization(sql`i2.organization_id`)}
        AND p.renotify_unacked_minutes IS NOT NULL
        AND coalesce(i2.reopened_at, i2.created_at) >= ${nowTs} - make_interval(secs => ${MAX_AGE_MS / 1000})
        AND (
          (i2.renotify_count = 0 AND i2.renotified_at IS NULL
            AND coalesce(i2.reopened_at, i2.created_at) <= ${nowTs} - make_interval(mins => p.renotify_unacked_minutes))
          OR (i2.renotify_count >= 1 AND i2.renotify_count < p.renotify_max AND p.renotify_repeat_minutes IS NOT NULL
            AND i2.renotified_at <= ${nowTs} - make_interval(mins => p.renotify_repeat_minutes))
        )
        ${skip.length ? sql`AND i2.id NOT IN (${sql.join(skip.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
      ORDER BY coalesce(i2.reopened_at, i2.created_at)
      LIMIT ${limit}
      FOR UPDATE OF i2 SKIP LOCKED
    ) due
    WHERE i.id = due.id
    RETURNING i.id, i.organization_id, i.project_id, i.created_at, i.reopened_at, i.renotify_count, due.prev_at, due.max
  `);
  return (result as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    reopenedAt: toDate(row.reopened_at),
    openedAt: (toDate(row.reopened_at) ?? toDate(row.created_at)) as Date,
    count: Number(row.renotify_count),
    max: Number(row.max),
    prevAt: toDate(row.prev_at),
  }));
}

/** Gives a reminder back. Guarded on the claim, so a reopen during the send (which resets the count) is left alone. */
async function releaseReminder(incident: Claimed, claimedAt: Date) {
  await db
    .update(sreIncidents)
    .set({ renotifyCount: incident.count - 1, renotifiedAt: incident.prevAt })
    .where(and(eq(sreIncidents.id, incident.id), eq(sreIncidents.renotifyCount, incident.count), eq(sreIncidents.renotifiedAt, claimedAt)));
}

type ClaimedEscalation = { id: string; organizationId: string; projectId: string; channelId: string | null; userId: string | null };

/** Claims the one escalation step of incidents unacknowledged E minutes after opening; same shape as the reminder claim. */
async function claimEscalations(now: Date, limit: number, skip: string[]): Promise<ClaimedEscalation[]> {
  const nowTs = sql`${now.toISOString()}::timestamptz`;
  const result = await db.execute(sql`
    UPDATE sre_incidents i
    SET escalated_at = ${nowTs}
    FROM (
      SELECT i2.id, p.escalate_channel_id, p.escalate_user_id
      FROM sre_incidents i2
      JOIN notification_policies p ON p.project_id = i2.project_id
      WHERE i2.status <> 'resolved' AND i2.acknowledged_at IS NULL AND i2.renotify_stopped_at IS NULL
        AND i2.escalated_at IS NULL
        AND ${notInPendingOrganization(sql`i2.organization_id`)}
        AND p.escalate_after_minutes IS NOT NULL
        AND coalesce(i2.reopened_at, i2.created_at) >= ${nowTs} - make_interval(secs => ${MAX_AGE_MS / 1000})
        AND coalesce(i2.reopened_at, i2.created_at) <= ${nowTs} - make_interval(mins => p.escalate_after_minutes)
        ${skip.length ? sql`AND i2.id NOT IN (${sql.join(skip.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
      ORDER BY coalesce(i2.reopened_at, i2.created_at)
      LIMIT ${limit}
      FOR UPDATE OF i2 SKIP LOCKED
    ) due
    WHERE i.id = due.id
    RETURNING i.id, i.organization_id, i.project_id, due.escalate_channel_id, due.escalate_user_id
  `);
  return (result as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    channelId: row.escalate_channel_id ? String(row.escalate_channel_id) : null,
    userId: row.escalate_user_id ? String(row.escalate_user_id) : null,
  }));
}

async function releaseEscalation(id: string, claimedAt: Date) {
  await db.update(sreIncidents).set({ escalatedAt: null }).where(and(eq(sreIncidents.id, id), eq(sreIncidents.escalatedAt, claimedAt)));
}

/** The escalation target still exists and may receive it: an enabled, non-paging channel of the project, or a member who can act. */
async function escalationTargetUsable(incident: ClaimedEscalation): Promise<boolean> {
  if (incident.channelId) {
    const [channel] = await db
      .select({ type: notificationProviders.type, config: notificationProviders.config, projectId: notificationProviders.projectId })
      .from(notificationProviders)
      .where(
        and(
          eq(notificationProviders.id, incident.channelId),
          eq(notificationProviders.isEnabled, true),
          eq(notificationProviders.organizationId, incident.organizationId),
          eq(notificationProviders.projectId, incident.projectId),
        ),
      )
      .limit(1);
    if (!channel) return false;
    try {
      return !isPagingWebhook(channel.type, decryptNotificationProviderConfig(channel.config, channel.projectId ?? undefined) as Record<string, unknown>);
    } catch {
      return false;
    }
  }
  if (incident.userId) {
    // Lazy import: incident-lifecycle imports the notifier.
    const { isAssignableUser } = await import("./incident-lifecycle");
    return isAssignableUser(incident.organizationId, incident.projectId, incident.userId);
  }
  return false;
}

/**
 * Sends due reminders (first after N minutes, then every M minutes, at most K) and the one escalation step to incidents
 * still unacknowledged. Each send is claimed before it goes out; a failed, held (maintenance) or rate-limited send gives
 * the claim back for a later tick without using up a reminder.
 */
/** `stats.failed` counts sends that failed everywhere (they are released for the next tick). */
export async function renotifyUnacknowledgedIncidents(now = new Date(), stats?: { failed: number }) {
  let total = 0;
  const released: string[] = [];
  while (total < MAX_PER_TICK) {
    const claimed = await claimReminders(now, Math.min(CLAIM_BATCH, MAX_PER_TICK - total), released);
    if (!claimed.length) break;
    total += claimed.length;
    // RETURNING has no order guarantee; send oldest first.
    claimed.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());

    for (const incident of claimed) {
      const giveBack = async () => {
        released.push(incident.id);
        await releaseReminder(incident, now);
      };
      // Session hook for maintenance windows: a held send must not claim, so paging resumes when the window ends.
      if ((await incidentHeldForMaintenance(incident.id, now).catch(() => false)) || !(await allowOrgIncidentSend(incident.organizationId, now))) {
        await giveBack();
        continue;
      }
      let delivered = false;
      try {
        delivered = await notifyIncidentEvent({
          organizationId: incident.organizationId,
          projectId: incident.projectId,
          incidentId: incident.id,
          event: "unacknowledged",
          // Per reopen cycle and per reminder, so each reminder has its own dedupe window.
          dedupeDiscriminator: `renotify:${incident.reopenedAt?.getTime() ?? 0}:${incident.count}`,
          reminder: { n: incident.count, of: incident.max },
        });
      } catch (error) {
        queueLogger.error({ err: error, incidentId: incident.id }, "Incident re-notify send failed");
      }
      if (delivered === false) {
        if (stats) stats.failed++;
        await giveBack();
      }
    }
  }

  const releasedEscalations: string[] = [];
  while (total < MAX_PER_TICK) {
    const claimed = await claimEscalations(now, Math.min(CLAIM_BATCH, MAX_PER_TICK - total), releasedEscalations);
    if (!claimed.length) break;
    total += claimed.length;
    for (const incident of claimed) {
      const giveBack = async () => {
        releasedEscalations.push(incident.id);
        await releaseEscalation(incident.id, now);
      };
      if ((await incidentHeldForMaintenance(incident.id, now).catch(() => false)) || !(await allowOrgIncidentSend(incident.organizationId, now))) {
        await giveBack();
        continue;
      }
      let usable: boolean;
      try {
        usable = await escalationTargetUsable(incident);
      } catch (error) {
        queueLogger.error({ err: error, incidentId: incident.id }, "Incident escalation target lookup failed");
        await giveBack();
        continue;
      }
      if (!usable) {
        // Terminal: the target was removed. Keep escalated_at so it neither loops nor passes silently.
        await db
          .insert(sreIncidentTimelineEvents)
          .values({ incidentId: incident.id, eventType: "notification", actorType: "system", eventData: { kind: "escalation", reached: 0, channels: [], emailed: 0 } })
          .catch((error: unknown) => queueLogger.error({ err: error, incidentId: incident.id }, "Incident escalation timeline write failed"));
        continue;
      }
      let delivered = false;
      try {
        delivered = await notifyIncidentEvent({
          organizationId: incident.organizationId,
          projectId: incident.projectId,
          incidentId: incident.id,
          event: "escalated",
          targets: incident.channelId ? { providerIds: [incident.channelId] } : { userIds: [incident.userId as string] },
          dedupeDiscriminator: `escalate:${now.getTime()}`,
        });
      } catch (error) {
        queueLogger.error({ err: error, incidentId: incident.id }, "Incident escalation send failed");
      }
      if (delivered === false) {
        if (stats) stats.failed++;
        await giveBack();
      }
    }
  }
  return total;
}

let worker: Worker | undefined;
let queue: Queue | undefined;

export async function initializeIncidentRenotifyScheduler() {
  if (worker) return;
  const redis = await getRedisConnection();
  queue = new Queue(QUEUE_NAME, { connection: redis });
  queue.on("error", (error) => queueLogger.error({ err: error }, "Incident re-notify queue error"));
  worker = new Worker(
    QUEUE_NAME,
    async () => {
      try {
        const stats = { failed: 0 };
        // Every reminder failing to send is a failed tick (claims are released and retried).
        await checkedTick("incident-renotify", { type: "interval", value: 1, unit: "minute" }, () => renotifyUnacknowledgedIncidents(new Date(), stats), (total) => (total > 0 && stats.failed === total ? "error" : true));
      } finally {
        // Same 60 s tick, independent of the above: lost recovery signals and detached triage runs (sweepSreIncidents).
        await sweepSreIncidents().catch((error) => queueLogger.error({ err: error }, "Incident sweep failed"));
      }
    },
    { connection: redis.duplicate(), concurrency: 1, lockDuration: 120_000 },
  );
  worker.on("error", (error) => queueLogger.error({ err: error }, "Incident re-notify worker error"));
  await queue.upsertJobScheduler(
    "incident-renotify",
    { every: TICK_MS },
    { name: "tick", data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } },
  );
}

export function getIncidentRenotifyQueue() {
  return queue;
}

export async function shutdownIncidentRenotifyScheduler() {
  const w = worker;
  const q = queue;
  worker = undefined;
  queue = undefined;
  await Promise.allSettled([w?.close(), q?.close()]);
}
