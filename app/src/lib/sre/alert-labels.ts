const ALERT_TYPE_LABELS: Record<string, string> = {
  monitor_failure: "Monitor down",
  monitor_recovery: "Recovered",
  job_failed: "Job failed",
  job_success: "Job passed",
  job_timeout: "Job timed out",
  ssl_expiring: "SSL expiring",
};

/** Human label for an alert type, e.g. "monitor_failure" -> "Monitor down". */
export function getAlertTypeLabel(type: string) {
  return (
    ALERT_TYPE_LABELS[type] ??
    type.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
  );
}

/** Incident and alert-event title for an alert, e.g. "Checkout API: Monitor down". */
export function alertIncidentTitle(targetName: string, type: string) {
  const title = `${targetName}: ${getAlertTypeLabel(type)}`;
  return title.length > 500 ? `${title.slice(0, 497)}...` : title;
}
