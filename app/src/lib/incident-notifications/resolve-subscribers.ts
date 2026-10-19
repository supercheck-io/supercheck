import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/utils/db";
import {
  statusPageSubscribers,
  statusPageComponentSubscriptions,
  statusPageIncidentSubscriptions,
  incidentComponents,
} from "@/db/schema";
import { matchesSubscriptionScope } from "./subscription-scope";

export async function resolveSubscribers(
  statusPageId: string,
  incidentId: string,
  mode: "email" | "webhook" | "slack",
  subscriberId?: string,
) {
  const subscribers = await db.query.statusPageSubscribers.findMany({
    where: and(
      eq(statusPageSubscribers.statusPageId, statusPageId),
      eq(statusPageSubscribers.mode, mode),
      subscriberId ? eq(statusPageSubscribers.id, subscriberId) : undefined,
      isNotNull(statusPageSubscribers.verifiedAt),
      isNull(statusPageSubscribers.purgeAt),
      isNull(statusPageSubscribers.quarantinedAt),
    ),
  });
  if (subscribers.length === 0) return [];
  const ids = subscribers.map((s) => s.id);
  const [components, incidents, affected] = await Promise.all([
    db
      .select()
      .from(statusPageComponentSubscriptions)
      .where(inArray(statusPageComponentSubscriptions.subscriberId, ids)),
    db
      .select()
      .from(statusPageIncidentSubscriptions)
      .where(inArray(statusPageIncidentSubscriptions.subscriberId, ids)),
    db
      .select()
      .from(incidentComponents)
      .where(eq(incidentComponents.incidentId, incidentId)),
  ]);
  const affectedIds = new Set(affected.map((c) => c.componentId));
  const componentGroups = new Map<string, typeof components>();
  for (const component of components) { const group = componentGroups.get(component.subscriberId) ?? []; group.push(component); componentGroups.set(component.subscriberId, group); }
  const incidentGroups = new Map<string, typeof incidents>();
  for (const incident of incidents) { const group = incidentGroups.get(incident.subscriberId) ?? []; group.push(incident); incidentGroups.set(incident.subscriberId, group); }
  return subscribers.filter((s) =>
    matchesSubscriptionScope(
      s.id,
      incidentId,
      affectedIds,
      componentGroups.get(s.id) ?? [],
      incidentGroups.get(s.id) ?? [],
    ),
  );
}
