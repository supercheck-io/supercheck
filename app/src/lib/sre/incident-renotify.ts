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
/** Sends per tick, for reminders and (separately) for escalations. Held or capped claims do not count. */
const MAX_PER_TICK = 50;
/** Hard bound on claims per tick, including ones given straight back (maintenance, org cap). */
const MAX_CLAIMS_PER_TICK = 500;

/** Incidents found held for maintenance are skipped by this process's claims for a few minutes, so a large held
 * backlog cannot fill every tick's claim budget for the length of the window. Per process; a recheck after the TTL. */
const HELD_TTL_MS = 5 * 60_000;
const HELD_MAX = 2_000;
const heldUntil = new Map<string, number>();

function rememberHeld(id: string, now: Date) {
  if (heldUntil.size >= HELD_MAX) heldUntil.delete(heldUntil.keys().next().value as string);
  heldUntil.set(id, now.getTime() + HELD_TTL_MS);
}

function recentlyHeld(now: Date) {
  const ids: string[] = [];
  for (const [id, until] of heldUntil) {
    if (until <= now.getTime()) heldUntil.delete(id);
    else ids.push(id);
  }
  return ids;
}

/** Test hook: forget remembered holds. */
export function resetHeldIncidentsForTest() {
  heldUntil.clear();
}

/** Reminder and escalation sends per organization per hour; a flapping monitor restarts the schedule on each reopen.
 * Escalations have their own budget, so a burst of reminders can never hold back the one escalation. */
export const ORG_SENDS_PER_HOUR = 30;

/** A send that fails is retried after 2, 4, 8 and 16 minutes; after this many failures it is given up (noted on the
 * timeline), so a dead channel is not hit every minute for two days. */
export const MAX_SEND_FAILURES = 5;
const retryDelayMs = (failures: number) => 2 ** failures * 60_000;

type SendKind = "reminder" | "escalation";

const orgCapKey = (kind: SendKind, organizationId: string, now: Date) =>
  `supercheck:sre:${kind === "reminder" ? "renotify" : "escalate"}:org:${organizationId}:${Math.floor(now.getTime() / 3_600_000)}`;

/** True while the org has sent fewer than the hourly cap of this kind. Only delivered sends count, so a channel that
 * keeps failing cannot use up the org's budget. Fails open without Redis (like the send dedupe). */
export async function allowOrgIncidentSend(organizationId: string, now = new Date(), kind: SendKind = "reminder"): Promise<boolean> {
  try {
    const redis = await getRedisConnection();
    return Number((await redis.get(orgCapKey(kind, organizationId, now))) ?? 0) < ORG_SENDS_PER_HOUR;
  } catch (error) {
    queueLogger.warn({ err: error }, "Incident reminder rate limit unavailable; sending anyway");
    return true;
  }
}

/** Counts one delivered reminder or escalation against the org's hourly cap. */
export async function recordOrgIncidentSend(organizationId: string, now = new Date(), kind: SendKind = "reminder"): Promise<void> {
  try {
    const redis = await getRedisConnection();
    const key = orgCapKey(kind, organizationId, now);
    if ((await redis.incr(key)) === 1) await redis.expire(key, 7200);
  } catch {
    // Fails open, like the check.
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
  prevCount: number;
  prevAt: Date | null;
  failures: number;
};

const toDate = (value: unknown) => (value == null ? null : value instanceof Date ? value : new Date(String(value)));

const skipSql = (column: string, ids: string[]) =>
  ids.length ? sql`AND ${sql.raw(column)} NOT IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;

/**
 * Claims due reminders in one statement (FOR UPDATE SKIP LOCKED), counting each, so ticks and replicas never send the
 * same reminder twice. First reminder: N minutes after opening (`renotified_at IS NULL`, which also skips incidents an
 * older replica already claimed). Later ones: every M minutes while fewer than K were sent. Rows written by older app
 * replicas during a rollout (a reopen that only cleared renotified_at, or a reminder that set renotified_at without a
 * count) are read as "first reminder due" and "one sent", so neither loses its reminders. A failed send waits for
 * its backoff (renotify_retry_at).
 */
async function claimReminders(now: Date, limit: number, skip: string[], skipOrgs: string[]): Promise<Claimed[]> {
  const nowTs = sql`${now.toISOString()}::timestamptz`;
  const result = await db.execute(sql`
    UPDATE sre_incidents i
    SET renotified_at = ${nowTs},
      renotify_count = CASE WHEN i.renotified_at IS NULL THEN 1 ELSE greatest(i.renotify_count, 1) + 1 END
    FROM (
      SELECT i2.id, i2.renotified_at AS prev_at, i2.renotify_count AS prev_count, i2.renotify_failures AS failures,
        CASE WHEN p.renotify_repeat_minutes IS NULL THEN 1 ELSE p.renotify_max END AS max
      FROM sre_incidents i2
      JOIN notification_policies p ON p.project_id = i2.project_id
      WHERE i2.status <> 'resolved' AND i2.acknowledged_at IS NULL AND i2.renotify_stopped_at IS NULL
        AND ${notInPendingOrganization(sql`i2.organization_id`)}
        AND p.renotify_unacked_minutes IS NOT NULL
        AND (i2.renotify_retry_at IS NULL OR i2.renotify_retry_at <= ${nowTs})
        AND coalesce(i2.reopened_at, i2.created_at) >= ${nowTs} - make_interval(secs => ${MAX_AGE_MS / 1000})
        AND (
          (i2.renotified_at IS NULL
            AND coalesce(i2.reopened_at, i2.created_at) <= ${nowTs} - make_interval(mins => p.renotify_unacked_minutes))
          OR (i2.renotified_at IS NOT NULL AND greatest(i2.renotify_count, 1) < p.renotify_max AND p.renotify_repeat_minutes IS NOT NULL
            AND i2.renotified_at <= ${nowTs} - make_interval(mins => p.renotify_repeat_minutes))
        )
        ${skipSql("i2.id", skip)}
        ${skipSql("i2.organization_id", skipOrgs)}
      ORDER BY coalesce(i2.reopened_at, i2.created_at)
      LIMIT ${limit}
      FOR UPDATE OF i2 SKIP LOCKED
    ) due
    WHERE i.id = due.id
    RETURNING i.id, i.organization_id, i.project_id, i.created_at, i.reopened_at, i.renotify_count, due.prev_at, due.prev_count, due.failures, due.max
  `);
  return (result as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    reopenedAt: toDate(row.reopened_at),
    openedAt: (toDate(row.reopened_at) ?? toDate(row.created_at)) as Date,
    count: Number(row.renotify_count),
    max: Number(row.max),
    prevCount: Number(row.prev_count),
    prevAt: toDate(row.prev_at),
    failures: Number(row.failures ?? 0),
  }));
}

/** Gives a reminder back (held, capped, or failed with a retry time). Guarded on the claim, so a reopen during the send
 * (which resets the count) is left alone. */
async function releaseReminder(incident: Claimed, claimedAt: Date, retry?: { failures: number; at: Date }) {
  await db
    .update(sreIncidents)
    .set({
      renotifyCount: incident.prevCount,
      renotifiedAt: incident.prevAt,
      ...(retry ? { renotifyFailures: retry.failures, renotifyRetryAt: retry.at } : {}),
    })
    .where(and(eq(sreIncidents.id, incident.id), eq(sreIncidents.renotifyCount, incident.count), eq(sreIncidents.renotifiedAt, claimedAt)));
}

type ClaimedEscalation = { id: string; organizationId: string; projectId: string; channelId: string | null; userId: string | null; failures: number };

/** Claims the one escalation step of incidents unacknowledged E minutes after opening; same shape as the reminder claim. */
async function claimEscalations(now: Date, limit: number, skip: string[], skipOrgs: string[]): Promise<ClaimedEscalation[]> {
  const nowTs = sql`${now.toISOString()}::timestamptz`;
  const result = await db.execute(sql`
    UPDATE sre_incidents i
    SET escalated_at = ${nowTs}
    FROM (
      SELECT i2.id, p.escalate_channel_id, p.escalate_user_id, i2.escalate_failures AS failures
      FROM sre_incidents i2
      JOIN notification_policies p ON p.project_id = i2.project_id
      WHERE i2.status <> 'resolved' AND i2.acknowledged_at IS NULL AND i2.renotify_stopped_at IS NULL
        AND i2.escalated_at IS NULL
        AND ${notInPendingOrganization(sql`i2.organization_id`)}
        AND p.escalate_after_minutes IS NOT NULL
        AND (i2.escalate_retry_at IS NULL OR i2.escalate_retry_at <= ${nowTs})
        AND coalesce(i2.reopened_at, i2.created_at) >= ${nowTs} - make_interval(secs => ${MAX_AGE_MS / 1000})
        AND coalesce(i2.reopened_at, i2.created_at) <= ${nowTs} - make_interval(mins => p.escalate_after_minutes)
        ${skipSql("i2.id", skip)}
        ${skipSql("i2.organization_id", skipOrgs)}
      ORDER BY coalesce(i2.reopened_at, i2.created_at)
      LIMIT ${limit}
      FOR UPDATE OF i2 SKIP LOCKED
    ) due
    WHERE i.id = due.id
    RETURNING i.id, i.organization_id, i.project_id, due.escalate_channel_id, due.escalate_user_id, due.failures
  `);
  return (result as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    channelId: row.escalate_channel_id ? String(row.escalate_channel_id) : null,
    userId: row.escalate_user_id ? String(row.escalate_user_id) : null,
    failures: Number(row.failures ?? 0),
  }));
}

async function releaseEscalation(id: string, claimedAt: Date, retry?: { failures: number; at: Date }) {
  await db
    .update(sreIncidents)
    .set({ escalatedAt: null, ...(retry ? { escalateFailures: retry.failures, escalateRetryAt: retry.at } : {}) })
    .where(and(eq(sreIncidents.id, id), eq(sreIncidents.escalatedAt, claimedAt)));
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

async function noteOnTimeline(incidentId: string, eventData: Record<string, unknown>) {
  await db
    .insert(sreIncidentTimelineEvents)
    .values({ incidentId, eventType: "notification", actorType: "system", eventData })
    .catch((error: unknown) => queueLogger.error({ err: error, incidentId }, "Incident notification timeline write failed"));
}

async function clearFailures(id: string, kind: SendKind) {
  await db
    .update(sreIncidents)
    .set(kind === "reminder" ? { renotifyFailures: 0, renotifyRetryAt: null } : { escalateFailures: 0, escalateRetryAt: null })
    .where(eq(sreIncidents.id, id));
}

/**
 * Sends the one escalation step and due reminders (first after N minutes, then every M minutes, at most K) to incidents
 * still unacknowledged. Escalations go first and have their own budget and org cap. Each send is claimed before it goes
 * out; a held (maintenance) or rate-limited send gives the claim back without using anything up. A failed send is
 * retried with backoff and given up after MAX_SEND_FAILURES (noted on the timeline). Only real send attempts count
 * toward the per-tick budget, and an org over its hourly cap is skipped for the rest of the tick, so one busy or held
 * org cannot starve the others. Returns the number of send attempts; `stats.failed` counts those that failed everywhere.
 */
export async function renotifyUnacknowledgedIncidents(now = new Date(), stats?: { failed: number }) {
  const held = recentlyHeld(now);
  const cappedOrgs: Record<SendKind, string[]> = { reminder: [], escalation: [] };
  /** Held or capped: the claim goes back unused. Returns true when the send must not happen now. */
  const holdBack = async (incident: { id: string; organizationId: string }, kind: SendKind) => {
    if (await incidentHeldForMaintenance(incident.id, now).catch(() => false)) {
      rememberHeld(incident.id, now);
      return true;
    }
    if (cappedOrgs[kind].includes(incident.organizationId)) return true;
    if (await allowOrgIncidentSend(incident.organizationId, now, kind)) return false;
    cappedOrgs[kind].push(incident.organizationId);
    return true;
  };

  // Escalations first: the one step that brings in someone new must never wait behind reminders.
  let escalationSends = 0;
  let claims = 0;
  const releasedEscalations: string[] = [...held];
  while (escalationSends < MAX_PER_TICK && claims < MAX_CLAIMS_PER_TICK) {
    const claimed = await claimEscalations(now, Math.min(CLAIM_BATCH, MAX_PER_TICK - escalationSends), releasedEscalations, cappedOrgs.escalation);
    if (!claimed.length) break;
    claims += claimed.length;
    for (const incident of claimed) {
      if (await holdBack(incident, "escalation")) {
        releasedEscalations.push(incident.id);
        await releaseEscalation(incident.id, now);
        continue;
      }
      let usable: boolean;
      try {
        usable = await escalationTargetUsable(incident);
      } catch (error) {
        queueLogger.error({ err: error, incidentId: incident.id }, "Incident escalation target lookup failed");
        releasedEscalations.push(incident.id);
        await releaseEscalation(incident.id, now);
        continue;
      }
      if (!usable) {
        // Terminal: the target was removed. Keep escalated_at so it neither loops nor passes silently.
        await noteOnTimeline(incident.id, { kind: "escalation", reached: 0, channels: [], emailed: 0 });
        continue;
      }
      escalationSends++;
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
      if (delivered !== false) {
        await recordOrgIncidentSend(incident.organizationId, now, "escalation");
        if (incident.failures > 0) await clearFailures(incident.id, "escalation");
        continue;
      }
      if (stats) stats.failed++;
      const failures = incident.failures + 1;
      if (failures >= MAX_SEND_FAILURES) {
        // Given up: escalated_at stays set, and the timeline says it never got through.
        await clearFailures(incident.id, "escalation");
        await noteOnTimeline(incident.id, { kind: "escalation", reached: 0, failed: true, attempts: failures, channels: [], emailed: 0 });
      } else {
        releasedEscalations.push(incident.id);
        await releaseEscalation(incident.id, now, { failures, at: new Date(now.getTime() + retryDelayMs(failures)) });
      }
    }
  }

  let reminderSends = 0;
  claims = 0;
  const released: string[] = [...held];
  while (reminderSends < MAX_PER_TICK && claims < MAX_CLAIMS_PER_TICK) {
    const claimed = await claimReminders(now, Math.min(CLAIM_BATCH, MAX_PER_TICK - reminderSends), released, cappedOrgs.reminder);
    if (!claimed.length) break;
    claims += claimed.length;
    // RETURNING has no order guarantee; send oldest first.
    claimed.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());

    for (const incident of claimed) {
      // Maintenance windows extend incidentHeldForMaintenance: a held send gives its claim back, so paging resumes after.
      if (await holdBack(incident, "reminder")) {
        released.push(incident.id);
        await releaseReminder(incident, now);
        continue;
      }
      reminderSends++;
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
      if (delivered !== false) {
        await recordOrgIncidentSend(incident.organizationId, now, "reminder");
        if (incident.failures > 0) await clearFailures(incident.id, "reminder");
        continue;
      }
      if (stats) stats.failed++;
      const failures = incident.failures + 1;
      if (failures >= MAX_SEND_FAILURES) {
        // Given up: this reminder stays used (the next one follows the schedule), and the timeline says so.
        await clearFailures(incident.id, "reminder");
        await noteOnTimeline(incident.id, { kind: "reminder", n: incident.count, of: incident.max, reached: 0, failed: true, attempts: failures, channels: [], emailed: 0 });
      } else {
        released.push(incident.id);
        await releaseReminder(incident, now, { failures, at: new Date(now.getTime() + retryDelayMs(failures)) });
      }
    }
  }
  return reminderSends + escalationSends;
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
