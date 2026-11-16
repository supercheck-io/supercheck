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

/** `last` (spec 4.1): the newer of the last success/fail ping and `anchorAt` (create or resume). */
export function heartbeatLastAt(monitor: HeartbeatMonitorLike): number | null {
  const ping = toMs(monitor.heartbeatState?.lastPingAt);
  const anchor = toMs(monitor.heartbeatState?.anchorAt) ?? toMs(monitor.createdAt);
  if (ping === null) return anchor;
  return anchor === null ? ping : Math.max(ping, anchor);
}

/** When the next ping is expected (`last + interval`), or null when nothing anchors it yet. */
export function heartbeatNextExpectedAt(monitor: HeartbeatMonitorLike): Date | null {
  const last = heartbeatLastAt(monitor);
  if (last === null) return null;
  // The worker moves the deadline after an app outage (deadlineShiftMs); the badge follows it, never "Late" early.
  const shift = Number(monitor.heartbeatState?.deadlineShiftMs ?? 0);
  return new Date(last + monitor.frequencyMinutes * 60_000 + (Number.isFinite(shift) && shift > 0 ? shift : 0));
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
    // Never pinged stays pending and never alerts, so there is no deadline to report (anchor + interval would be a false "overdue").
    nextExpectedAt: state.lastPingAt ? (heartbeatNextExpectedAt(monitor)?.toISOString() ?? null) : null,
    graceMinutes: heartbeatGraceMinutes(monitor),
  };
}
