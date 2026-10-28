import {
  and,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/utils/db";
import {
  incidents,
  incidentUpdates,
  statusPages,
  statusPageSubscribers,
  statusPageNotificationEvents as events,
  statusPageNotificationDeliveries as deliveries,
} from "@/db/schema";
import { resolveSubscribers } from "./resolve-subscribers";
import { sendIncidentNotifications } from "./send-incident-notifications";
import { sendWebhookNotifications } from "./send-webhook-notifications";
import { sendSlackNotifications } from "./send-slack-notifications";
import type { Queue } from "bullmq";

const EVENT_BATCH_SIZE = 25;
const MAX_EVENTS_PER_TICK = 500;
export const DELIVERY_BATCH_SIZE = 100;
export const MAX_DELIVERIES_PER_TICK = 1000;
export const DEFAULT_DELIVERY_RETENTION_DAYS = 30;
const MAX_DELIVERY_RETENTION_DAYS = 3650;
const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
// While a row is queued its job holds the row; do not enqueue it again until
// this lease lapses. The BullMQ job id is the delivery id, so a re-add after a
// lost worker is idempotent.
const ENQUEUE_LEASE_MS = 5 * 60 * 1000;
const TERMINAL_DELIVERY_STATUSES = ["delivered", "failed", "skipped"] as const;
let lastRetentionRunAt = 0;

/**
 * Retention is opt-out by setting a positive integer day count. Invalid values
 * fall back to the default instead of deleting more (or less) than intended.
 */
export function resolveDeliveryRetentionDays(
  raw: string | undefined = process.env.STATUS_PAGE_DELIVERY_RETENTION_DAYS,
): number {
  if (raw === undefined || raw.trim() === "")
    return DEFAULT_DELIVERY_RETENTION_DAYS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_DELIVERY_RETENTION_DAYS
    ? parsed
    : DEFAULT_DELIVERY_RETENTION_DAYS;
}

export async function enqueuePendingDeliveries(queue: Queue) {
  // Expand every pending event before queueing deliveries. The per-tick cap
  // keeps a large backlog from monopolising the scheduler tick.
  let expanded = 0;
  while (expanded < MAX_EVENTS_PER_TICK) {
    const batch = await expandPendingEvents(
      Math.min(EVENT_BATCH_SIZE, MAX_EVENTS_PER_TICK - expanded),
    );
    if (batch === 0) break;
    expanded += batch;
  }
  await db
    .update(deliveries)
    .set({
      status: "failed",
      lastError: "Delivery attempt interrupted; retry limit reached.",
      leasedUntil: null,
      enqueuedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deliveries.status, "pending"),
        sql`${deliveries.attempts} >= 4`,
        or(
          isNull(deliveries.leasedUntil),
          lte(deliveries.leasedUntil, new Date()),
        ),
      ),
    );

  // Deliveries queue asynchronously, so a single selection would keep returning
  // the same first 100 rows. Track what this tick already queued and keep
  // draining in bounded batches.
  const queuedIds: string[] = [];
  let queued = 0;
  while (queued < MAX_DELIVERIES_PER_TICK) {
    const pending = await findPendableDeliveries(
      Math.min(DELIVERY_BATCH_SIZE, MAX_DELIVERIES_PER_TICK - queued),
      queuedIds,
    );
    if (pending.length === 0) break;
    for (const delivery of pending) {
      const previous = await queue.getJob(delivery.id);
      if (previous) {
        const state = await previous.getState();
        if (state === "completed" || state === "failed")
          await previous.remove();
      }
      await queue.add("deliver", { deliveryId: delivery.id }, { jobId: delivery.id, attempts: 4, backoff: { type: "exponential", delay: 10000 }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } });
      queuedIds.push(delivery.id);
    }
    queued += pending.length;
  }
  if (queuedIds.length) {
    await db
      .update(deliveries)
      .set({ enqueuedAt: new Date() })
      .where(inArray(deliveries.id, queuedIds));
  }
  // Completed unsubscribe grace periods have no remaining delivery entitlement.
  await db
    .delete(statusPageSubscribers)
    .where(lt(statusPageSubscribers.purgeAt, new Date()));
  // The scheduler ticks every 10 seconds; retention only needs an hourly pass.
  if (Date.now() - lastRetentionRunAt >= RETENTION_INTERVAL_MS) {
    lastRetentionRunAt = Date.now();
    await deleteExpiredDeliveries(resolveDeliveryRetentionDays());
  }
}

async function expandPendingEvents(limit: number): Promise<number> {
  let expanded = 0;
  await db.transaction(async (tx) => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(73194723) as acquired`);
    if (!lock[0]?.acquired) return;
    const pending = await tx
      .select()
      .from(events)
      .where(isNull(events.expandedAt))
      .orderBy(events.createdAt)
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const event of pending) {
      const incident = await tx.query.incidents.findFirst({
        where: eq(incidents.id, event.incidentId),
      });
      if (incident) {
        const page = await tx.query.statusPages.findFirst({
          where: eq(statusPages.id, incident.statusPageId),
        });
        if (page?.status === "published") {
          for (const mode of ["email", "webhook", "slack"] as const) {
            if (
              !(mode === "email"
                ? page.allowEmailSubscribers
                : mode === "webhook"
                  ? page.allowWebhookSubscribers
                  : page.allowSlackSubscribers)
            )
              continue;
            const recipients = await resolveSubscribers(
              page.id,
              incident.id,
              mode,
            );
            for (let offset = 0; offset < recipients.length; offset += 500)
              await tx
                .insert(deliveries)
                .values(
                  recipients.slice(offset, offset + 500).map((recipient) => ({
                    eventId: event.id,
                    subscriberId: recipient.id,
                    mode,
                  })),
                )
                .onConflictDoNothing();
          }
        }
      }
      // Orphaned events are marked too, otherwise a deleted incident would
      // block every later event in the batch forever.
      await tx
        .update(events)
        .set({ expandedAt: new Date() })
        .where(eq(events.id, event.id));
      expanded++;
    }
  });
  return expanded;
}

async function findPendableDeliveries(limit: number, excludeIds: string[]) {
  return db
    .select({ id: deliveries.id })
    .from(deliveries)
    .innerJoin(events, eq(events.id, deliveries.eventId))
    .where(
      and(
        eq(deliveries.status, "pending"),
        lt(deliveries.attempts, 4),
        or(
          isNull(deliveries.leasedUntil),
          lte(deliveries.leasedUntil, new Date()),
        ),
        or(
          isNull(deliveries.enqueuedAt),
          lt(
            deliveries.enqueuedAt,
            new Date(Date.now() - ENQUEUE_LEASE_MS),
          ),
        ),
        excludeIds.length
          ? notInArray(deliveries.id, excludeIds)
          : undefined,
        sql`not exists (
    select 1 from status_page_notification_deliveries earlier_delivery
    join status_page_notification_events earlier_event on earlier_event.id = earlier_delivery.event_id
    where earlier_delivery.subscriber_id = ${deliveries.subscriberId}
      and earlier_event.incident_id = ${events.incidentId}
      and earlier_delivery.status = 'pending'
      and (earlier_event.created_at, earlier_event.id) < (${events.createdAt}, ${events.id})
  ) and not exists (
    select 1 from status_page_notification_events earlier_event
    where earlier_event.incident_id = ${events.incidentId}
      and earlier_event.expanded_at is null
      and (earlier_event.created_at, earlier_event.id) < (${events.createdAt}, ${events.id})
  )`,
      ),
    )
    .limit(limit);
}

export async function deleteExpiredDeliveries(
  retentionDays = resolveDeliveryRetentionDays(),
  now = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - retentionDays * 86400000);
  await db
    .delete(deliveries)
    .where(
      and(
        inArray(deliveries.status, [...TERMINAL_DELIVERY_STATUSES]),
        or(isNull(deliveries.updatedAt), lt(deliveries.updatedAt, cutoff)),
      ),
    );
}

/**
 * A settle write only applies while this worker still holds the lease it
 * took: re-leasing increments attempts, so a slow send that outlives its lease
 * cannot overwrite the state written by the worker that took over.
 */
function heldLease(delivery: { id: string; attempts: number }) {
  return and(
    eq(deliveries.id, delivery.id),
    // On the final attempt the lease-expiry sweep may already have marked the
    // row failed while this send was still running; the real outcome wins.
    delivery.attempts >= 4
      ? inArray(deliveries.status, ["pending", "failed"])
      : eq(deliveries.status, "pending"),
    eq(deliveries.attempts, delivery.attempts),
  );
}

export async function processDelivery(deliveryId: string) {
  const [delivery] = await db
    .update(deliveries)
    .set({
      attempts: sql`${deliveries.attempts} + 1`,
      leasedUntil: new Date(Date.now() + 120000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deliveries.id, deliveryId),
        eq(deliveries.status, "pending"),
        lt(deliveries.attempts, 4),
        or(
          isNull(deliveries.leasedUntil),
          lte(deliveries.leasedUntil, new Date()),
        ),
      ),
    )
    .returning();
  if (!delivery) return;
  try {
    const event = await db.query.statusPageNotificationEvents.findFirst({
      where: eq(events.id, delivery.eventId),
    });
    const incident = event
      ? await db.query.incidents.findFirst({
          where: eq(incidents.id, event.incidentId),
        })
      : undefined;
    const update = event
      ? await db.query.incidentUpdates.findFirst({
          where: eq(incidentUpdates.id, event.updateId),
        })
      : undefined;
    if (!event || !incident || !update) {
      // The source rows were removed after enqueue; retrying cannot succeed,
      // so settle the delivery instead of leaving it pending until the
      // lease-expiry sweep marks it failed as "interrupted".
      await db
        .update(deliveries)
        .set({
          status: "skipped",
          lastError: "Notification source no longer exists.",
          leasedUntil: null,
          enqueuedAt: null,
          updatedAt: new Date(),
        })
        .where(heldLease(delivery));
      return;
    }

    const result =
      delivery.mode === "email"
        ? await sendIncidentNotifications(
            incident.id,
            incident.statusPageId,
            update,
            delivery.subscriberId,
          )
        : delivery.mode === "webhook"
          ? await sendWebhookNotifications(
              incident.id,
              incident.statusPageId,
              update,
              delivery.subscriberId,
              event.isCreation,
              delivery.attempts >= 4,
            )
          : await sendSlackNotifications(
              incident.id,
              incident.statusPageId,
              update,
              delivery.subscriberId,
              event.isCreation,
              delivery.attempts >= 4,
            );
    if (!result.success) throw new Error(result.message);
    await db
      .update(deliveries)
      .set({
        status: result.sentCount === 0 ? "skipped" : "delivered",
        lastError: null,
        leasedUntil: null,
        enqueuedAt: null,
        updatedAt: new Date(),
      })
      .where(heldLease(delivery));
  } catch (error) {
    await db
      .update(deliveries)
      .set({
        status: delivery.attempts >= 4 ? "failed" : "pending",
        leasedUntil: null,
        enqueuedAt: null,
        lastError:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Delivery failed",
        updatedAt: new Date(),
      })
      .where(heldLease(delivery));
    throw error;
  }
}
