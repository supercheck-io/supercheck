/**
 * Whether a monitor's alert settings open incidents. With alerts on, incidents are the default and
 * `incidentEnabled: false` opts out; with alerts off they are opt-in (`incidentEnabled: true`), so
 * existing monitors with alerts off never start opening incidents on their own.
 * Keep in sync with incidentsActive in worker/src/monitor/monitor-evaluator.ts.
 */
/**
 * A monitor may have no notification channel only when something still happens on failure: it opens
 * incidents, and either alerts are off (incident-only) or failure alerts are on. SSL-only alerts need a channel.
 */
export function channelsOptional(
  alertConfig: { enabled?: boolean; incidentEnabled?: boolean; alertOnFailure?: boolean } | null | undefined,
): boolean {
  return incidentsEnabled(alertConfig) && (!alertConfig?.enabled || alertConfig.alertOnFailure !== false);
}

export function incidentsEnabled(
  alertConfig: { enabled?: boolean; incidentEnabled?: boolean } | null | undefined,
): boolean {
  return alertConfig?.enabled
    ? alertConfig.incidentEnabled !== false
    : alertConfig?.incidentEnabled === true;
}
