import { sql } from "drizzle-orm";
import { monitorResults } from "@/db/schema";

/**
 * Missing-cycle closure writes one synthetic failed row per silent region
 * (`details.synthetic = true`, no response time). A region that reports after the
 * deadline still saves its real result, so the same (cycle, location) can hold both.
 *
 * Counters must treat that check once: the real result replaces the synthetic row.
 * The COALESCE keeps rows without details (all pre-existing data) included instead of
 * letting SQL's three-valued logic drop them.
 */
// Synthetic rows are always failed and unmeasured. Testing those cheap columns first keeps the
// jsonb `details` untouched (no detoasting) for the overwhelming majority of rows.
const isSynthetic = sql`(
  ${monitorResults.isUp} IS NOT TRUE AND ${monitorResults.responseTimeMs} IS NULL
  AND COALESCE(${monitorResults.details}->>'synthetic', '') = 'true'
)`;

export const excludeSupersededSyntheticResults = sql`NOT (
  ${isSynthetic} AND EXISTS (
    SELECT 1 FROM monitor_results sibling
    WHERE sibling.monitor_id = ${monitorResults.monitorId}
      AND sibling.execution_group_id = ${monitorResults.executionGroupId}
      AND sibling.location = ${monitorResults.location}
      AND sibling.id <> ${monitorResults.id}
      AND COALESCE(sibling.details->>'synthetic', '') <> 'true'
  )
)`;

/** For latency and execution-time figures: a synthetic row has no measurement at all. */
export const excludeSyntheticResults = sql`NOT ${isSynthetic}`;

/**
 * For uptime: checks inside a maintenance window are left out of both the numerator and the denominator. The
 * rows stay for the results table and charts, which show them as maintenance. A multi-region cycle with any region
 * inside a window is left out whole: dropping only some regions would count the cycle short of its regions, as down.
 */
export const excludeMaintenanceResults = sql`(${monitorResults.inMaintenance} IS NOT TRUE AND NOT (
  ${monitorResults.executionGroupId} IS NOT NULL AND EXISTS (
    SELECT 1 FROM monitor_results muted
    WHERE muted.monitor_id = ${monitorResults.monitorId}
      AND muted.execution_group_id = ${monitorResults.executionGroupId}
      AND muted.in_maintenance
  )
))`;

/** Uptime counts: one row per check (superseded synthetic rows dropped) and nothing checked during maintenance. */
export const uptimeResults = sql`(${excludeSupersededSyntheticResults} AND ${excludeMaintenanceResults})`;
