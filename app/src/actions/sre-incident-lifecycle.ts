"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { loadTimelineRefs } from "@/lib/sre/timeline-refs";

import { sreIncidents, sreIncidentTimelineEvents, user } from "@/db/schema";
import {
  describeStatusPagePublish,
  listOpenLinkedStatusPageIncidents,
  publishSreResolutionToStatusPages,
  updateStatusPageIncident,
} from "@/lib/status-page-incident-core";
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
  incidentId: z.string().uuid().transform((value) => value.toLowerCase()),
  // Lowercased: timeline lookups key users by the database's lowercase ids.
  assigneeUserId: z.string().uuid().transform((value) => value.toLowerCase()).nullable(),
  role: z.enum(["assignee", "commander"]).default("assignee"),
});
const incidentIdSchema = z.object({ incidentId: z.string().uuid() });
const resolveSchema = z.object({
  incidentId: z.string().uuid(),
  summary: z.string().trim().min(1, "A resolution summary is required").max(MAX_RESOLUTION_SUMMARY_LENGTH),
  /** Also resolve every open public incident linked to this incident. */
  publishToStatusPages: z.boolean().optional(),
});
const updateSchema = z.object({
  incidentId: z.string().uuid(),
  text: z.string().trim().min(1, "Update cannot be empty").max(MAX_INCIDENT_UPDATE_LENGTH),
  /** Also publish the note as an update on every open status page incident linked to this incident. */
  postToStatusPage: z.boolean().optional(),
  /** The public status the post moves to; by default each public incident keeps its own. */
  statusPageStatus: z.enum(["investigating", "identified", "monitoring", "resolved"]).optional(),
});

export type SreIncidentActionResult =
  | { success: true; message: string; /** Set when the note was saved but a follow-up step failed. */ warning?: string }
  | { success: false; error: string };

export type SreIncidentAssignee = {
  id: string;
  name: string;
  image: string | null;
};

/** Names for ids that timeline events store, so reassignments, linked alerts and notified channels read as words. */
export type SreIncidentTimelineRefs = { users: Record<string, string>; alerts: Record<string, string>; providers: Record<string, string> };

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
      message:
        parsed.data.role === "commander"
          ? parsed.data.assigneeUserId ? "Commander set" : "Commander cleared"
          : parsed.data.assigneeUserId ? "Incident assigned" : "Incident unassigned",
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
    // After the resolve committed: a failed public post is a warning, never a rollback.
    const publish = result.changed && parsed.data.publishToStatusPages
      ? describeStatusPagePublish(await publishSreResolutionToStatusPages(auth.context, parsed.data.incidentId, parsed.data.summary))
      : undefined;
    return {
      success: true,
      message: result.changed
        ? `Incident #${result.incident.incidentNumber} resolved${publish?.note ? `. ${publish.note}` : ""}`
        : `Incident #${result.incident.incidentNumber} was already resolved`,
      ...(publish?.warning ? { warning: publish.warning } : {}),
    };
  } catch (error) {
    logger.error({ error }, "Error resolving SRE incident");
    return { success: false, error: "Failed to resolve incident" };
  }
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
    let targets: Awaited<ReturnType<typeof listOpenLinkedStatusPageIncidents>> = [];
    if (parsed.data.postToStatusPage) {
      if (!checkPermissionWithContext("status_page", "update", auth.context)) {
        return { success: false, error: "Insufficient permissions to post to the status page" };
      }
      targets = await listOpenLinkedStatusPageIncidents(auth.actor, parsed.data.incidentId);
      if (targets.length === 0) {
        return { success: false, error: "This incident has no open status page incident to post to" };
      }
    }
    const result = await addIncidentUpdate(auth.actor, parsed.data.incidentId, parsed.data.text);
    if (!result.ok) return { success: false, error: result.error };
    refresh(parsed.data.incidentId);
    if (targets.length > 0) {
      const failed: string[] = [];
      for (const target of targets) {
        // The status page path writes the update and queues subscriber emails when that post has notifications on.
        const status = parsed.data.statusPageStatus ?? (target.status as "investigating" | "identified" | "monitoring");
        const posted = await updateStatusPageIncident(auth.context, {
          incidentId: target.id,
          statusPageId: target.statusPageId,
          status,
          body: parsed.data.text,
          deliverNotifications: target.deliverNotifications,
          restoreComponentStatus: status === "resolved",
        }, { expectedStatus: target.status }).catch(() => null);
        if (!posted?.success) failed.push(`${target.statusPageName}: ${posted?.message ?? "try again from the status page"}`);
      }
      if (failed.length === targets.length) {
        return { success: true, message: "Update added", warning: `The status page post failed. ${failed.join("; ")}` };
      }
      const message = `Update added and posted to ${targets.length - failed.length === 1 ? "the status page" : `${targets.length - failed.length} status pages`}`;
      return failed.length ? { success: true, message, warning: `Some status page posts failed. ${failed.join("; ")}` } : { success: true, message };
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

    const refs = await loadTimelineRefs(db, { organizationId: auth.actor.organizationId, projectId: auth.actor.projectId, rows: events });
    return { success: true, events, refs };
  } catch (error) {
    logger.error({ error }, "Error loading SRE incident timeline");
    return { success: false, error: "Failed to load timeline", events: [] };
  }
}
