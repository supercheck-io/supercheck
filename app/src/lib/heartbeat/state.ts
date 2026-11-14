import type { HeartbeatState, MonitorConfig } from "@/db/schema/types";

export const HEARTBEAT_MAX_INTERVAL_MINUTES = 44640; // 31 days
export const HEARTBEAT_MAX_GRACE_MINUTES = 1440;

export type HeartbeatDisplayState = "pending" | "up" | "late" | "down" | "paused";

/** Default grace: 20% of the interval, at least 5 minutes, at most 1 day. */
export function defaultHeartbeatGraceMinutes(intervalMinutes: number): number {
  return Math.min(HEARTBEAT_MAX_GRACE_MINUTES, Math.max(5, Math.round(intervalMinutes * 0.2)));
}

export function heartbeatGraceMinutes(monitor: {
  frequencyMinutes: number;
  config?: MonitorConfig | null;
}): number {
  return monitor.config?.heartbeat?.graceMinutes ?? defaultHeartbeatGraceMinutes(monitor.frequencyMinutes);
}

type HeartbeatMonitorLike = {
  status: string;
  enabled?: boolean | null;
  frequencyMinutes: number;
  config?: MonitorConfig | null;
  heartbeatState?: HeartbeatState | null;
  createdAt?: Date | string | null;
};

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The time a ping is next expected, or null before the first ping.
 * `last` = last ping (spec 4.1); creation/resume are covered by the worker deadline, the UI only needs pings.
 */
export function heartbeatNextExpectedAt(monitor: HeartbeatMonitorLike): Date | null {
  const last = toMs(monitor.heartbeatState?.lastPingAt);
  if (last === null) return null;
  return new Date(last + monitor.frequencyMinutes * 60_000);
}

/**
 * Display state shared by the API and the UI. "Late" is derived, never stored (spec D17):
 * the monitor is still `up` but the next ping is overdue and inside the grace period.
 */
export function heartbeatDisplayState(monitor: HeartbeatMonitorLike, now: Date = new Date()): HeartbeatDisplayState {
  if (monitor.status === "paused" || monitor.enabled === false) return "paused";
  if (monitor.status === "down") return "down";
  if (monitor.status !== "up") return "pending";
  const next = heartbeatNextExpectedAt(monitor);
  if (next && now.getTime() > next.getTime()) return "late";
  return "up";
}

/** Read-only heartbeat summary returned by monitor GET routes and MCP. Never contains the token. */
export function heartbeatSummary(monitor: HeartbeatMonitorLike & { type: string }, now: Date = new Date()) {
  if (monitor.type !== "heartbeat") return undefined;
  const state = monitor.heartbeatState ?? {};
  return {
    state: heartbeatDisplayState(monitor, now),
    lastPingAt: state.lastPingAt ?? null,
    lastPingKind: state.lastPingKind ?? null,
    lastStartAt: state.lastStartAt ?? null,
    nextExpectedAt: heartbeatNextExpectedAt(monitor)?.toISOString() ?? null,
    graceMinutes: heartbeatGraceMinutes(monitor),
  };
}
