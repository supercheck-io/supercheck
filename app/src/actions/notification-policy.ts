"use server";

import { and, eq } from "drizzle-orm";

import { notificationProviders, projects } from "@/db/schema";
import { assertOrgWritable, isOrgPendingDeletionError } from "@/lib/deletion/org-state";
import { decryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { listAssignableUsers } from "@/lib/sre/incident-lifecycle";
import {
  getNotificationPolicy,
  isPagingWebhook,
  notificationPolicyInputSchema,
  saveNotificationPolicy,
  type NotificationPolicy,
  type NotificationPolicyInput,
} from "@/lib/sre/notification-policy";
import { isUuid } from "@/lib/uuid";
import { db } from "@/utils/db";

type ActionResult<T = undefined> = { success: boolean; error?: string; data?: T };

/** `paging`: a preset or templated webhook, which reminders and escalation never use. */
export type PolicyChannel = { id: string; name: string; type: string; paging: boolean };
export type PolicyMember = { id: string; name: string };

/** The target project must belong to the caller's organization; org admins may manage any of its projects. */
async function authorize(projectId: string, action: "view" | "update") {
  const { organizationId, userId } = await requireProjectContext();
  // A malformed id must not reach the uuid column (Postgres would raise); answer as for any inaccessible project.
  if (!isUuid(projectId)) return { ok: false as const, error: "Access denied" };
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)),
    columns: { id: true },
  });
  if (!project) return { ok: false as const, error: "Access denied" };
  const allowed = await hasPermission("project", action, { organizationId, projectId });
  if (!allowed) return { ok: false as const, error: "Insufficient permissions" };
  return { ok: true as const, organizationId, userId };
}

export async function getProjectNotificationPolicy(
  projectId: string,
): Promise<ActionResult<{ policy: NotificationPolicy; channels: PolicyChannel[]; members: PolicyMember[] }>> {
  try {
    const auth = await authorize(projectId, "view");
    if (!auth.ok) return { success: false, error: auth.error };
    const [policy, rows, members] = await Promise.all([
      getNotificationPolicy(projectId),
      db
        .select({ id: notificationProviders.id, name: notificationProviders.name, type: notificationProviders.type, config: notificationProviders.config })
        .from(notificationProviders)
        .where(and(eq(notificationProviders.projectId, projectId), eq(notificationProviders.organizationId, auth.organizationId), eq(notificationProviders.isEnabled, true)))
        .limit(100),
      listAssignableUsers(auth.organizationId, projectId),
    ]);
    const channels = rows.map(({ config, ...channel }) => {
      let paging = false;
      try {
        paging = isPagingWebhook(channel.type, decryptNotificationProviderConfig(config, projectId) as Record<string, unknown>);
      } catch {
        // An unreadable config cannot be sent to anyway; leave it selectable so the user sees it.
      }
      return { ...channel, paging };
    });
    return { success: true, data: { policy, channels, members: members.map((m) => ({ id: m.id, name: m.name })) } };
  } catch {
    return { success: false, error: "Failed to load the notification policy" };
  }
}

export async function saveProjectNotificationPolicy(projectId: string, input: NotificationPolicyInput): Promise<ActionResult> {
  try {
    if (!notificationPolicyInputSchema.safeParse(input).success) return { success: false, error: "Invalid notification policy" };
    const auth = await authorize(projectId, "update");
    if (!auth.ok) return { success: false, error: auth.error };
    await assertOrgWritable(auth.organizationId);
    return await saveNotificationPolicy({ organizationId: auth.organizationId, projectId, userId: auth.userId }, input);
  } catch (error) {
    if (isOrgPendingDeletionError(error)) return { success: false, error: (error as Error).message };
    return { success: false, error: "Failed to save the notification policy" };
  }
}
