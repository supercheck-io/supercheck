import { and, eq, inArray } from "drizzle-orm";

import { notificationPolicies, notificationProviders } from "@/db/schema";
import { db } from "@/utils/db";

export type NotificationPolicy = {
  channelIds: string[];
  emailServiceOwnersOnSev12: boolean;
  /** Minutes before one re-notify of an unacknowledged incident; null is off. */
  renotifyUnackedMinutes: number | null;
  autoInvestigateOnOpen: boolean;
};

/** A project with no saved policy behaves like this: nothing extra is sent or spent. */
export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = {
  channelIds: [],
  emailServiceOwnersOnSev12: false,
  renotifyUnackedMinutes: null,
  autoInvestigateOnOpen: false,
};

export async function getNotificationPolicy(projectId: string): Promise<NotificationPolicy> {
  const [row] = await db
    .select({
      channelIds: notificationPolicies.channelIds,
      emailServiceOwnersOnSev12: notificationPolicies.emailServiceOwnersOnSev12,
      renotifyUnackedMinutes: notificationPolicies.renotifyUnackedMinutes,
      autoInvestigateOnOpen: notificationPolicies.autoInvestigateOnOpen,
    })
    .from(notificationPolicies)
    .where(eq(notificationPolicies.projectId, projectId))
    .limit(1);
  return row ?? DEFAULT_NOTIFICATION_POLICY;
}

/** Enabled providers of this project that the policy names; ids of other projects or deleted channels drop out. */
export async function listPolicyProviders(organizationId: string, projectId: string, channelIds: string[]) {
  if (channelIds.length === 0) return [];
  return db
    .select({
      id: notificationProviders.id,
      type: notificationProviders.type,
      config: notificationProviders.config,
      projectId: notificationProviders.projectId,
    })
    .from(notificationProviders)
    .where(
      and(
        inArray(notificationProviders.id, channelIds),
        eq(notificationProviders.isEnabled, true),
        eq(notificationProviders.organizationId, organizationId),
        eq(notificationProviders.projectId, projectId),
      ),
    )
    .limit(10);
}
