import { and, eq, gte, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { Queue, Worker } from "bullmq";

import { notificationPolicies, sreIncidents } from "@/db/schema";
import { getRedisConnection, queueLogger } from "@/lib/queue";
import { notifyIncidentEvent } from "@/lib/sre/incident-notifier";
import { db } from "@/utils/db";

const QUEUE_NAME = "sre-incident-renotify";
const TICK_MS = 60_000;
// A policy switched on late must not wake incidents from long ago.
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Re-sends once to incidents that stayed unacknowledged past their project's policy time. The
 * UPDATE claims each incident (renotified_at) before sending, so ticks and replicas never repeat it.
 */
export async function renotifyUnacknowledgedIncidents(now = new Date()) {
  const claimed = await db
    .update(sreIncidents)
    .set({ renotifiedAt: now })
    .from(notificationPolicies)
    .where(
      and(
        eq(notificationPolicies.projectId, sreIncidents.projectId),
        isNotNull(notificationPolicies.renotifyUnackedMinutes),
        ne(sreIncidents.status, "resolved"),
        isNull(sreIncidents.acknowledgedAt),
        isNull(sreIncidents.renotifiedAt),
        gte(sreIncidents.createdAt, new Date(now.getTime() - MAX_AGE_MS)),
        lte(sreIncidents.createdAt, sql`${now.toISOString()}::timestamptz - make_interval(mins => ${notificationPolicies.renotifyUnackedMinutes})`),
      ),
    )
    .returning({ id: sreIncidents.id, organizationId: sreIncidents.organizationId, projectId: sreIncidents.projectId });

  for (const incident of claimed) {
    const delivered = await notifyIncidentEvent({
      organizationId: incident.organizationId,
      projectId: incident.projectId,
      incidentId: incident.id,
      event: "unacknowledged",
      dedupeDiscriminator: "renotify",
    });
    // Every send failed: give the reminder back so the next tick tries again.
    if (delivered === false) {
      await db.update(sreIncidents).set({ renotifiedAt: null }).where(eq(sreIncidents.id, incident.id));
    }
  }
  return claimed.length;
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
