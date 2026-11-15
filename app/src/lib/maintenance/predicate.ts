import { sql, type SQL } from "drizzle-orm";

import { db } from "@/utils/db";

type Executor = Pick<typeof db, "execute">;

/**
 * SQL that is true while a maintenance window, or a status-page scheduled maintenance, covers the monitor whose id
 * `monitorId` names at `at`. Windows match on their stored current occurrence only and never after its end. Same
 * rule as worker/src/monitor/maintenance.ts: keep them in step.
 */
export function monitorInMaintenanceSql(monitorId: SQL, at: Date): SQL {
  const iso = at.toISOString();
  return sql`(
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
  )`;
}

function firstFlag(result: unknown): boolean {
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ?? [];
  return (rows[0] as { held?: boolean } | undefined)?.held === true;
}

export async function isMonitorInMaintenance(monitorId: string, at: Date, executor: Executor = db): Promise<boolean> {
  return firstFlag(await executor.execute(sql`SELECT ${monitorInMaintenanceSql(sql`${monitorId}::uuid`, at)} AS held`));
}

/**
 * True while an automatically opened incident (one with a trigger alert) has any monitor in maintenance: a monitor
 * behind its alerts, a monitor listed as affected, or a monitor mapped to its primary or an affected service.
 * A declared incident has no trigger alert and is never held: a person opened it, so it pages.
 */
export async function isIncidentPagingSuppressed(incidentId: string, at: Date, executor: Executor = db): Promise<boolean> {
  const result = await executor.execute(sql`
    WITH inc AS (SELECT id, primary_service_id FROM sre_incidents WHERE id = ${incidentId}::uuid),
    mons AS (
      SELECT e.source_id AS monitor_id FROM sre_incident_alerts a
        JOIN sre_alert_events e ON e.id = a.alert_event_id AND e.source_type = 'monitor'
        WHERE a.incident_id = ${incidentId}::uuid AND a.role IN ('trigger', 'related')
      UNION SELECT r.resource_id FROM sre_incident_resources r
        WHERE r.incident_id = ${incidentId}::uuid AND r.resource_type = 'monitor'
      UNION SELECT sr.resource_id FROM sre_service_resources sr
        WHERE sr.resource_type = 'monitor' AND (
          sr.service_id IN (SELECT primary_service_id FROM inc)
          OR sr.service_id IN (SELECT r.resource_id FROM sre_incident_resources r WHERE r.incident_id = ${incidentId}::uuid AND r.resource_type = 'service')
        )
    )
    SELECT (
      EXISTS (SELECT 1 FROM sre_incident_alerts WHERE incident_id = ${incidentId}::uuid AND role = 'trigger')
      AND EXISTS (SELECT 1 FROM mons WHERE ${monitorInMaintenanceSql(sql`mons.monitor_id`, at)})
    ) AS held
  `);
  return firstFlag(result);
}
