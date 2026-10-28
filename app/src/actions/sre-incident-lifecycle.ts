"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { sreIncidents, sreIncidentTimelineEvents, user } from "@/db/schema";
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
import { checkSreIncidentUpdateRateLimit } from "@/lib/sre/sre-rate-limiter";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-incident-lifecycle" }) as {
  error: (data: unknown, message?: string) => void;
};

const assignSchema = z.object({
  incidentId: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable(),
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
});

export type SreIncidentActionResult =
  | { success: true; message: string }
  | { success: false; error: string };

export type SreIncidentAssignee = {
  id: string;
  name: string;
  image: string | null;
};

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
  | { ok: true; actor: IncidentActor }
  | { ok: false; error: string };

async function guard(action: "view" | "update"): Promise<Guarded> {
  const { userId, organizationId, project } = await requireProjectContext();
  if (!checkPermissionWithContext("sre_incident", action, { userId, organizationId, project })) {
    return { ok: false, error: "Insufficient permissions for this incident action" };
  }
  return { ok: true, actor: { userId, organizationId, projectId: project.id } };
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
    const result = await addIncidentUpdate(auth.actor, parsed.data.incidentId, parsed.data.text);
    if (!result.ok) return { success: false, error: result.error };
    refresh(parsed.data.incidentId);
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
  | { success: true; events: SreIncidentTimelineItem[] } // newest first
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
    return { success: true, events };
  } catch (error) {
    logger.error({ error }, "Error loading SRE incident timeline");
    return { success: false, error: "Failed to load timeline", events: [] };
  }
}
