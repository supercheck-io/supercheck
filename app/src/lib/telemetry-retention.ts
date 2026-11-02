// Age-based purge of operational telemetry. Rows that carry user-visible history
// (incident timeline, chat messages) are deliberately absent: they go with their parent via cascades.
// Each rule carries its own protection predicate so a purge can never remove the row the UI still reads.

export interface TelemetryRetentionRule {
  table: string;
  /** Column compared against the cutoff (indexed). */
  timeColumn: string;
  envVar: string;
  defaultDays: number;
  /** Extra predicate over alias `x`; only rows satisfying it are deleted. */
  protect?: string;
}

export const TELEMETRY_RETENTION_RULES: readonly TelemetryRetentionRule[] = [
  {
    table: "private_agent_heartbeats",
    timeColumn: "created_at",
    envVar: "PRIVATE_AGENT_HEARTBEAT_RETENTION_DAYS",
    defaultDays: 7,
    // Always keep each agent's newest heartbeat so "last seen" survives an idle agent.
    protect: `EXISTS (SELECT 1 FROM private_agent_heartbeats n WHERE n.private_agent_id = x.private_agent_id AND (n.created_at, n.id) > (x.created_at, x.id))`,
  },
  {
    table: "sre_service_health_snapshots",
    timeColumn: "window_end",
    envVar: "SRE_HEALTH_SNAPSHOT_RETENTION_DAYS",
    defaultDays: 90,
    // The service views read the latest snapshot per service.
    protect: `EXISTS (SELECT 1 FROM sre_service_health_snapshots n WHERE n.service_id = x.service_id AND (n.window_end, n.id) > (x.window_end, x.id))`,
  },
  {
    table: "sre_service_dependency_observations",
    timeColumn: "observed_at",
    envVar: "SRE_DEPENDENCY_OBSERVATION_RETENTION_DAYS",
    defaultDays: 90,
  },
  {
    table: "sre_alert_events",
    timeColumn: "fired_at",
    envVar: "SRE_ALERT_EVENT_RETENTION_DAYS",
    defaultDays: 90,
    // Linked events are part of an incident's history (the link row cascades from the event).
    protect: `x.status <> 'firing' AND NOT EXISTS (SELECT 1 FROM sre_incident_alerts a WHERE a.alert_event_id = x.id)`,
  },
  {
    // Outbox events; their deliveries cascade. Shares the delivery retention setting.
    table: "status_page_notification_events",
    timeColumn: "created_at",
    envVar: "STATUS_PAGE_DELIVERY_RETENTION_DAYS",
    defaultDays: 30,
    protect: `x.expanded_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM status_page_notification_deliveries d WHERE d.event_id = x.id AND d.status NOT IN ('delivered', 'failed', 'skipped'))`,
  },
];

/** Positive integer days from env; anything else falls back so a typo never deletes more than intended. */
export function resolveRetentionDays(
  rule: TelemetryRetentionRule,
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env[rule.envVar]);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 3650
    ? parsed
    : rule.defaultDays;
}

/** Runs one statement and returns the affected row count. */
export type CountingRunner = (statement: string) => Promise<number>;

export function buildPurgeBatchSql(
  rule: TelemetryRetentionRule,
  days: number,
  batchSize: number,
): string {
  if (!Number.isInteger(days) || !Number.isInteger(batchSize) || days < 1 || batchSize < 1)
    throw new Error("days and batchSize must be positive integers");
  // localtimestamp matches the DEFAULT now() these timestamp columns are written with.
  return `DELETE FROM ${rule.table} WHERE id IN (SELECT x.id FROM ${rule.table} x WHERE x.${rule.timeColumn} < localtimestamp - make_interval(days => ${days})${rule.protect ? ` AND ${rule.protect}` : ""} LIMIT ${batchSize})`;
}

/** Deletes in bounded batches until nothing is eligible or `maxRecords` is reached. */
export async function purgeTelemetryTable(
  run: CountingRunner,
  rule: TelemetryRetentionRule,
  opts: { days?: number; batchSize: number; maxRecords: number; pauseMs?: number },
): Promise<number> {
  const days = opts.days ?? resolveRetentionDays(rule);
  let total = 0;
  while (total < opts.maxRecords) {
    const deleted = await run(
      buildPurgeBatchSql(rule, days, Math.min(opts.batchSize, opts.maxRecords - total)),
    );
    total += deleted;
    if (deleted < opts.batchSize) break;
    if (opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs));
  }
  return total;
}
