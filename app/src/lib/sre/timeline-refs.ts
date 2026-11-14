import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { SreIncidentTimelineRefs } from "@/actions/sre-incident-lifecycle";
import { member, sreAlertEvents, user } from "@/db/schema";
import { db } from "@/utils/db";

const uuid = z.string().uuid();
const USER_KEYS = ["previousAssigneeUserId", "assigneeUserId", "createdByUserId"] as const;

/**
 * Names for the ids timeline rows store: org members' names and alert titles in this org and project.
 * Shared by the Activity feed and the post-mortem draft so both read the same way and never cross a tenant.
 */
export async function loadTimelineRefs(
  executor: Pick<typeof db, "select">,
  { organizationId, projectId, rows }: { organizationId: string; projectId: string; rows: Array<{ eventData: Record<string, unknown> | null }> },
): Promise<SreIncidentTimelineRefs> {
  const userIds = new Set<string>();
  const alertIds = new Set<string>();
  for (const { eventData: data } of rows) {
    for (const key of USER_KEYS) {
      const value = data?.[key];
      if (typeof value === "string" && uuid.safeParse(value).success) userIds.add(value);
    }
    const alertId = data?.alertEventId;
    if (typeof alertId === "string" && uuid.safeParse(alertId).success) alertIds.add(alertId);
  }
  const [users, alerts] = await Promise.all([
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
  ]);
  return {
    users: Object.fromEntries(users.map((row) => [row.id, row.name])),
    alerts: Object.fromEntries(alerts.map((row) => [row.id, row.title])),
  };
}
