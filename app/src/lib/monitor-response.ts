import { getTableColumns, sql } from "drizzle-orm";
import { monitors } from "@/db/schema";
import { heartbeatSummary } from "@/lib/heartbeat/state";

/**
 * Excludes the heartbeat token columns from a relational query (`db.query.monitors.find*({ columns })`).
 * Every monitor read that can reach a response, MCP tool, export, log or AI prompt uses this or
 * MONITOR_READ_COLUMNS; only the ping, reveal and rotate paths read the token columns.
 */
export const WITHOUT_HEARTBEAT_TOKEN = { heartbeatTokenHash: false, heartbeatTokenEncrypted: false } as const;

/** Every monitors column except the heartbeat token columns, for `db.select(MONITOR_READ_COLUMNS)`. */
export const MONITOR_READ_COLUMNS = (() => {
  const { heartbeatTokenHash: _hash, heartbeatTokenEncrypted: _encrypted, ...rest } = getTableColumns(monitors);
  return rest;
})();

type MonitorRowLike = Parameters<typeof heartbeatSummary>[0] & {
  heartbeatTokenHash?: unknown;
  heartbeatTokenEncrypted?: unknown;
};

/**
 * A monitor as API and MCP readers see it: never the token columns or the raw runtime state, plus the
 * read-only `heartbeat` summary (undefined for other types, so it is dropped from JSON).
 */
export function monitorForResponse<T extends MonitorRowLike>(monitor: T) {
  const { heartbeatTokenHash: _hash, heartbeatTokenEncrypted: _encrypted, heartbeatState: _state, ...rest } = monitor;
  return { ...rest, heartbeat: heartbeatSummary(monitor) };
}

/**
 * New `heartbeat_state` for a resumed (or restored) monitor: heartbeat rows get `anchorAt = now()` so the
 * deadline counts from the resume, other types keep the column as it is. An expression on the current value,
 * never a read-modify-write, so a concurrent ping or sweep is not lost.
 */
export const HEARTBEAT_ANCHOR_ON_RESUME = sql`CASE WHEN ${monitors.type} = 'heartbeat'
  THEN (coalesce(${monitors.heartbeatState}, '{}'::jsonb) - 'missHeld') || jsonb_build_object('anchorAt', to_jsonb(now()))
  ELSE ${monitors.heartbeatState} END`;
