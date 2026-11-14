import { and, eq, gt, lte, ne } from "drizzle-orm";

import { incidentComponents, sreAlertEvents, sreIncidentAlerts, statusPageComponentMonitors, incidents as statusPageIncidents } from "@/db/schema";
import { db } from "@/utils/db";

/**
 * True while a scheduled maintenance holds this incident's pages (reminders and escalation wait, and resume after).
 * Today: the incident was opened by a monitor that an unresolved, in-window status-page maintenance covers (the same
 * joins as the worker's isUnderScheduledMaintenance). Maintenance windows extend this one function.
 */
export async function incidentHeldForMaintenance(incidentId: string, at = new Date()): Promise<boolean> {
  const rows = await db
    .select({ id: statusPageIncidents.id })
    .from(sreIncidentAlerts)
    .innerJoin(sreAlertEvents, eq(sreAlertEvents.id, sreIncidentAlerts.alertEventId))
    .innerJoin(statusPageComponentMonitors, eq(statusPageComponentMonitors.monitorId, sreAlertEvents.sourceId))
    .innerJoin(incidentComponents, eq(incidentComponents.componentId, statusPageComponentMonitors.componentId))
    .innerJoin(statusPageIncidents, eq(statusPageIncidents.id, incidentComponents.incidentId))
    .where(
      and(
        eq(sreIncidentAlerts.incidentId, incidentId),
        eq(sreIncidentAlerts.role, "trigger"),
        eq(sreAlertEvents.sourceType, "monitor"),
        ne(statusPageIncidents.status, "resolved"),
        lte(statusPageIncidents.scheduledFor, at),
        gt(statusPageIncidents.scheduledUntil, at),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
