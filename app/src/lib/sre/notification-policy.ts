import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { notificationPolicies, notificationProviders, type PlainNotificationProviderConfig } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { decryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
import { db } from "@/utils/db";

export type NotificationPolicy = {
  channelIds: string[];
  emailServiceOwnersOnSev12: boolean;
  /** Minutes before the first reminder of an unacknowledged incident; null is off. */
  renotifyUnackedMinutes: number | null;
  /** Minutes between later reminders; null reminds once. */
  renotifyRepeatMinutes: number | null;
  /** Total reminders per open period, counting the first. */
  renotifyMax: number;
  /** Minutes unacknowledged before the one escalation step; null is off. */
  escalateAfterMinutes: number | null;
  escalateChannelId: string | null;
  escalateUserId: string | null;
  autoInvestigateOnOpen: boolean;
  /** When auto-investigate was last switched on; null while it is off. */
  autoInvestigateEnabledAt: Date | null;
};

/** A project with no saved policy behaves like this: nothing extra is sent or spent. */
export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = {
  channelIds: [],
  emailServiceOwnersOnSev12: false,
  renotifyUnackedMinutes: null,
  renotifyRepeatMinutes: null,
  renotifyMax: 3,
  escalateAfterMinutes: null,
  escalateChannelId: null,
  escalateUserId: null,
  autoInvestigateOnOpen: false,
  autoInvestigateEnabledAt: null,
};

/** The reminder tick never wakes incidents older than this, so a schedule must finish inside it. */
export const MAX_REMINDER_SCHEDULE_MINUTES = 2 * 24 * 60;

const minutes = z.number().int().min(5).max(1440).nullable();

export const notificationPolicyInputSchema = z
  .object({
    channelIds: z.array(z.string().uuid()).max(10),
    emailServiceOwnersOnSev12: z.boolean(),
    renotifyUnackedMinutes: minutes,
    // Optional so clients that predate repeat and escalation keep saving (defaults below).
    renotifyRepeatMinutes: minutes.optional().default(null),
    renotifyMax: z.number().int().min(1).max(10).optional().default(3),
    escalateAfterMinutes: minutes.optional().default(null),
    escalateChannelId: z.string().uuid().nullable().optional().default(null),
    escalateUserId: z.string().uuid().nullable().optional().default(null),
    autoInvestigateOnOpen: z.boolean(),
  })
  .strict();

export type NotificationPolicyInput = z.input<typeof notificationPolicyInputSchema>;

const POLICY_COLUMNS = {
  channelIds: notificationPolicies.channelIds,
  emailServiceOwnersOnSev12: notificationPolicies.emailServiceOwnersOnSev12,
  renotifyUnackedMinutes: notificationPolicies.renotifyUnackedMinutes,
  renotifyRepeatMinutes: notificationPolicies.renotifyRepeatMinutes,
  renotifyMax: notificationPolicies.renotifyMax,
  escalateAfterMinutes: notificationPolicies.escalateAfterMinutes,
  escalateChannelId: notificationPolicies.escalateChannelId,
  escalateUserId: notificationPolicies.escalateUserId,
  autoInvestigateOnOpen: notificationPolicies.autoInvestigateOnOpen,
  autoInvestigateEnabledAt: notificationPolicies.autoInvestigateEnabledAt,
};

export async function getNotificationPolicy(projectId: string): Promise<NotificationPolicy> {
  const [row] = await db.select(POLICY_COLUMNS).from(notificationPolicies).where(eq(notificationPolicies.projectId, projectId)).limit(1);
  return row ?? DEFAULT_NOTIFICATION_POLICY;
}

/** Webhooks with a paging preset or a body template are shaped for one receiver; incident messages never go to them. */
export function isPagingWebhook(type: string, config: Record<string, unknown>) {
  if (type !== "webhook") return false;
  const preset = typeof config.preset === "string" ? config.preset.trim() : "";
  const template = typeof config.bodyTemplate === "string" ? config.bodyTemplate.trim() : "";
  return (preset !== "" && preset !== "custom") || template !== "";
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

type SaveResult = { success: true } | { success: false; error: string };

/**
 * Validates and saves a project's policy. The caller has already proved the project is in `organizationId` and
 * that the user holds project:update; this checks everything the input names against the same project.
 */
export async function saveNotificationPolicy(
  scope: { organizationId: string; projectId: string; userId?: string },
  input: unknown,
): Promise<SaveResult> {
  const parsed = notificationPolicyInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid notification policy" };
  const data = parsed.data;
  const { organizationId, projectId } = scope;

  if (data.renotifyRepeatMinutes !== null && data.renotifyUnackedMinutes === null) {
    return { success: false, error: "Set the first reminder before repeating it" };
  }
  if (
    data.renotifyUnackedMinutes !== null &&
    data.renotifyRepeatMinutes !== null &&
    data.renotifyUnackedMinutes + (data.renotifyMax - 1) * data.renotifyRepeatMinutes > MAX_REMINDER_SCHEDULE_MINUTES
  ) {
    return { success: false, error: "Reminders must finish within 2 days" };
  }
  if (data.escalateChannelId && data.escalateUserId) return { success: false, error: "Escalate to a channel or a member, not both" };
  if (data.escalateAfterMinutes !== null && !data.escalateChannelId && !data.escalateUserId) {
    return { success: false, error: "Choose who to escalate to" };
  }

  const channelIds = [...new Set(data.channelIds)];
  if (channelIds.length > 0) {
    // Only this project's own channels may be named.
    const owned = await db
      .select({ id: notificationProviders.id })
      .from(notificationProviders)
      .where(and(inArray(notificationProviders.id, channelIds), eq(notificationProviders.organizationId, organizationId), eq(notificationProviders.projectId, projectId)));
    if (owned.length !== channelIds.length) return { success: false, error: "Some channels do not belong to this project" };
  }
  if (data.escalateChannelId) {
    const [channel] = await db
      .select({ type: notificationProviders.type, config: notificationProviders.config, isEnabled: notificationProviders.isEnabled, projectId: notificationProviders.projectId })
      .from(notificationProviders)
      .where(and(eq(notificationProviders.id, data.escalateChannelId), eq(notificationProviders.organizationId, organizationId), eq(notificationProviders.projectId, projectId)))
      .limit(1);
    if (!channel || !channel.isEnabled) return { success: false, error: "The escalation channel is not an enabled channel of this project" };
    let config: PlainNotificationProviderConfig;
    try {
      config = decryptNotificationProviderConfig(channel.config, channel.projectId ?? undefined);
    } catch {
      return { success: false, error: "The escalation channel is not an enabled channel of this project" };
    }
    if (isPagingWebhook(channel.type, config as Record<string, unknown>)) {
      return { success: false, error: "A paging service cannot be the escalation target" };
    }
  }
  if (data.escalateUserId) {
    // Lazy import: incident-lifecycle imports the notifier, which imports this module.
    const { isAssignableUser } = await import("./incident-lifecycle");
    if (!(await isAssignableUser(organizationId, projectId, data.escalateUserId))) {
      return { success: false, error: "The escalation member is not a member of this project" };
    }
  }

  const values = { ...data, channelIds, updatedAt: new Date() };
  // A client that predates repeat and escalation (an open tab during a deploy) omits these: keep what is stored.
  const provided = input as Record<string, unknown>;
  const keep = (["renotifyRepeatMinutes", "renotifyMax", "escalateAfterMinutes", "escalateChannelId", "escalateUserId"] as const).filter(
    (key) => !(key in provided),
  );
  const updates: Partial<typeof values> = { ...values };
  for (const key of keep) delete updates[key];
  // Stamped when auto-investigate turns on (kept while it stays on, cleared when off), so unrelated saves
  // never move the cut-off that keeps older incidents from being auto-run.
  await db
    .insert(notificationPolicies)
    .values({ organizationId, projectId, ...values, autoInvestigateEnabledAt: values.autoInvestigateOnOpen ? new Date() : null })
    .onConflictDoUpdate({
      target: notificationPolicies.projectId,
      set: {
        ...updates,
        autoInvestigateEnabledAt: values.autoInvestigateOnOpen ? sql`coalesce(${notificationPolicies.autoInvestigateEnabledAt}, now())` : null,
      },
    });
  await logAuditEvent({
    userId: scope.userId,
    organizationId,
    action: "incident_policy_updated",
    resource: "project",
    resourceId: projectId,
    // Settings only: ids and numbers, never addresses.
    metadata: {
      channelCount: channelIds.length,
      renotifyUnackedMinutes: data.renotifyUnackedMinutes,
      renotifyRepeatMinutes: data.renotifyRepeatMinutes,
      renotifyMax: data.renotifyMax,
      escalateAfterMinutes: data.escalateAfterMinutes,
      escalateTarget: data.escalateChannelId ? "channel" : data.escalateUserId ? "member" : null,
    },
    success: true,
  });
  return { success: true };
}
