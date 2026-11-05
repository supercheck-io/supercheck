"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { notificationPolicies, notificationProviders, projects } from "@/db/schema";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { getNotificationPolicy, type NotificationPolicy } from "@/lib/sre/notification-policy";
import { db } from "@/utils/db";

type ActionResult<T = undefined> = { success: boolean; error?: string; data?: T };

export type PolicyChannel = { id: string; name: string; type: string };

const policySchema = z.object({
  channelIds: z.array(z.string().uuid()).max(10),
  emailServiceOwnersOnSev12: z.boolean(),
  renotifyUnackedMinutes: z.number().int().min(5).max(1440).nullable(),
  autoInvestigateOnOpen: z.boolean(),
});

/** The target project must belong to the caller's organization; org admins may manage any of its projects. */
async function authorize(projectId: string, action: "view" | "update") {
  const { organizationId } = await requireProjectContext();
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)),
    columns: { id: true },
  });
  if (!project) return { ok: false as const, error: "Access denied" };
  const allowed = await hasPermission("project", action, { organizationId, projectId });
  if (!allowed) return { ok: false as const, error: "Insufficient permissions" };
  return { ok: true as const, organizationId };
}

export async function getProjectNotificationPolicy(
  projectId: string,
): Promise<ActionResult<{ policy: NotificationPolicy; channels: PolicyChannel[] }>> {
  try {
    const auth = await authorize(projectId, "view");
    if (!auth.ok) return { success: false, error: auth.error };
    const [policy, channels] = await Promise.all([
      getNotificationPolicy(projectId),
      db
        .select({ id: notificationProviders.id, name: notificationProviders.name, type: notificationProviders.type })
        .from(notificationProviders)
        .where(and(eq(notificationProviders.projectId, projectId), eq(notificationProviders.isEnabled, true)))
        .limit(100),
    ]);
    return { success: true, data: { policy, channels } };
  } catch {
    return { success: false, error: "Failed to load the notification policy" };
  }
}

export async function saveProjectNotificationPolicy(
  projectId: string,
  input: z.input<typeof policySchema>,
): Promise<ActionResult> {
  try {
    const parsed = policySchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid notification policy" };
    const auth = await authorize(projectId, "update");
    if (!auth.ok) return { success: false, error: auth.error };

    const channelIds = [...new Set(parsed.data.channelIds)];
    if (channelIds.length > 0) {
      // Only this project's own channels may be named.
      const owned = await db
        .select({ id: notificationProviders.id })
        .from(notificationProviders)
        .where(and(inArray(notificationProviders.id, channelIds), eq(notificationProviders.projectId, projectId)));
      if (owned.length !== channelIds.length) return { success: false, error: "Some channels do not belong to this project" };
    }

    const values = { ...parsed.data, channelIds, updatedAt: new Date() };
    // Stamped when auto-investigate turns on (kept while it stays on, cleared when off), so unrelated saves
    // never move the cut-off that keeps older incidents from being auto-run.
    await db
      .insert(notificationPolicies)
      .values({
        organizationId: auth.organizationId,
        projectId,
        ...values,
        autoInvestigateEnabledAt: values.autoInvestigateOnOpen ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: notificationPolicies.projectId,
        set: {
          ...values,
          autoInvestigateEnabledAt: values.autoInvestigateOnOpen
            ? sql`coalesce(${notificationPolicies.autoInvestigateEnabledAt}, now())`
            : null,
        },
      });
    return { success: true };
  } catch {
    return { success: false, error: "Failed to save the notification policy" };
  }
}
