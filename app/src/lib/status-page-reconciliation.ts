import { and, desc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import {
  statusPageComponents,
  statusPages,
  incidents,
  incidentUpdates,
  incidentComponents,
  statusPageNotificationEvents,
  sreIncidents,
  sreIncidentAlerts,
  sreAlertEvents,
} from "@/db/schema";
import {
  statusAggregationService,
  type ComponentStatus,
  type AggregationMethod,
} from "./status-aggregation.service";
import {
  formatSystemMessage,
  getSystemMessages,
} from "./status-page-system-messages";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Link an automatic status-page incident to the open SRE incident that was
 * triggered by one of the component's monitors.
 */
export async function linkOpenSreIncident(
  tx: Tx,
  args: {
    statusPageIncidentId: string;
    organizationId: string;
    projectId: string | null;
    monitorIds: string[];
  },
) {
  // No project means no safe scope for the match; skip linking.
  if (!args.monitorIds.length || !args.projectId) return null;
  const [match] = await tx
    .select({ id: sreIncidents.id })
    .from(sreIncidents)
    .innerJoin(sreIncidentAlerts, eq(sreIncidentAlerts.incidentId, sreIncidents.id))
    .innerJoin(sreAlertEvents, eq(sreAlertEvents.id, sreIncidentAlerts.alertEventId))
    .where(
      and(
        eq(sreIncidents.organizationId, args.organizationId),
        eq(sreIncidents.projectId, args.projectId),
        ne(sreIncidents.status, "resolved"),
        eq(sreIncidentAlerts.role, "trigger"),
        eq(sreAlertEvents.sourceType, "monitor"),
        inArray(sreAlertEvents.sourceId, args.monitorIds),
      ),
    )
    .orderBy(desc(sreIncidents.createdAt))
    .limit(1);
  if (!match) return null;
  await tx
    .update(incidents)
    .set({ sreIncidentId: match.id })
    .where(eq(incidents.id, args.statusPageIncidentId));
  // sre_incidents.status_page_incident_id is a single slot: the first status-page
  // incident linked wins; later ones keep only their own sreIncidentId.
  await tx
    .update(sreIncidents)
    .set({ statusPageIncidentId: args.statusPageIncidentId })
    .where(
      and(eq(sreIncidents.id, match.id), isNull(sreIncidents.statusPageIncidentId)),
    );
  return match.id;
}

export async function reconcileStatusPages() {
  // A transaction lock makes the singleton tick safe across app replicas and retries.
  await db.transaction(async (tx) => {
    const lock = await tx.execute(
      sql`select pg_try_advisory_xact_lock(73194722) as acquired`,
    );
    if (!lock[0]?.acquired) return;
    // Only rows that are due to start or end; the checks below stay authoritative.
    const dueAt = new Date();
    const scheduled = await tx.query.incidents.findMany({
      where: and(
        inArray(incidents.status, ["scheduled", "monitoring"]),
        or(
          and(eq(incidents.status, "scheduled"), lte(incidents.scheduledFor, dueAt)),
          lte(incidents.scheduledUntil, dueAt),
        ),
      ),
    });
    for (const incident of scheduled) {
      const now = new Date();
      const starting =
        incident.status === "scheduled" &&
        incident.scheduledAutoInProgress &&
        incident.scheduledFor &&
        incident.scheduledFor <= now;
      const ending =
        (incident.status === "monitoring" || incident.status === "scheduled") &&
        incident.scheduledAutoCompleted &&
        incident.scheduledUntil &&
        incident.scheduledUntil <= now;
      if (!starting && !ending) continue;
      const affected = await tx.query.incidentComponents.findMany({
        where: eq(incidentComponents.incidentId, incident.id),
      });
      for (const link of affected) {
        if (starting && !ending && incident.autoTransitionToMaintenanceState) {
          const component = await tx.query.statusPageComponents.findFirst({ where: eq(statusPageComponents.id, link.componentId) });
          if (component?.status !== "under_maintenance") await tx.update(incidentComponents).set({ oldStatus: component?.status ?? "operational" }).where(eq(incidentComponents.id, link.id));
          await tx.update(statusPageComponents).set({ status: "under_maintenance", updatedAt: now }).where(eq(statusPageComponents.id, link.componentId));
        }
        if (ending && incident.status === "monitoring" && incident.autoTransitionToOperationalState) await tx.update(statusPageComponents).set({ status: (link.oldStatus as ComponentStatus) || "operational", updatedAt: now }).where(and(eq(statusPageComponents.id, link.componentId), eq(statusPageComponents.status, "under_maintenance")));
      }
      const status = ending ? ("resolved" as const) : ("monitoring" as const);
      await tx
        .update(incidents)
        .set({ status, updatedAt: now, resolvedAt: ending ? now : null })
        .where(eq(incidents.id, incident.id));
      const maintenancePage = await tx.query.statusPages.findFirst({
        where: eq(statusPages.id, incident.statusPageId),
      });
      const messages = getSystemMessages(maintenancePage?.language ?? "en");
      const [update] = await tx
        .insert(incidentUpdates)
        .values({
          incidentId: incident.id,
          status,
          body: ending
            ? messages.maintenanceEndBody
            : messages.maintenanceStartBody,
          deliverNotifications: ending
            ? incident.autoTransitionDeliverNotificationsAtEnd
            : incident.autoTransitionDeliverNotificationsAtStart,
          displayAt: now,
        })
        .returning();
      if (update.deliverNotifications)
        await tx
          .insert(statusPageNotificationEvents)
          .values({ incidentId: incident.id, updateId: update.id });
    }
    const reconciledAt = new Date();
    const components = await tx.query.statusPageComponents.findMany({
      where: sql`${statusPageComponents.lastReconciledAt} is null or ${statusPageComponents.updatedAt} >= ${statusPageComponents.lastReconciledAt} or exists (
        select 1 from status_page_component_monitors association join monitors monitor on monitor.id = association.monitor_id
        where association.component_id = ${statusPageComponents.id} and (monitor.last_check_at >= ${statusPageComponents.lastReconciledAt} or monitor.updated_at >= ${statusPageComponents.lastReconciledAt})
      ) or exists (
        select 1 from incident_components association join incidents incident on incident.id = association.incident_id
        where association.component_id = ${statusPageComponents.id} and incident.updated_at >= ${statusPageComponents.lastReconciledAt}
      )`,
      orderBy: sql`${statusPageComponents.lastReconciledAt} asc nulls first, ${statusPageComponents.id}`,
      limit: 1000,
      with: { monitors: { with: { monitor: true } } },
    });
    for (const component of components) {
      // Components without linked checks retain their manual status.

      // Lock the component row and re-read the suppression flag. The manual
      // resolve action updates this same row; without the fresh read, the batch
      // snapshot can still say "not suppressed" and recreate the incident the
      // action just resolved.
      const [lockedComponent] = await tx
        .update(statusPageComponents)
        .set({ lastReconciledAt: reconciledAt })
        .where(eq(statusPageComponents.id, component.id))
        .returning({
          autoIncidentSuppressed: statusPageComponents.autoIncidentSuppressed,
        });
      const page = await tx.query.statusPages.findFirst({
        where: eq(statusPages.id, component.statusPageId),
      });
      const messages = getSystemMessages(page?.language ?? "en");
      const active = await tx
        .select({ incident: incidents, link: incidentComponents })
        .from(incidentComponents)
        .innerJoin(incidents, eq(incidents.id, incidentComponents.incidentId))
        .where(
          and(
            eq(incidentComponents.componentId, component.id),
            ne(incidents.status, "resolved"),
            ne(incidents.status, "scheduled"),
          ),
        );
      const severity: ComponentStatus[] = [
        "major_outage",
        "partial_outage",
        "degraded_performance",
        "under_maintenance",
        "operational",
      ];
      const manualStatuses = active
        .filter((entry) => entry.incident.sourceComponentId !== component.id)
        .map((entry) =>
          entry.incident.scheduledFor
            ? "under_maintenance"
            : entry.link.newStatus,
        );
      const manualStatus = severity.find((status) =>
        manualStatuses.includes(status),
      );
      const manual = manualStatuses.length > 0;
      const calculated = statusAggregationService.calculateFromMonitors(
        component.monitors.map((association) => ({
          status: association.monitor.status,
          weight: association.weight,
        })),
        component.aggregationMethod as AggregationMethod,
        component.failureThreshold,
      );
      const status =
        manualStatus ??
        (component.monitors.length ? calculated : component.status);
      if (status !== component.status)
        await tx
          .update(statusPageComponents)
          .set({ status, updatedAt: new Date() })
          .where(eq(statusPageComponents.id, component.id));
      // A manual resolve suppresses automatic incidents until the component
      // has actually recovered, so the next failing tick does not recreate it.
      const wasSuppressed =
        lockedComponent?.autoIncidentSuppressed ??
        component.autoIncidentSuppressed;
      const suppressed = wasSuppressed && status !== "operational";
      if (wasSuppressed && !suppressed)
        await tx
          .update(statusPageComponents)
          .set({ autoIncidentSuppressed: false, updatedAt: new Date() })
          .where(eq(statusPageComponents.id, component.id));
      const automatic = active.find(
        (entry) => entry.incident.sourceComponentId === component.id,
      )?.incident;
      const failing = component.monitors.some((association) => ["down", "error", "timeout"].includes(association.monitor.status)) && [
        "major_outage",
        "partial_outage",
        "degraded_performance",
      ].includes(calculated);
      if (
        failing &&
        !automatic &&
        !manual &&
        !suppressed &&
        component.autoCreateIncidents &&
        component.showcase &&
        page?.status === "published"
      ) {
        const [incident] = await tx
          .insert(incidents)
          .values({
            statusPageId: component.statusPageId,
            sourceComponentId: component.id,
            name: formatSystemMessage(messages.autoOutageTitle, {
              component: component.name,
            }),
            status: "investigating",
            impact: "major",
            body: messages.autoOutageBody,
            deliverNotifications: true,
          })
          .returning();
        if (page) {
          await linkOpenSreIncident(tx, {
            statusPageIncidentId: incident.id,
            organizationId: page.organizationId,
            projectId: page.projectId,
            monitorIds: component.monitors.map((association) => association.monitorId),
          });
        }
        await tx
          .insert(incidentComponents)
          .values({
            incidentId: incident.id,
            componentId: component.id,
            oldStatus: component.status,
            newStatus: calculated,
          });
        const [update] = await tx
          .insert(incidentUpdates)
          .values({
            incidentId: incident.id,
            status: "investigating",
            body: incident.body!,
            deliverNotifications: true,
            displayAt: new Date(),
          })
          .returning();
        await tx
          .insert(statusPageNotificationEvents)
          .values({
            incidentId: incident.id,
            updateId: update.id,
            isCreation: true,
          });
      } else if (!failing && automatic && calculated === "operational") {
        await tx
          .update(incidents)
          .set({
            status: "resolved",
            resolvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(incidents.id, automatic.id));
        const [update] = await tx
          .insert(incidentUpdates)
          .values({
            incidentId: automatic.id,
            status: "resolved",
            body: messages.recoveryBody,
            deliverNotifications: true,
            displayAt: new Date(),
          })
          .returning();
        await tx
          .insert(statusPageNotificationEvents)
          .values({ incidentId: automatic.id, updateId: update.id });
      }
    }
  });
}
