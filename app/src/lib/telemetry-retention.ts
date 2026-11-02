// Age-based purge of operational telemetry. Rows that carry user-visible history
// (incident timeline, chat messages) are deliberately absent: they go with their parent via cascades.
// Each rule carries its own protection predicate so a purge can never remove the row the UI still reads.

export interface TelemetryRetentionRule {
  table: string;
  /** Column compared against the cutoff (indexed). */
  timeColumn: string;
  envVar: string;
  defaultDays: number;
  /** Extra predicate written over alias `{a}`; only rows satisfying it are deleted. */
  protect?: string;
  /** Floor for the per-run row cap, for tables that grow faster than the shared limit. */
  minSafetyLimit?: number;
}

export const TELEMETRY_RETENTION_RULES: readonly TelemetryRetentionRule[] = [
  {
    table: "private_agent_heartbeats",
    timeColumn: "created_at",
    envVar: "PRIVATE_AGENT_HEARTBEAT_RETENTION_DAYS",
    defaultDays: 7,
    minSafetyLimit: 2_000_000, // 2,880 rows per agent per day at one heartbeat every 30s
    // Always keep each agent's newest heartbeat so "last seen" survives an idle agent.
    protect: `EXISTS (SELECT 1 FROM private_agent_heartbeats n WHERE n.private_agent_id = {a}.private_agent_id AND (n.created_at, n.id) > ({a}.created_at, {a}.id))`,
  },
  {
    table: "sre_service_health_snapshots",
    timeColumn: "window_end",
    envVar: "SRE_HEALTH_SNAPSHOT_RETENTION_DAYS",
    defaultDays: 90,
    // The service views read the latest snapshot per service.
    protect: `EXISTS (SELECT 1 FROM sre_service_health_snapshots n WHERE n.service_id = {a}.service_id AND (n.window_end, n.id) > ({a}.window_end, {a}.id))`,
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
    protect: `{a}.status <> 'firing' AND NOT EXISTS (SELECT 1 FROM sre_incident_alerts a WHERE a.alert_event_id = {a}.id)`,
  },
  {
    // Outbox events; their deliveries cascade. Shares the delivery retention setting.
    table: "status_page_notification_events",
    timeColumn: "created_at",
    envVar: "STATUS_PAGE_DELIVERY_RETENTION_DAYS",
    defaultDays: 30,
    protect: `{a}.expanded_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM status_page_notification_deliveries d WHERE d.event_id = {a}.id AND d.status NOT IN ('delivered', 'failed', 'skipped'))`,
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

/** Integer in [min, max] from a raw value; anything else (NaN, negative, too large) falls back with a warning. */
export function clampInt(
  raw: string | number | undefined,
  { min, max, fallback, name }: { min: number; max: number; fallback: number; name: string },
): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= min && n <= max) return n;
  console.warn(`[DATA_LIFECYCLE] ${name}=${raw} is outside ${min}..${max}; using ${fallback}`);
  return fallback;
}

export const resolveBatchSize = (raw?: string | number) =>
  clampInt(raw, { min: 1, max: 10_000, fallback: 1000, name: "TELEMETRY_RETENTION_BATCH_SIZE" });
export const resolveSafetyLimit = (raw?: string | number) =>
  clampInt(raw, { min: 1, max: 100_000_000, fallback: 200_000, name: "TELEMETRY_RETENTION_SAFETY_LIMIT" });

export type Row = Record<string, unknown>;
/** Runs one statement and returns its rows. */
export type Runner = (statement: string) => Promise<Row[]>;

const cutoff = (days: number) =>
  `localtimestamp - make_interval(days => ${days})`; // matches the DEFAULT now() these timestamp columns use
const protectFor = (rule: TelemetryRetentionRule, alias: string) =>
  rule.protect ? ` AND ${rule.protect.replaceAll("{a}", alias)}` : "";

export interface Cursor {
  time: string;
  id: string;
}

function assertPositive(...n: number[]) {
  if (n.some((v) => !Number.isInteger(v) || v < 1))
    throw new Error("days and batchSize must be positive integers");
}

/**
 * One batch: lock up to `batchSize` eligible rows past the cursor (SKIP LOCKED, so rows an ingest
 * transaction holds are left alone), then delete them re-checking the predicates under the lock.
 * Returns how many rows were picked, deleted and the last picked (time, id) for keyset paging.
 */
export function buildPurgeBatchSql(
  rule: TelemetryRetentionRule,
  days: number,
  batchSize: number,
  cursor?: Cursor,
): string {
  assertPositive(days, batchSize);
  if (cursor && !(/^[0-9: .+-]+$/.test(cursor.time) && /^[0-9a-f-]{36}$/.test(cursor.id)))
    throw new Error("invalid cursor");
  const t = rule.timeColumn;
  const after = cursor ? ` AND (y.${t}, y.id) > ('${cursor.time}'::timestamp, '${cursor.id}'::uuid)` : "";
  return `WITH picked AS (SELECT y.id, y.${t} AS t FROM ${rule.table} y WHERE y.${t} < ${cutoff(days)}${after}${protectFor(rule, "y")} ORDER BY y.${t}, y.id LIMIT ${batchSize} FOR UPDATE SKIP LOCKED), del AS (DELETE FROM ${rule.table} z WHERE z.id IN (SELECT id FROM picked) AND z.${t} < ${cutoff(days)}${protectFor(rule, "z")} RETURNING z.id) SELECT (SELECT count(*) FROM picked)::int AS picked, (SELECT count(*) FROM del)::int AS deleted, (SELECT t::text FROM picked ORDER BY t DESC, id DESC LIMIT 1) AS last_time, (SELECT id::text FROM picked ORDER BY t DESC, id DESC LIMIT 1) AS last_id`;
}

export function buildCountSql(rule: TelemetryRetentionRule, days: number): string {
  assertPositive(days);
  return `SELECT count(*)::int AS n FROM ${rule.table} y WHERE y.${rule.timeColumn} < ${cutoff(days)}${protectFor(rule, "y")}`;
}

/** Deletes in bounded keyset-paged batches until nothing is left past the cursor or `maxRecords` is reached. */
export async function purgeTelemetryTable(
  run: Runner,
  rule: TelemetryRetentionRule,
  opts: { days?: number; batchSize: number; maxRecords: number; pauseMs?: number },
): Promise<number> {
  const days = opts.days ?? resolveRetentionDays(rule);
  const limit = Math.max(opts.maxRecords, rule.minSafetyLimit ?? 0);
  let total = 0;
  let cursor: Cursor | undefined;
  while (total < limit) {
    const size = Math.min(opts.batchSize, limit - total);
    const [row] = await run(buildPurgeBatchSql(rule, days, size, cursor));
    const picked = Number(row?.picked ?? 0);
    total += Number(row?.deleted ?? 0);
    if (picked < size || !row?.last_time) break;
    cursor = { time: String(row.last_time), id: String(row.last_id) };
    if (opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs));
  }
  return total;
}
