import { sql } from "drizzle-orm";

import { isIncidentPagingSuppressed } from "@/lib/maintenance/predicate";
import { db } from "@/utils/db";

/**
 * True while maintenance holds this incident's pages (reminders and escalation wait, and resume after): an
 * automatically opened incident with a monitor under a maintenance window or a status-page scheduled maintenance.
 * The first hold since the incident last paged writes one `paging_suppressed_maintenance` timeline row, so the
 * timeline says why nobody was reminded.
 */
export async function incidentHeldForMaintenance(incidentId: string, at = new Date()): Promise<boolean> {
  if (!(await isIncidentPagingSuppressed(incidentId, at))) return false;
  await db
    .execute(sql`
      INSERT INTO sre_incident_timeline_events (id, incident_id, event_type, event_data, actor_type, created_at)
      SELECT uuidv7(), ${incidentId}::uuid, 'state_change', '{"state":"paging_suppressed_maintenance"}'::jsonb, 'system', ${at.toISOString()}::timestamptz
      WHERE NOT EXISTS (
        SELECT 1 FROM sre_incident_timeline_events s
        WHERE s.incident_id = ${incidentId}::uuid AND s.event_type = 'state_change' AND s.event_data->>'state' = 'paging_suppressed_maintenance'
          AND NOT EXISTS (
            SELECT 1 FROM sre_incident_timeline_events n
            WHERE n.incident_id = s.incident_id AND n.event_type = 'notification' AND n.created_at > s.created_at
          )
      )
    `)
    // The note is a courtesy; the hold itself must not fail with it.
    .catch(() => undefined);
  return true;
}
