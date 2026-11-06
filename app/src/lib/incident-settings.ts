/**
 * Whether a monitor's alert settings open incidents. With alerts on, incidents are the default and
 * `incidentEnabled: false` opts out; with alerts off they are opt-in (`incidentEnabled: true`), so
 * existing monitors with alerts off never start opening incidents on their own.
 * Keep in sync with incidentsActive in worker/src/monitor/monitor-evaluator.ts.
 */
export function incidentsEnabled(
  alertConfig: { enabled?: boolean; incidentEnabled?: boolean } | null | undefined,
): boolean {
  return alertConfig?.enabled
    ? alertConfig.incidentEnabled !== false
    : alertConfig?.incidentEnabled === true;
}
