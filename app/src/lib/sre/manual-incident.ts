import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { sreIncidentResources, sreIncidents, sreIncidentTimelineEvents, sreServices } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger/index";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getDefaultAssigneeId, isAssignableUser } from "@/lib/sre/incident-lifecycle";
import { notifyIncidentEvent } from "@/lib/sre/incident-notifier";
import { addIncidentResources, liveResourceKeys, MAX_INCIDENT_RESOURCES, resolveIncidentResources } from "@/lib/sre/incident-resources";
import { watchIncident } from "@/lib/sre/incident-watchers";
import { lapsedWriteBlock, type SubscriptionRequiredResult } from "@/lib/sre/lapsed-org-gate";
import { checkSreIncidentCreateRateLimit } from "@/lib/sre/sre-rate-limiter";
import { createStatusPageIncident, findStatusPageTargetError, type StatusPageIncidentActor } from "@/lib/status-page-incident-core";
import { maybeAutoInvestigateOnOpen } from "@/sre/lib/auto-investigate";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-manual-incident" }) as {
  error: (data: unknown, message?: string) => void;
};

// Lowercase, as Postgres returns them, so keys built from input match stored ids.
const uuid = z.string().uuid().transform((value) => value.toLowerCase());

/** Impact picked for the public post sets how affected components show. */
const COMPONENT_STATUS_FOR_IMPACT = {
  none: "operational",
  minor: "degraded_performance",
  major: "partial_outage",
  critical: "major_outage",
} as const;

export const manualIncidentInputSchema = z
  .object({
    title: z.string().trim().min(1, "Incident title is required").max(500, "Incident title is too long"),
    severity: z.enum(["sev1", "sev2", "sev3", "sev4"]).default("sev3"),
    summary: z.string().trim().max(4000, "Summary is too long").nullish(),
    primaryServiceId: uuid.nullish(),
    affected: z
      .object({
        serviceIds: z.array(uuid).max(MAX_INCIDENT_RESOURCES).default([]),
        monitorIds: z.array(uuid).max(MAX_INCIDENT_RESOURCES).default([]),
      })
      .optional(),
    commanderUserId: uuid.nullish(),
    statusPage: z
      .object({
        statusPageId: uuid,
        componentIds: z.array(uuid).min(1, "Select at least one affected component").max(100).transform((ids) => [...new Set(ids)]),
        impact: z.enum(["none", "minor", "major", "critical"]).default("minor"),
        message: z.string().trim().max(10000, "Message is too long").optional(),
        notifySubscribers: z.boolean().default(false),
      })
      .nullish(),
  })
  .refine(
    (input) => new Set([...(input.affected?.serviceIds ?? []), ...(input.affected?.monitorIds ?? []), ...(input.primaryServiceId ? [input.primaryServiceId] : [])]).size <= MAX_INCIDENT_RESOURCES,
    { message: `List at most ${MAX_INCIDENT_RESOURCES} affected services and monitors`, path: ["affected"] },
  );

export type ManualIncidentInput = z.input<typeof manualIncidentInputSchema>;
export type ManualIncidentSource = "ui" | "api" | "mcp" | "cli";

export type ManualIncidentResult =
  | {
      ok: true;
      incident: { id: string; incidentNumber: number; title: string };
      statusPageIncidentId?: string;
      /** The incident exists; only the public post failed. Retry with "Post to status page" in the incident's properties. */
      warning?: "status_page_failed";
    }
  | { ok: false; code: "invalid"; error: string; fieldErrors?: Record<string, string[]> }
  | { ok: false; code: "forbidden" | "not_found"; error: string }
  | { ok: false; code: "rate_limited"; error: string; retryAfterSeconds: number }
  | SubscriptionRequiredResult;

/**
 * Declares an incident by hand. The one path for the UI, the API (and through it the CLI) and MCP:
 * same numbering, timeline, audit event, notifications, re-notify and auto-investigate as before,
 * plus affected resources and an optional public status-page post.
 */
export async function createManualIncident(
  actor: StatusPageIncidentActor,
  input: ManualIncidentInput,
  source: ManualIncidentSource,
): Promise<ManualIncidentResult> {
  const parsed = manualIncidentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Invalid incident details", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  }
  const data = parsed.data;
  const { userId, organizationId } = actor;
  const projectId = actor.project.id;
  const can = (resource: "sre_incident" | "status_page", action: string) => checkPermissionWithContext(resource, action, actor);
  // Posting publicly needs status page rights; linking it back to the incident needs incident view.
  if (!can("sre_incident", "create") || (data.statusPage && (!can("status_page", "update") || !can("sre_incident", "view")))) {
    return { ok: false, code: "forbidden", error: "Insufficient permissions to create incidents" };
  }

  const lapsed = await lapsedWriteBlock(organizationId);
  if (lapsed) return lapsed;

  const scope = { organizationId, projectId };
  const resources = await resolveIncidentResources(db, scope, {
    serviceIds: [...(data.primaryServiceId ? [data.primaryServiceId] : []), ...(data.affected?.serviceIds ?? [])],
    monitorIds: data.affected?.monitorIds ?? [],
  });
  if (!resources) return { ok: false, code: "not_found", error: "A selected service or monitor was not found in this project" };
  if (data.statusPage) {
    const targetError = await findStatusPageTargetError(scope, data.statusPage.statusPageId, data.statusPage.componentIds);
    if (targetError) return { ok: false, code: "not_found", error: targetError };
  }
  if (data.commanderUserId && !(await isAssignableUser(organizationId, projectId, data.commanderUserId))) {
    return { ok: false, code: "invalid", error: "Commander must be an editor or admin of this project" };
  }
  // Like alert-opened incidents: the service owner when a service is named, else the person declaring it.
  const assigneeUserId =
    (data.primaryServiceId ? await getDefaultAssigneeId(db, { ...scope, serviceId: data.primaryServiceId }) : null) ?? userId;

  // Spent only by a request that will write: bad ids, a wrong page or commander never use up the limit.
  const limit = await checkSreIncidentCreateRateLimit(organizationId, userId);
  if (!limit.allowed) {
    const retryAfterSeconds = limit.resetTime ? Math.max(1, Math.ceil((limit.resetTime - Date.now()) / 1000)) : 60;
    return { ok: false, code: "rate_limited", error: "Too many incidents declared. Try again shortly.", retryAfterSeconds };
  }

  const title = data.title.slice(0, 500);
  const summary = data.summary || null;
  const now = new Date();
  const incident = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${organizationId}))`);
    const [numberRow] = await tx
      .select({ nextIncidentNumber: sql<number>`coalesce(max(${sreIncidents.incidentNumber}), 0) + 1` })
      .from(sreIncidents)
      .where(eq(sreIncidents.organizationId, organizationId));
    const [created] = await tx
      .insert(sreIncidents)
      .values({
        organizationId,
        projectId,
        incidentNumber: Number(numberRow?.nextIncidentNumber ?? 1),
        title,
        severity: data.severity,
        status: "triggered",
        alertCount: 0, // no alert yet: a hand-created incident counts only alerts that join it
        primaryServiceId: data.primaryServiceId ?? null,
        commanderUserId: data.commanderUserId ?? null,
        createdByUserId: userId,
        assigneeUserId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: sreIncidents.id, incidentNumber: sreIncidents.incidentNumber, title: sreIncidents.title });

    await watchIncident(tx, created.id, userId);
    await tx.insert(sreIncidentTimelineEvents).values({
      incidentId: created.id,
      eventType: "state_change",
      eventData: { state: "manual_incident_created", summary, createdByUserId: userId, source },
      actorType: "user",
      actorUserId: userId,
      createdAt: now,
    });
    const added = await addIncidentResources(tx, created.id, resources);
    if (added.length > 0) {
      await tx.insert(sreIncidentTimelineEvents).values({
        incidentId: created.id,
        eventType: "state_change",
        eventData: { state: "resources_affected", added, removed: [] },
        actorType: "user",
        actorUserId: userId,
        createdAt: now,
      });
    }
    return created;
  });

  await logAuditEvent({
    userId,
    organizationId,
    action: "sre_incident_created_manual",
    resource: "sre_incident",
    resourceId: incident.id,
    metadata: {
      projectId,
      incidentNumber: incident.incidentNumber,
      severity: data.severity,
      source,
      resources: resources.length,
      statusPage: Boolean(data.statusPage),
    },
    success: true,
  });

  // Channels come from the project's Default policy; the assignee and commander get direct email unless they declared it.
  void notifyIncidentEvent({
    organizationId,
    projectId,
    incidentId: incident.id,
    event: "created",
    actorUserId: userId,
    assigneeUserId,
  }).catch(() => undefined);
  // Project opt-in only; runs in the background and never blocks creating the incident.
  void maybeAutoInvestigateOnOpen({ organizationId, projectId, incidentId: incident.id, userId }).catch(() => undefined);

  let statusPageIncidentId: string | undefined;
  let warning: "status_page_failed" | undefined;
  if (data.statusPage) {
    // A second transaction: losing the incident because the public post failed would be worse than a missing post.
    const posted = await createStatusPageIncident(actor, {
      sreIncidentId: incident.id,
      statusPageId: data.statusPage.statusPageId,
      name: title.slice(0, 255),
      status: "investigating",
      impact: data.statusPage.impact,
      body: data.statusPage.message || undefined,
      affectedComponentIds: data.statusPage.componentIds,
      componentStatus: COMPONENT_STATUS_FOR_IMPACT[data.statusPage.impact],
      deliverNotifications: data.statusPage.notifySubscribers,
    }).catch((error: unknown) => {
      logger.error({ error, incidentId: incident.id }, "Status page post for a declared incident failed");
      return { success: false as const, message: "Failed to post to the status page" };
    });
    if (posted.success) {
      statusPageIncidentId = posted.incident.id;
    } else {
      warning = "status_page_failed";
      await db
        .insert(sreIncidentTimelineEvents)
        .values({
          incidentId: incident.id,
          eventType: "state_change",
          eventData: { state: "status_page_post_failed", comment: posted.message.slice(0, 300) },
          actorType: "system",
          createdAt: new Date(),
        })
        .catch((error: unknown) => logger.error({ error, incidentId: incident.id }, "Could not record the failed status page post"));
    }
  }

  revalidatePath("/incidents");
  revalidatePath(`/incidents/${incident.id}`);
  return { ok: true, incident, ...(statusPageIncidentId ? { statusPageIncidentId } : {}), ...(warning ? { warning } : {}) };
}

export const incidentResourcesPatchSchema = z
  .object({
    add: z.object({ serviceIds: z.array(uuid).max(MAX_INCIDENT_RESOURCES).default([]), monitorIds: z.array(uuid).max(MAX_INCIDENT_RESOURCES).default([]) }).default({ serviceIds: [], monitorIds: [] }),
    remove: z.object({ serviceIds: z.array(uuid).max(MAX_INCIDENT_RESOURCES).default([]), monitorIds: z.array(uuid).max(MAX_INCIDENT_RESOURCES).default([]) }).default({ serviceIds: [], monitorIds: [] }),
  })
  .refine((patch) => patch.add.serviceIds.length + patch.add.monitorIds.length + patch.remove.serviceIds.length + patch.remove.monitorIds.length > 0, {
    message: "Add or remove at least one service or monitor",
  });

/** Adds or removes affected services and monitors after creation; one timeline row names what changed. */
export async function updateIncidentResources(
  actor: StatusPageIncidentActor,
  incidentId: string,
  input: z.input<typeof incidentResourcesPatchSchema>,
): Promise<{ ok: true; added: number; removed: number } | { ok: false; code: "invalid" | "forbidden" | "not_found" | "conflict"; error: string }> {
  const parsed = incidentResourcesPatchSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(incidentId).success) return { ok: false, code: "invalid", error: parsed.success ? "Invalid incident" : parsed.error.issues[0]?.message ?? "Invalid resources" };
  if (!checkPermissionWithContext("sre_incident", "update", actor)) return { ok: false, code: "forbidden", error: "Insufficient permissions to update incidents" };
  const scope = { organizationId: actor.organizationId, projectId: actor.project.id };
  const toAdd = await resolveIncidentResources(db, scope, parsed.data.add);
  if (!toAdd) return { ok: false, code: "not_found", error: "A selected service or monitor was not found in this project" };
  const removeKeys = new Set([
    ...parsed.data.remove.serviceIds.map((id) => `service:${id}`),
    ...parsed.data.remove.monitorIds.map((id) => `monitor:${id}`),
  ]);

  const result = await db.transaction(async (tx) => {
    const [incident] = await tx
      .select({ id: sreIncidents.id, status: sreIncidents.status })
      .from(sreIncidents)
      .where(and(eq(sreIncidents.id, incidentId), eq(sreIncidents.organizationId, scope.organizationId), eq(sreIncidents.projectId, scope.projectId)))
      .for("update");
    if (!incident) return null;
    // A resolved incident's record is closed; reopen it first.
    if (incident.status === "resolved") return "resolved" as const;
    const current = await tx
      .select({ id: sreIncidentResources.id, type: sreIncidentResources.resourceType, resourceId: sreIncidentResources.resourceId })
      .from(sreIncidentResources)
      .where(eq(sreIncidentResources.incidentId, incident.id));
    const removing = current.filter((row) => removeKeys.has(`${row.type}:${row.resourceId}`));
    const existing = new Set(current.map((row) => `${row.type}:${row.resourceId}`));
    const adding = toAdd.filter((ref) => !existing.has(`${ref.type}:${ref.id}`) || removeKeys.has(`${ref.type}:${ref.id}`));
    // Deleted monitors and merged services no longer count toward the cap.
    const live = await liveResourceKeys(tx, scope, current.filter((row) => !removeKeys.has(`${row.type}:${row.resourceId}`)));
    if (live.size + adding.length > MAX_INCIDENT_RESOURCES) return "too_many" as const;
    if (removing.length > 0) await tx.delete(sreIncidentResources).where(inArray(sreIncidentResources.id, removing.map((row) => row.id)));
    const added = await addIncidentResources(tx, incident.id, toAdd);
    // Names of removed services, scoped to the project; a monitor removal reads as "N monitors" by type alone.
    const removedServiceIds = removing.filter((row) => row.type === "service").map((row) => row.resourceId);
    const serviceNames = removedServiceIds.length
      ? await tx
          .select({ id: sreServices.id, name: sreServices.name })
          .from(sreServices)
          .where(and(inArray(sreServices.id, removedServiceIds), eq(sreServices.organizationId, scope.organizationId), eq(sreServices.projectId, scope.projectId)))
      : [];
    const removed = removing.map((row) => ({ type: row.type, id: row.resourceId, name: serviceNames.find((service) => service.id === row.resourceId)?.name ?? null }));
    if (added.length > 0 || removed.length > 0) {
      await tx.insert(sreIncidentTimelineEvents).values({
        incidentId: incident.id,
        eventType: "state_change",
        eventData: { state: "resources_affected", added, removed },
        actorType: "user",
        actorUserId: actor.userId,
        createdAt: new Date(),
      });
      await tx.update(sreIncidents).set({ updatedAt: new Date() }).where(eq(sreIncidents.id, incident.id));
    }
    return { added: added.length, removed: removed.length };
  });
  if (result === null) return { ok: false, code: "not_found", error: "Incident not found or access denied" };
  if (result === "resolved") return { ok: false, code: "conflict", error: "Reopen the incident before changing its affected resources" };
  if (result === "too_many") return { ok: false, code: "invalid", error: `List at most ${MAX_INCIDENT_RESOURCES} affected services and monitors` };
  if (result.added > 0 || result.removed > 0) {
    await logAuditEvent({
      userId: actor.userId,
      organizationId: actor.organizationId,
      action: "sre_incident_resources_updated",
      resource: "sre_incident",
      resourceId: incidentId,
      metadata: { projectId: scope.projectId, added: result.added, removed: result.removed },
      success: true,
    });
    revalidatePath(`/incidents/${incidentId}`);
  }
  return { ok: true, ...result };
}
