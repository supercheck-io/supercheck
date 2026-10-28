export type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved"
  | "scheduled";

/**
 * Fields that carry a maintenance window on an incident.
 *
 * The window is set when an incident is scheduled and must survive the
 * scheduled -> monitoring transition, where the component is under maintenance
 * until `scheduledUntil`. Any other transition clears it, otherwise the
 * reconciler keeps treating a stale window as active and forces the component
 * into under_maintenance.
 */
export function incidentScheduleFields(
  status: IncidentStatus,
  scheduledFor?: Date,
  scheduledUntil?: Date,
): { scheduledFor?: Date | null; scheduledUntil?: Date | null } {
  if (status === "scheduled") {
    return { scheduledFor, scheduledUntil };
  }

  if (status === "monitoring") {
    return {};
  }

  return { scheduledFor: null, scheduledUntil: null };
}

/** "Jan 5, 2030, 02:00 UTC – Jan 5, 2030, 04:00 UTC"; UTC keeps server and client renders identical. */
export function formatMaintenanceWindow(
  locale: string,
  scheduledFor: Date | string,
  scheduledUntil: Date | string,
): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
  return `${fmt.format(new Date(scheduledFor))} – ${fmt.format(new Date(scheduledUntil))}`;
}
