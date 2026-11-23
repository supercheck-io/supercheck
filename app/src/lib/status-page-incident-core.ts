import { db } from "@/utils/db";
import {
  incidents,
  incidentUpdates,
  statusPageNotificationEvents,
  incidentComponents,
  statusPageComponents,
  statusPages,
  sreIncidents,
} from "@/db/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  formatSystemMessage,
  getSystemMessages,
} from "@/lib/status-page-system-messages";
import { eq, and, inArray, notInArray, sql } from "drizzle-orm";
import { repointSreStatusPageSlot, restoreResolvedIncidentComponents } from "@/lib/status-page-reconciliation";
import { incidentScheduleFields } from "@/lib/incident-schedule";
import { updateIncidentStatusSchema, type UpdateIncidentStatusData } from "@/lib/validations/incident-status";

export const createIncidentSchema = z.object({
  sreIncidentId: z.string().uuid().optional(),
  scheduledFor: z.coerce.date().optional(),
  scheduledUntil: z.coerce.date().optional(),
  statusPageId: z.string().uuid(),
  name: z
    .string()
    .min(1, "Title is required")
    .max(255, "Title is too long")
    .trim(),
  status: z
    .enum([
      "investigating",
      "identified",
      "monitoring",
      "resolved",
      "scheduled",
    ])
    .default("investigating"),
  impact: z.enum(["none", "minor", "major", "critical"]).default("minor"),
  body: z.string().max(10000, "Body is too long").optional(),
  affectedComponentIds: z
    .array(z.string().uuid())
    .min(1, "Select at least one affected component")
    .max(100, "Select at most 100 affected components")
    // One row per component: a repeated id would store the new status as the "old" one and break restore.
    .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
  componentStatus: z
    .enum([
      "operational",
      "degraded_performance",
      "partial_outage",
      "major_outage",
      "under_maintenance",
    ])
    .default("partial_outage"),
  deliverNotifications: z.boolean().default(true),
});

// Safe to show as is: the message names no data beyond what the caller already sent.
class IncidentLinkError extends Error {}

export type CreateIncidentData = z.infer<typeof createIncidentSchema>;

/** Who is posting: a session, CLI token or MCP client already resolved to one project and its live role. */
export type StatusPageIncidentActor = {
  userId: string;
  organizationId: string;
  orgPendingDeletion: boolean;
  project: { id: string; name?: string; userRole: string };
};

export type CreateStatusPageIncidentResult =
  | { success: true; message: string; incident: typeof incidents.$inferSelect }
  | { success: false; message: string; forbidden?: boolean };

/**
 * Checks a status page and its components belong to this project before anything is written, so a typo
 * fails the whole request instead of after an incident was declared and its team paged.
 */
export async function findStatusPageTargetError(
  scope: { organizationId: string; projectId: string },
  statusPageId: string,
  componentIds: string[],
): Promise<string | null> {
  const page = await db.query.statusPages.findFirst({
    columns: { id: true },
    where: and(eq(statusPages.id, statusPageId), eq(statusPages.organizationId, scope.organizationId), eq(statusPages.projectId, scope.projectId)),
  });
  if (!page) return "Status page not found or access denied";
  const found = await db
    .select({ id: statusPageComponents.id })
    .from(statusPageComponents)
    .where(and(eq(statusPageComponents.statusPageId, statusPageId), inArray(statusPageComponents.id, componentIds)));
  return found.length === new Set(componentIds).size ? null : "A selected component is not on this status page.";
}

/**
 * The one path that posts a public status-page incident. Server action, manual incident declare and
 * maintenance publishing all call it, so the row lock, link checks and subscriber fan-out stay in one place.
 */
export async function createStatusPageIncident(
  actor: StatusPageIncidentActor,
  data: CreateIncidentData,
): Promise<CreateStatusPageIncidentResult> {
  const { userId, organizationId, project } = actor;
  const can = (resource: "status_page" | "sre_incident", action: string) =>
    checkPermissionWithContext(resource, action, actor);
  try {
    if (!can("status_page", "update")) {
      return { success: false, forbidden: true, message: "Insufficient permissions to post to status pages" };
    }
    // Validate the data
    const validatedData = createIncidentSchema.parse(data);

    if (validatedData.sreIncidentId && !can("sre_incident", "view")) {
      return { success: false, message: "SRE incident not found or access denied" };
    }

    // SECURITY: Verify status page belongs to this organization and project
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, validatedData.statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id),
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to create incident for status page ${validatedData.statusPageId} without ownership`,
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    if (
      validatedData.status === "scheduled" &&
      (!validatedData.scheduledFor ||
        !validatedData.scheduledUntil ||
        validatedData.scheduledFor >= validatedData.scheduledUntil ||
        validatedData.scheduledUntil <= new Date())
    ) {
      return {
        success: false,
        message: "Choose a future maintenance end after its start.",
      };
    }
    if (validatedData.sreIncidentId) {
      const source = await db.query.sreIncidents.findFirst({
        where: and(
          eq(sreIncidents.id, validatedData.sreIncidentId),
          eq(sreIncidents.organizationId, organizationId),
          eq(sreIncidents.projectId, project.id),
        ),
      });
      if (!source)
        return {
          success: false,
          message: "SRE incident not found or access denied",
        };
    }

    if (validatedData.affectedComponentIds.length) {
      const selected = await db
        .select({ id: statusPageComponents.id })
        .from(statusPageComponents)
        .where(
          and(
            eq(statusPageComponents.statusPageId, validatedData.statusPageId),
            inArray(
              statusPageComponents.id,
              validatedData.affectedComponentIds,
            ),
          ),
        );
      if (selected.length !== new Set(validatedData.affectedComponentIds).size)
        return {
          success: false,
          message: "A selected component is not on this status page.",
        };
    }
    // Create the incident and initial update in a transaction
    const result = await db.transaction(async (tx) => {
      let linkedSource: { statusPageIncidentId: string | null } | null = null;
      await tx
        .select({ id: statusPages.id })
        .from(statusPages)
        .where(
          and(
            eq(statusPages.id, validatedData.statusPageId),
            eq(statusPages.organizationId, organizationId),
            eq(statusPages.projectId, project.id),
          ),
        )
        .for("update");
      if (validatedData.sreIncidentId) {
        const linked = await tx.query.incidents.findFirst({
          where: and(
            eq(incidents.statusPageId, validatedData.statusPageId),
            eq(incidents.sreIncidentId, validatedData.sreIncidentId),
          ),
        });
        if (linked)
          throw new IncidentLinkError(
            "This incident already has a public incident on this status page.",
          );
      }
      if (validatedData.sreIncidentId) {
        const [source] = await tx
          .select()
          .from(sreIncidents)
          .where(
            and(
              eq(sreIncidents.id, validatedData.sreIncidentId),
              eq(sreIncidents.organizationId, organizationId),
              eq(sreIncidents.projectId, project.id),
            ),
          )
          .for("update");
        if (!source) throw new Error("SRE incident not found or access denied");
        linkedSource = source;
      }
      // Create the incident
      const [incident] = await tx
        .insert(incidents)
        .values({
          statusPageId: validatedData.statusPageId,
          createdByUserId: userId,
          name: validatedData.name,
          sreIncidentId: validatedData.sreIncidentId,
          scheduledFor: validatedData.status === "scheduled" ? validatedData.scheduledFor : null,
          scheduledUntil: validatedData.status === "scheduled" ? validatedData.scheduledUntil : null,
          scheduledRemindPrior: false,
          autoTransitionDeliverNotificationsAtStart: validatedData.deliverNotifications,
          autoTransitionDeliverNotificationsAtEnd: validatedData.deliverNotifications,
          status: validatedData.status,
          impact: validatedData.impact,
          body: validatedData.body || null,
          deliverNotifications: validatedData.deliverNotifications,
          // Posted already resolved (a retrospective): it is over, so uptime and bars never treat it as open.
          resolvedAt: validatedData.status === "resolved" ? new Date() : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // One SRE incident may have a post on several pages (incidents.sre_incident_id is the link); the SRE incident's
      // single status_page_incident_id is a legacy pointer that keeps the first one.
      if (validatedData.sreIncidentId && !linkedSource?.statusPageIncidentId)
        await tx
          .update(sreIncidents)
          .set({ statusPageIncidentId: incident.id, updatedAt: new Date() })
          .where(
            and(
              eq(sreIncidents.id, validatedData.sreIncidentId),
              eq(sreIncidents.organizationId, organizationId),
              eq(sreIncidents.projectId, project.id),
            ),
          );
      // Create initial incident update
      const [update] = await tx
        .insert(incidentUpdates)
        .values({
          incidentId: incident.id,
          createdByUserId: userId,
          body:
            validatedData.body ||
            formatSystemMessage(
              getSystemMessages(statusPage.language).incidentCreatedBody,
              { name: validatedData.name },
            ),
          status: validatedData.status,
          deliverNotifications: validatedData.deliverNotifications,
          displayAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (validatedData.deliverNotifications) {
        await tx
          .insert(statusPageNotificationEvents)
          .values({
            incidentId: incident.id,
            updateId: update.id,
            isCreation: true,
          });
      }

      // Link affected components and update their status
      if (validatedData.affectedComponentIds.length > 0) {
        for (const componentId of validatedData.affectedComponentIds) {
          // Get current component status - verify it belongs to this status page
          const component = await tx.query.statusPageComponents.findFirst({
            where: and(
              eq(statusPageComponents.id, componentId),
              eq(statusPageComponents.statusPageId, validatedData.statusPageId),
            ),
          });

          if (component) {
            // Create incident-component link
            await tx.insert(incidentComponents).values({
              incidentId: incident.id,
              componentId,
              oldStatus: component.status,
              newStatus:
                validatedData.status === "scheduled"
                  ? "under_maintenance"
                  : validatedData.componentStatus,
              createdAt: new Date(),
            });

            // Future maintenance and an already resolved post do not change current health.
            if (validatedData.status !== "scheduled" && validatedData.status !== "resolved")
              await tx
                .update(statusPageComponents)
                .set({
                  status: validatedData.componentStatus,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(statusPageComponents.id, componentId),
                    eq(
                      statusPageComponents.statusPageId,
                      validatedData.statusPageId,
                    ),
                  ),
                );
          }
        }
      }

      return incident;
    });

    // Log the audit event
    await logAuditEvent({
      userId,
      action: "incident_created",
      resource: "incident",
      resourceId: result.id,
      metadata: {
        organizationId,
        incidentName: validatedData.name,
        statusPageId: validatedData.statusPageId,
        projectId: project.id,
        projectName: project.name,
        affectedComponents: validatedData.affectedComponentIds.length,
      },
      success: true,
    });

    // Revalidate the status page
    revalidatePath(`/status-pages/${validatedData.statusPageId}`);
    revalidatePath(`/status-pages/${validatedData.statusPageId}/public`);

    return {
      success: true,
      message: "Incident created successfully",
      incident: result,
    };
  } catch (error) {
    console.error("Error creating incident:", error);

    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: error.issues[0]?.message || "Invalid data provided",
      };
    }

    if (error instanceof IncidentLinkError) {
      return { success: false, message: error.message };
    }

    return {
      success: false,
      message: "Failed to create incident. Please try again.",
    };
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Writes one public status change and its update inside `tx`: the step every status change shares (manual update,
 * SRE resolve fan-out, component delete). Returns null when `expectedStatus` is set and no longer matches.
 */
export async function writeStatusPageIncidentUpdate(
  tx: Tx,
  existing: Pick<typeof incidents.$inferSelect, "id" | "statusPageId" | "status" | "sourceComponentId">,
  data: UpdateIncidentStatusData,
  userId: string | null,
  expectedStatus?: string,
) {
  const suppresses = data.status === "resolved" && existing.sourceComponentId;
  // Lock the component before the incident, matching reconciliation order (component, then its automatic incident).
  if (suppresses) {
    await tx
      .select({ id: statusPageComponents.id })
      .from(statusPageComponents)
      .where(eq(statusPageComponents.id, existing.sourceComponentId!))
      .for("update");
  }
  if (expectedStatus) {
    const [current] = await tx
      .select({ status: incidents.status })
      .from(incidents)
      .where(eq(incidents.id, existing.id))
      .for("update");
    if (current?.status !== expectedStatus) return null;
  }
  // A manual resolve of an automatically detected incident must not be
  // undone by the next reconciliation tick while the monitor is still down.
  if (suppresses) {
    await tx
      .update(statusPageComponents)
      .set({ autoIncidentSuppressed: true, updatedAt: new Date() })
      .where(eq(statusPageComponents.id, existing.sourceComponentId!));
  }

  const [incident] = await tx
    .update(incidents)
    .set({
      status: data.status,
      updatedAt: new Date(),
      // A follow-up note on an already resolved incident keeps when it ended.
      resolvedAt: data.status === "resolved" ? sql`coalesce(${incidents.resolvedAt}, now())` : null,
      ...(data.status === "monitoring" ? { monitoringAt: new Date() } : {}),
      ...incidentScheduleFields(data.status, data.scheduledFor, data.scheduledUntil, existing.status),
    })
    .where(and(eq(incidents.id, existing.id), eq(incidents.statusPageId, existing.statusPageId)))
    .returning();

  const [update] = await tx
    .insert(incidentUpdates)
    .values({
      incidentId: existing.id,
      createdByUserId: userId,
      body: data.body,
      status: data.status,
      deliverNotifications: data.deliverNotifications,
      displayAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  if (data.deliverNotifications) {
    await tx.insert(statusPageNotificationEvents).values({ incidentId: incident.id, updateId: update.id });
  }

  // Restore follows the reconciliation rules (see restoreResolvedIncidentComponents).
  if (data.status === "resolved" && data.restoreComponentStatus) {
    await restoreResolvedIncidentComponents(tx, existing.id, existing.statusPageId);
  }

  if (data.status === "resolved") await repointSreStatusPageSlot(tx, incident.id);

  return { incident, update };
}

export type UpdateStatusPageIncidentResult =
  | { success: true; message: string; incident: typeof incidents.$inferSelect }
  | { success: false; message: string; forbidden?: boolean };

/**
 * The one path that changes a public incident's status. The status-page action and the SRE incident (timeline post,
 * resolve fan-out) call it, so permission, ownership and the expected-status guard stay in one place.
 * `expectedStatus` is set by callers that decided from a possibly stale read: the update only applies while the
 * incident still has this status, so a late post cannot reopen a resolved incident or overwrite a newer status.
 */
export async function updateStatusPageIncident(
  actor: StatusPageIncidentActor,
  data: UpdateIncidentStatusData,
  options?: { expectedStatus?: string },
): Promise<UpdateStatusPageIncidentResult> {
  const { userId, organizationId, project } = actor;
  try {
    if (!checkPermissionWithContext("status_page", "update", actor)) {
      return { success: false, forbidden: true, message: "Insufficient permissions to update incidents" };
    }
    const validatedData = updateIncidentStatusSchema.parse(data);

    // SECURITY: Verify status page belongs to this organization and project
    const statusPage = await db.query.statusPages.findFirst({
      columns: { id: true },
      where: and(
        eq(statusPages.id, validatedData.statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id),
      ),
    });
    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to update incident for status page ${validatedData.statusPageId} without ownership`,
      );
      return { success: false, message: "Status page not found or access denied" };
    }

    const existingIncident = await db.query.incidents.findFirst({
      where: and(eq(incidents.id, validatedData.incidentId), eq(incidents.statusPageId, validatedData.statusPageId)),
    });
    if (!existingIncident) {
      return { success: false, message: "Incident not found or access denied" };
    }

    const result = await db.transaction((tx) =>
      writeStatusPageIncidentUpdate(tx, existingIncident, validatedData, userId, options?.expectedStatus),
    );
    if (!result) {
      return { success: false, message: "The public incident changed since it was read; refresh and try again" };
    }

    await logAuditEvent({
      userId,
      action: "incident_updated",
      resource: "incident",
      resourceId: result.incident.id,
      metadata: {
        organizationId,
        incidentName: result.incident.name,
        newStatus: validatedData.status,
        statusPageId: validatedData.statusPageId,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

    revalidatePath(`/status-pages/${validatedData.statusPageId}`);
    revalidatePath(`/status-pages/${validatedData.statusPageId}/public`);

    return { success: true, message: "Incident updated successfully", incident: result.incident };
  } catch (error) {
    console.error("Error updating incident status:", error);
    if (error instanceof z.ZodError) {
      return { success: false, message: error.issues[0]?.message || "Invalid data provided" };
    }
    return { success: false, message: "Failed to update incident. Please try again." };
  }
}

/** Open public incidents linked to an SRE incident, only on this project's status pages. */
export async function listOpenLinkedStatusPageIncidents(
  scope: { organizationId: string; projectId: string },
  sreIncidentId: string,
) {
  return db
    .select({
      id: incidents.id,
      statusPageId: incidents.statusPageId,
      statusPageName: statusPages.name,
      status: incidents.status,
      // Null means the column default: notify.
      deliverNotifications: sql<boolean>`coalesce(${incidents.deliverNotifications}, true)`,
    })
    .from(incidents)
    .innerJoin(statusPages, eq(statusPages.id, incidents.statusPageId))
    .where(
      and(
        eq(incidents.sreIncidentId, sreIncidentId),
        eq(statusPages.organizationId, scope.organizationId),
        eq(statusPages.projectId, scope.projectId),
        notInArray(incidents.status, ["resolved", "scheduled"]),
      ),
    )
    .orderBy(incidents.createdAt);
}

export type StatusPagePublishResult = { published: string[]; failed: string[]; forbidden: boolean };

/**
 * Posts an SRE incident's resolution to every open linked public incident, each with its own notify setting.
 * Runs after the SRE resolve committed: a failed post is reported, never rolled back.
 */
export async function publishSreResolutionToStatusPages(
  actor: StatusPageIncidentActor,
  sreIncidentId: string,
  summary: string,
): Promise<StatusPagePublishResult> {
  if (!checkPermissionWithContext("status_page", "update", actor)) return { published: [], failed: [], forbidden: true };
  // The resolve already committed, so a failed lookup is reported as a failed post, never as a failed resolve.
  const rows = await listOpenLinkedStatusPageIncidents({ organizationId: actor.organizationId, projectId: actor.project.id }, sreIncidentId).catch((error) => {
    console.error("Error listing linked status page incidents:", error);
    return null;
  });
  if (!rows) return { published: [], failed: ["the linked status pages"], forbidden: false };
  const result: StatusPagePublishResult = { published: [], failed: [], forbidden: false };
  for (const row of rows) {
    const posted = await updateStatusPageIncident(
      actor,
      {
        incidentId: row.id,
        statusPageId: row.statusPageId,
        status: "resolved",
        body: summary,
        deliverNotifications: row.deliverNotifications,
        restoreComponentStatus: true,
      },
      { expectedStatus: row.status },
    ).catch(() => null);
    (posted?.success ? result.published : result.failed).push(row.statusPageName);
  }
  return result;
}

/** What a resolve published, for the response message; `warning` is set when something was not published. */
export function describeStatusPagePublish(result: StatusPagePublishResult): { note: string; warning?: string } {
  if (result.forbidden) return { note: "", warning: "You cannot post to status pages, so nothing was published." };
  const note = result.published.length ? `Resolution posted to ${result.published.join(", ")}` : "";
  return result.failed.length
    ? { note, warning: `The resolution could not be posted to ${result.failed.join(", ")}. Post it from the status page.` }
    : { note };
}
