import { sql } from "drizzle-orm";

import { sreAlertEvents, sreIncidentAlerts } from "@/db/schema";

/**
 * Alert fields as they were when the alert was linked to the incident. Links made
 * before the snapshot columns existed fall back to the shared alert event row,
 * which later failures of the same source overwrite.
 */
export const linkedAlertFields = {
  title: sql<string>`coalesce(${sreIncidentAlerts.alertTitle}, ${sreAlertEvents.title})`,
  description: sql<string | null>`coalesce(${sreIncidentAlerts.alertDescription}, ${sreAlertEvents.description})`,
  severity: sql<"sev1" | "sev2" | "sev3" | "sev4">`coalesce(${sreIncidentAlerts.alertSeverity}, ${sreAlertEvents.severity})`,
  firedAt: sql<Date>`coalesce(${sreIncidentAlerts.alertFiredAt}, ${sreAlertEvents.firedAt})`.mapWith(sreAlertEvents.firedAt),
};
