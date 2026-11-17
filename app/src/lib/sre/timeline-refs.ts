import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { SreIncidentTimelineRefs } from "@/actions/sre-incident-lifecycle";
import { member, notificationProviders, sreAlertEvents, user } from "@/db/schema";
import { db } from "@/utils/db";

const uuid = z.string().uuid();
const USER_KEYS = ["previousAssigneeUserId", "assigneeUserId", "createdByUserId"] as const;

/**
 * Names for the ids timeline rows store: org members' names, and alert titles and channel names in this org and project.
 * Shared by the Activity feed and the post-mortem draft so both read the same way and never cross a tenant.
 */
export async function loadTimelineRefs(
  executor: Pick<typeof db, "select">,
  { organizationId, projectId, rows }: { organizationId: string; projectId: string; rows: Array<{ eventData: Record<string, unknown> | null }> },
): Promise<SreIncidentTimelineRefs> {
  const userIds = new Set<string>();
  const alertIds = new Set<string>();
  const providerIds = new Set<string>();
  for (const { eventData: data } of rows) {
    for (const key of USER_KEYS) {
      const value = data?.[key];
      if (typeof value === "string" && uuid.safeParse(value).success) userIds.add(value);
    }
    const alertId = data?.alertEventId;
    if (typeof alertId === "string" && uuid.safeParse(alertId).success) alertIds.add(alertId);
    for (const channel of Array.isArray(data?.channels) ? data.channels : []) {
      const providerId = (channel as { providerId?: unknown } | null)?.providerId;
      if (typeof providerId === "string" && uuid.safeParse(providerId).success) providerIds.add(providerId);
    }
  }
  const [users, alerts, providers] = await Promise.all([
    userIds.size
      ? executor
          .select({ id: user.id, name: user.name })
          .from(user)
          .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, organizationId)))
          .where(inArray(user.id, [...userIds]))
      : [],
    alertIds.size
      ? executor
          .select({ id: sreAlertEvents.id, title: sreAlertEvents.title })
          .from(sreAlertEvents)
          .where(and(inArray(sreAlertEvents.id, [...alertIds]), eq(sreAlertEvents.organizationId, organizationId), eq(sreAlertEvents.projectId, projectId)))
      : [],
    providerIds.size
      ? executor
          .select({ id: notificationProviders.id, name: notificationProviders.name })
          .from(notificationProviders)
          .where(
            and(
              inArray(notificationProviders.id, [...providerIds]),
              eq(notificationProviders.organizationId, organizationId),
              eq(notificationProviders.projectId, projectId),
            ),
          )
      : [],
  ]);
  return {
    users: Object.fromEntries(users.map((row) => [row.id, row.name])),
    alerts: Object.fromEntries(alerts.map((row) => [row.id, row.title])),
    providers: Object.fromEntries(providers.map((row) => [row.id, row.name])),
  };
}
