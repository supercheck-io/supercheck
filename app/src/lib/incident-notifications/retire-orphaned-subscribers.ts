import { and, isNull, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import {
  statusPageComponentSubscriptions as componentSubs,
  statusPageIncidentSubscriptions as incidentSubs,
  statusPageSubscribers as subscribers,
} from "@/db/schema";

/**
 * "No scope rows" means "subscribe to everything", and the FK cascade on delete
 * removes a scoped subscriber's last row. Call this BEFORE deleting a component
 * or incident: subscribers whose only scope row it is get the same 30-day
 * unsubscribe grace as an explicit unsubscribe, so they match nothing instead of
 * silently widening to all events.
 * shortcut: no explicit scope flag on the subscriber; replace with one when a migration is acceptable.
 */
export async function retireOrphanedSubscribers(
  target: { componentId: string } | { incidentId: string },
) {
  const isComponent = "componentId" in target;
  const [mine, others, otherKind] = isComponent
    ? [
        sql`select ${componentSubs.subscriberId} from ${componentSubs} where ${componentSubs.componentId} = ${target.componentId}`,
        sql`select 1 from ${componentSubs} where ${componentSubs.subscriberId} = ${subscribers.id} and ${componentSubs.componentId} <> ${target.componentId}`,
        sql`select 1 from ${incidentSubs} where ${incidentSubs.subscriberId} = ${subscribers.id}`,
      ]
    : [
        sql`select ${incidentSubs.subscriberId} from ${incidentSubs} where ${incidentSubs.incidentId} = ${target.incidentId}`,
        sql`select 1 from ${incidentSubs} where ${incidentSubs.subscriberId} = ${subscribers.id} and ${incidentSubs.incidentId} <> ${target.incidentId}`,
        sql`select 1 from ${componentSubs} where ${componentSubs.subscriberId} = ${subscribers.id}`,
      ];

  await db
    .update(subscribers)
    .set({ purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), updatedAt: new Date() })
    .where(
      and(
        isNull(subscribers.purgeAt),
        sql`${subscribers.id} in (${mine})`,
        sql`not exists (${others})`,
        sql`not exists (${otherKind})`,
      ),
    );
}
