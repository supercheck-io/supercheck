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
const isSynthetic = sql`COALESCE(${monitorResults.details}->>'synthetic', '') = 'true'`;

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
