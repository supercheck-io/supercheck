"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { member, sreAlertEvents, sreIncidents, sreIncidentTimelineEvents, incidents as statusPageIncidents, statusPages, user } from "@/db/schema";
import { updateIncidentStatus } from "@/actions/update-incident-status";
import { createLogger } from "@/lib/logger/index";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import {
  MAX_INCIDENT_UPDATE_LENGTH,
  MAX_RESOLUTION_SUMMARY_LENGTH,
  acknowledgeIncident,
  addIncidentUpdate,
  assignIncident,
  listAssignableUsers,
  resolveIncident,
  type IncidentActor,
} from "@/lib/sre/incident-lifecycle";
import { unwatchIncident, watchIncident } from "@/lib/sre/incident-watchers";
import { checkSreIncidentUpdateRateLimit } from "@/lib/sre/sre-rate-limiter";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-incident-lifecycle" }) as {
  error: (data: unknown, message?: string) => void;
};

const assignSchema = z.object({
  incidentId: z.string().uuid(),
  // Lowercased: timeline lookups key users by the database's lowercase ids.
  assigneeUserId: z.string().uuid().transform((value) => value.toLowerCase()).nullable(),
  role: z.enum(["assignee", "commander"]).default("assignee"),
});
const incidentIdSchema = z.object({ incidentId: z.string().uuid() });
const resolveSchema = z.object({
  incidentId: z.string().uuid(),
  summary: z.string().trim().min(1, "A resolution summary is required").max(MAX_RESOLUTION_SUMMARY_LENGTH),
});
const updateSchema = z.object({
  incidentId: z.string().uuid(),
  text: z.string().trim().min(1, "Update cannot be empty").max(MAX_INCIDENT_UPDATE_LENGTH),
  /** Also publish the note as an update on the incident's linked status page incident. */
  postToStatusPage: z.boolean().optional(),
});

export type SreIncidentActionResult =
  | { success: true; message: string; /** Set when the note was saved but a follow-up step failed. */ warning?: string }
  | { success: false; error: string };

export type SreIncidentAssignee = {
  id: string;
  name: string;
  image: string | null;
};

/** Names for ids that timeline events store, so reassignments and linked alerts read as words. */
export type SreIncidentTimelineRefs = { users: Record<string, string>; alerts: Record<string, string> };

export type SreIncidentTimelineItem = {
  id: string;
  eventType: string;
  eventData: Record<string, unknown> | null;
  actorType: string;
  actorName: string | null;
  actorImage: string | null;
  createdAt: Date;
};

type Guarded =
  | { ok: true; actor: IncidentActor; context: { userId: string; organizationId: string; orgPendingDeletion: boolean; project: Awaited<ReturnType<typeof requireProjectContext>>["project"] } }
  | { ok: false; error: string };

async function guard(action: "view" | "update"): Promise<Guarded> {
  const { userId, organizationId, orgPendingDeletion, project } = await requireProjectContext();
  if (!checkPermissionWithContext("sre_incident", action, { userId, organizationId, orgPendingDeletion, project })) {
    return { ok: false, error: "Insufficient permissions for this incident action" };
  }
  return { ok: true, actor: { userId, organizationId, projectId: project.id }, context: { userId, organizationId, orgPendingDeletion, project } };
}

async function updateRateLimitError(actor: IncidentActor, incidentId: string) {
  const limit = await checkSreIncidentUpdateRateLimit(actor.userId, incidentId);
  return limit.allowed ? null : "Too many incident updates. Try again in a minute.";
}

function refresh(incidentId: string) {
  revalidatePath("/incidents");
  revalidatePath(`/incidents/${incidentId}`);
}

export async function assignSreIncident(
  input: z.input<typeof assignSchema>,
): Promise<SreIncidentActionResult> {
  try {
    const parsed = assignSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid assignment request" };
    const auth = await guard("update");
    if (!auth.ok) return { success: false, error: auth.error };
    const limited = await updateRateLimitError(auth.actor, parsed.data.incidentId);
    if (limited) return { success: false, error: limited };
    const result = await assignIncident(auth.actor, parsed.data.incidentId, parsed.data.assigneeUserId, parsed.data.role);
    if (!result.ok) return { success: false, error: result.error };
    refresh(parsed.data.incidentId);
    return {
      success: true,
      message: parsed.data.assigneeUserId ? "Incident assigned" : "Incident unassigned",
    };
  } catch (error) {
    logger.error({ error }, "Error assigning SRE incident");
    return { success: false, error: "Failed to assign incident" };
  }
}

export async function acknowledgeSreIncident(
  input: z.infer<typeof incidentIdSchema>,
): Promise<SreIncidentActionResult> {
  try {
    const parsed = incidentIdSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid incident" };
    const auth = await guard("update");
    if (!auth.ok) return { success: false, error: auth.error };
    const limited = await updateRateLimitError(auth.actor, parsed.data.incidentId);
    if (limited) return { success: false, error: limited };
    const result = await acknowledgeIncident(auth.actor, parsed.data.incidentId);
    if (!result.ok) return { success: false, error: result.error };
    refresh(parsed.data.incidentId);
    return {
      success: true,
      message: result.changed ? "Incident acknowledged" : "Incident was already acknowledged",
    };
  } catch (error) {
    logger.error({ error }, "Error acknowledging SRE incident");
    return { success: false, error: "Failed to acknowledge incident" };
  }
}

/** Follow or stop following an incident. Open to anyone who can view it, viewers included. */
export async function setSreIncidentWatching(
  input: { incidentId: string; watching: boolean },
): Promise<SreIncidentActionResult> {
  try {
    const parsed = z.object({ incidentId: z.string().uuid(), watching: z.boolean() }).safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid incident" };
    const auth = await guard("view");
    if (!auth.ok) return { success: false, error: auth.error };
    const [incident] = await db
      .select({ id: sreIncidents.id })
      .from(sreIncidents)
      .where(
        and(
          eq(sreIncidents.id, parsed.data.incidentId),
          eq(sreIncidents.organizationId, auth.actor.organizationId),
          eq(sreIncidents.projectId, auth.actor.projectId),
        ),
      )
      .limit(1);
    if (!incident) return { success: false, error: "Incident not found or access denied" };
    if (parsed.data.watching) await watchIncident(db, incident.id, auth.actor.userId);
    else await unwatchIncident(db, incident.id, auth.actor.userId);
    refresh(incident.id);
    return { success: true, message: parsed.data.watching ? "You will get emails about this incident" : "You stopped watching this incident" };
  } catch (error) {
    logger.error({ error }, "Error changing SRE incident watch");
    return { success: false, error: "Failed to update watch setting" };
  }
}

export async function resolveSreIncident(
  input: z.infer<typeof resolveSchema>,
): Promise<SreIncidentActionResult> {
  try {
    const parsed = resolveSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid resolution" };
    }
    const auth = await guard("update");
    if (!auth.ok) return { success: false, error: auth.error };
    const limited = await updateRateLimitError(auth.actor, parsed.data.incidentId);
    if (limited) return { success: false, error: limited };
    const result = await resolveIncident(auth.actor, parsed.data.incidentId, parsed.data.summary);
    if (!result.ok) return { success: false, error: result.error };
    refresh(parsed.data.incidentId);
    return {
      success: true,
      message: result.changed
        ? `Incident #${result.incident.incidentNumber} resolved`
        : `Incident #${result.incident.incidentNumber} was already resolved`,
    };
  } catch (error) {
    logger.error({ error }, "Error resolving SRE incident");
    return { success: false, error: "Failed to resolve incident" };
  }
}

/** The linked public incident, unless it is resolved or scheduled maintenance (those need their own flow). */
async function findOpenStatusPageIncident(actor: IncidentActor, incidentId: string) {
  const [row] = await db
    .select({ id: statusPageIncidents.id, statusPageId: statusPageIncidents.statusPageId, status: statusPageIncidents.status })
    .from(sreIncidents)
    .innerJoin(statusPageIncidents, eq(statusPageIncidents.id, sreIncidents.statusPageIncidentId))
    .innerJoin(statusPages, eq(statusPages.id, statusPageIncidents.statusPageId))
    .where(
      and(
        eq(sreIncidents.id, incidentId),
        eq(sreIncidents.organizationId, actor.organizationId),
        eq(sreIncidents.projectId, actor.projectId),
        eq(statusPages.organizationId, actor.organizationId),
        eq(statusPages.projectId, actor.projectId),
      ),
    )
    .limit(1);
  return row && ["investigating", "identified", "monitoring"].includes(row.status) ? row : null;
}

export async function addSreIncidentUpdate(
  input: z.infer<typeof updateSchema>,
): Promise<SreIncidentActionResult> {
  try {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid update" };
    }
    const auth = await guard("update");
    if (!auth.ok) return { success: false, error: auth.error };
    const limited = await updateRateLimitError(auth.actor, parsed.data.incidentId);
    if (limited) return { success: false, error: limited };
    // Checked before the note is written, so a refused post never leaves a half-done update.
    let statusPageTarget: { id: string; statusPageId: string; status: string } | null = null;
    if (parsed.data.postToStatusPage) {
      if (!checkPermissionWithContext("status_page", "update", auth.context)) {
        return { success: false, error: "Insufficient permissions to post to the status page" };
      }
      statusPageTarget = await findOpenStatusPageIncident(auth.actor, parsed.data.incidentId);
      if (!statusPageTarget) {
        return { success: false, error: "This incident has no open status page incident to post to" };
      }
    }
    const result = await addIncidentUpdate(auth.actor, parsed.data.incidentId, parsed.data.text);
    if (!result.ok) return { success: false, error: result.error };
    refresh(parsed.data.incidentId);
    if (statusPageTarget) {
      // The existing status page path writes the update and queues subscriber emails.
      const posted = await updateIncidentStatus({
        incidentId: statusPageTarget.id,
        statusPageId: statusPageTarget.statusPageId,
        status: statusPageTarget.status as "investigating" | "identified" | "monitoring",
        body: parsed.data.text,
        deliverNotifications: true,
        restoreComponentStatus: false,
      }, { expectedStatus: statusPageTarget.status }).catch(() => null);
      if (!posted?.success) {
        return { success: true, message: "Update added", warning: `The status page post failed: ${posted?.message ?? "try again from the status page"}` };
      }
      return { success: true, message: "Update added and posted to the status page" };
    }
    return { success: true, message: "Update added" };
  } catch (error) {
    logger.error({ error }, "Error adding SRE incident update");
    return { success: false, error: "Failed to add update" };
  }
}

export async function getSreIncidentAssignees(): Promise<
  | { success: true; assignees: SreIncidentAssignee[] }
  | { success: false; error: string; assignees: [] }
> {
  try {
    const auth = await guard("view");
    if (!auth.ok) return { success: false, error: auth.error, assignees: [] };
    const assignees = await listAssignableUsers(auth.actor.organizationId, auth.actor.projectId);
    return { success: true, assignees };
  } catch (error) {
    logger.error({ error }, "Error listing SRE incident assignees");
    return { success: false, error: "Failed to load assignees", assignees: [] };
  }
}

export async function getSreIncidentTimeline(
  incidentId: string,
): Promise<
  | { success: true; events: SreIncidentTimelineItem[]; refs: SreIncidentTimelineRefs } // newest first
  | { success: false; error: string; events: [] }
> {
  try {
    const parsed = z.string().uuid().safeParse(incidentId);
    if (!parsed.success) return { success: false, error: "Invalid incident", events: [] };
    const auth = await guard("view");
    if (!auth.ok) return { success: false, error: auth.error, events: [] };

    const [incident] = await db
      .select({ id: sreIncidents.id })
      .from(sreIncidents)
      .where(
        and(
          eq(sreIncidents.id, parsed.data),
          eq(sreIncidents.organizationId, auth.actor.organizationId),
          eq(sreIncidents.projectId, auth.actor.projectId),
        ),
      )
      .limit(1);
    if (!incident) return { success: false, error: "Incident not found or access denied", events: [] };

    const events = await db
      .select({
        id: sreIncidentTimelineEvents.id,
        eventType: sreIncidentTimelineEvents.eventType,
        eventData: sreIncidentTimelineEvents.eventData,
        actorType: sreIncidentTimelineEvents.actorType,
        actorName: user.name,
        actorImage: user.image,
        createdAt: sreIncidentTimelineEvents.createdAt,
      })
      .from(sreIncidentTimelineEvents)
      .leftJoin(user, eq(user.id, sreIncidentTimelineEvents.actorUserId))
      .where(eq(sreIncidentTimelineEvents.incidentId, incident.id))
      .orderBy(desc(sreIncidentTimelineEvents.createdAt))
      .limit(500);

    const userIds = new Set<string>();
    const alertIds = new Set<string>();
    for (const { eventData: data } of events) {
      for (const key of ["previousAssigneeUserId", "assigneeUserId"]) {
        const value = data?.[key];
        if (typeof value === "string" && z.string().uuid().safeParse(value).success) userIds.add(value);
      }
      const alertId = data?.alertEventId;
      if (typeof alertId === "string" && z.string().uuid().safeParse(alertId).success) alertIds.add(alertId);
    }
    const [users, alerts] = await Promise.all([
      userIds.size
        ? db
            .select({ id: user.id, name: user.name })
            .from(user)
            .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, auth.actor.organizationId)))
            .where(inArray(user.id, [...userIds]))
        : [],
      alertIds.size
        ? db
            .select({ id: sreAlertEvents.id, title: sreAlertEvents.title })
            .from(sreAlertEvents)
            .where(and(inArray(sreAlertEvents.id, [...alertIds]), eq(sreAlertEvents.organizationId, auth.actor.organizationId), eq(sreAlertEvents.projectId, auth.actor.projectId)))
        : [],
    ]);
    const refs: SreIncidentTimelineRefs = {
      users: Object.fromEntries(users.map((row) => [row.id, row.name])),
      alerts: Object.fromEntries(alerts.map((row) => [row.id, row.title])),
    };
    return { success: true, events, refs };
  } catch (error) {
    logger.error({ error }, "Error loading SRE incident timeline");
    return { success: false, error: "Failed to load timeline", events: [] };
  }
}
