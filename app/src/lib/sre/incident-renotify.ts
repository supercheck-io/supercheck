import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import { Queue, Worker } from "bullmq";

import { notificationPolicies, sreIncidents } from "@/db/schema";
import { getRedisConnection, queueLogger } from "@/lib/queue";
import { notifyIncidentEvent } from "@/lib/sre/incident-notifier";
import { db } from "@/utils/db";

const QUEUE_NAME = "sre-incident-renotify";
const TICK_MS = 60_000;
// A policy switched on late must not wake incidents from long ago.
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

// Claim small batches so a restart mid-tick loses at most one batch; the cap keeps a late-enabled
// policy on a busy project from bursting (the rest follows on later ticks).
const CLAIM_BATCH = 10;

// Since when the incident has been waiting: creation, or its last reopen so a late reopen is still reminded.
const openedAt = sql<Date>`coalesce(${sreIncidents.reopenedAt}, ${sreIncidents.createdAt})`;
const MAX_PER_TICK = 50;

/**
 * Re-sends once to incidents that stayed unacknowledged past their project's policy time. Each batch
 * is claimed (renotified_at, FOR UPDATE SKIP LOCKED) before sending, so ticks and replicas never
 * repeat it; a failed or thrown send gives the claim back for the next tick.
 */
export async function renotifyUnacknowledgedIncidents(now = new Date()) {
  let total = 0;
  const released: string[] = [];
  while (total < MAX_PER_TICK) {
    const due = db
      .select({ id: sreIncidents.id })
      .from(sreIncidents)
      .innerJoin(notificationPolicies, eq(notificationPolicies.projectId, sreIncidents.projectId))
      .where(
        and(
          isNotNull(notificationPolicies.renotifyUnackedMinutes),
          ne(sreIncidents.status, "resolved"),
          isNull(sreIncidents.acknowledgedAt),
          isNull(sreIncidents.renotifiedAt),
          released.length ? notInArray(sreIncidents.id, released) : undefined,
          gte(openedAt, sql`${new Date(now.getTime() - MAX_AGE_MS).toISOString()}::timestamptz`),
          lte(openedAt, sql`${now.toISOString()}::timestamptz - make_interval(mins => ${notificationPolicies.renotifyUnackedMinutes})`),
        ),
      )
      .orderBy(openedAt)
      .limit(Math.min(CLAIM_BATCH, MAX_PER_TICK - total))
      .for("update", { of: sreIncidents, skipLocked: true });
    const claimed = await db
      .update(sreIncidents)
      .set({ renotifiedAt: now })
      .where(inArray(sreIncidents.id, due))
      .returning({ id: sreIncidents.id, organizationId: sreIncidents.organizationId, projectId: sreIncidents.projectId, createdAt: sreIncidents.createdAt, reopenedAt: sreIncidents.reopenedAt });
    if (!claimed.length) break;
    total += claimed.length;
    // RETURNING has no order guarantee; send oldest first.
    const waitingSince = (i: (typeof claimed)[number]) => (i.reopenedAt ?? i.createdAt).getTime();
    claimed.sort((a, b) => waitingSince(a) - waitingSince(b));

    for (const incident of claimed) {
      let delivered = false;
      try {
        delivered = await notifyIncidentEvent({
          organizationId: incident.organizationId,
          projectId: incident.projectId,
          incidentId: incident.id,
          event: "unacknowledged",
          // Per reopen cycle, so a reminder after a quick reopen is not swallowed by the previous one's dedupe key.
          dedupeDiscriminator: `renotify:${incident.reopenedAt?.getTime() ?? 0}`,
        });
      } catch (error) {
        queueLogger.error({ err: error, incidentId: incident.id }, "Incident re-notify send failed");
      }
      // Every send failed (or threw): give the reminder back so the next tick tries again.
      if (delivered === false) {
        released.push(incident.id);
        await db.update(sreIncidents).set({ renotifiedAt: null }).where(eq(sreIncidents.id, incident.id));
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
  worker = new Worker(
    QUEUE_NAME,
    async () => {
      await renotifyUnacknowledgedIncidents();
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
