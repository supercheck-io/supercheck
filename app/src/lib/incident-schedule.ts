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
  previousStatus?: string,
): { scheduledFor?: Date | null; scheduledUntil?: Date | null } {
  if (status === "scheduled") {
    return { scheduledFor, scheduledUntil };
  }

  // Reopening a resolved incident must not carry its old window back in, or the reconciler ends it again.
  if (status === "monitoring" && previousStatus === "resolved") {
    return { scheduledFor: null, scheduledUntil: null };
  }

  // Monitoring keeps the window in progress; resolved keeps it as the record of when maintenance ran (resolved
  // incidents are never treated as active, and the uptime history needs the window).
  if (status === "monitoring" || status === "resolved") {
    return {};
  }

  return { scheduledFor: null, scheduledUntil: null };
}

/** The status page's time zone, or UTC when it is unset or not a zone Intl knows (it would throw). */
export function statusPageTimeZone(timeZone?: string | null): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * "Jan 5, 2030, 02:00 UTC – Jan 5, 2030, 04:00 UTC", in the status page's time zone (as its emails use) with the
 * zone named; a fixed zone keeps server and client renders identical.
 */
export function formatMaintenanceWindow(
  locale: string,
  scheduledFor: Date | string,
  scheduledUntil: Date | string,
  timeZone?: string | null,
): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: statusPageTimeZone(timeZone),
    timeZoneName: "short",
  });
  return `${fmt.format(new Date(scheduledFor))} – ${fmt.format(new Date(scheduledUntil))}`;
}
