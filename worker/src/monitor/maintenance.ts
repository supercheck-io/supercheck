import { sql } from 'drizzle-orm';

type Executor = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

/**
 * True while a maintenance window or a status-page scheduled maintenance covers the monitor at `at`.
 * Windows are matched on their stored current occurrence only (the app moves occurrences forward), and
 * never after `occurrence_ends_at`, so an app outage never mutes past a window's end. A service-scoped
 * window covers monitors mapped to the service at check time. Same SQL as the app's
 * lib/maintenance/predicate.ts: keep them in step.
 */
export async function isMonitorInMaintenance(
  db: Executor,
  monitorId: string,
  at: Date,
): Promise<boolean> {
  const iso = at.toISOString();
  const result = await db.execute(sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM maintenance_windows w
        JOIN monitors m ON m.project_id = w.project_id AND m.organization_id = w.organization_id
        WHERE m.id = ${monitorId}
          AND w.cancelled_at IS NULL AND w.completed_at IS NULL
          AND w.occurrence_starts_at <= ${iso}::timestamptz AND w.occurrence_ends_at > ${iso}::timestamptz
          AND (
            w.scope = 'project'
            OR EXISTS (SELECT 1 FROM maintenance_window_targets t
              WHERE t.window_id = w.id AND t.target_type = 'monitor' AND t.target_id = m.id)
            OR EXISTS (SELECT 1 FROM maintenance_window_targets t
              JOIN sre_service_resources r ON r.service_id = t.target_id AND r.resource_type = 'monitor' AND r.resource_id = m.id
              WHERE t.window_id = w.id AND t.target_type = 'service')
          )
      )
      OR EXISTS (
        SELECT 1 FROM status_page_component_monitors scm
        JOIN incident_components ic ON ic.component_id = scm.component_id
        JOIN incidents i ON i.id = ic.incident_id
        WHERE scm.monitor_id = ${monitorId} AND i.status <> 'resolved'
          AND i.scheduled_for <= ${iso}::timestamptz AND i.scheduled_until > ${iso}::timestamptz
      )
    ) AS in_maintenance
  `);
  const rows =
    (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ??
    [];
  return (
    (rows[0] as { in_maintenance?: boolean } | undefined)?.in_maintenance ===
    true
  );
}
