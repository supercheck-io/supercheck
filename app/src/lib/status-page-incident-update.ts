import { and, eq, inArray, or, sql } from "drizzle-orm";

import { incidentComponents, incidents, incidentUpdates, statusPageComponents, statusPageNotificationEvents } from "@/db/schema";
import { incidentScheduleFields } from "@/lib/incident-schedule";
import { repointSreStatusPageSlot, restoreResolvedIncidentComponents } from "@/lib/status-page-reconciliation";
import type { UpdateIncidentStatusData } from "@/lib/validations/incident-status";
import type { db } from "@/utils/db";

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
  // Lock every component this resolve may write before the incident, matching reconciliation order (components, then
  // incidents: automatic incidents and maintenance windows), so the two cannot deadlock.
  if (data.status === "resolved" && (suppresses || data.restoreComponentStatus)) {
    await tx
      .select({ id: statusPageComponents.id })
      .from(statusPageComponents)
      .where(
        or(
          existing.sourceComponentId ? eq(statusPageComponents.id, existing.sourceComponentId) : undefined,
          data.restoreComponentStatus
            ? inArray(statusPageComponents.id, tx.select({ id: incidentComponents.componentId }).from(incidentComponents).where(eq(incidentComponents.incidentId, existing.id)))
            : undefined,
        ),
      )
      .orderBy(statusPageComponents.id)
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
