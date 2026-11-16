/** Display and form helpers for heartbeat intervals (minutes in storage, number + unit in the form). */

export type HeartbeatUnit = "minutes" | "hours" | "days";

const UNIT_MINUTES: Record<HeartbeatUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** Minutes for a form value: number + unit. NaN when the number is not a whole number. */
export function heartbeatToMinutes(value: number | string, unit: HeartbeatUnit): number {
  const n = Number(value);
  return Number.isInteger(n) ? n * UNIT_MINUTES[unit] : NaN;
}

/** The largest unit that divides the minutes evenly, so 1440 shows as 1 day and 90 as 90 minutes. */
export function heartbeatSplitMinutes(minutes: number): { value: number; unit: HeartbeatUnit } {
  if (minutes > 0 && minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes > 0 && minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

/** "10 min", "1 h", "1 h 30 min", "2 d", "1 d 6 h". */
export function formatHeartbeatMinutes(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [days && `${days} d`, hours && `${hours} h`, mins && `${mins} min`].filter(Boolean);
  return parts.length ? parts.join(" ") : "0 min";
}

/** "Every 1 h, grace 10 min" for the monitors list and detail subtitle. */
export function heartbeatScheduleLabel(frequencyMinutes: number, graceMinutes: number): string {
  return `Every ${formatHeartbeatMinutes(frequencyMinutes)}, grace ${formatHeartbeatMinutes(graceMinutes)}`;
}

/** Run time for the ping history and stat strip, e.g. "4 min 08 s", "12 s", "850 ms". */
export function formatRunDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}

/** Form fields for a stored heartbeat (edit page). */
export function heartbeatFormValues(frequencyMinutes: number, graceMinutes: number) {
  const every = heartbeatSplitMinutes(frequencyMinutes);
  const grace = heartbeatSplitMinutes(graceMinutes);
  return {
    heartbeatConfig_every: String(every.value),
    heartbeatConfig_everyUnit: every.unit,
    heartbeatConfig_grace: String(grace.value),
    heartbeatConfig_graceUnit: grace.unit,
  };
}

/** "just now", "5m", "8h", "3d": a short span that never truncates in a stat tile. */
function compactSpan(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Last ping: "just now", "5m ago", "8h ago", "3d ago". */
export function formatPingAgo(at: Date, now: number = Date.now()): string {
  const ms = now - at.getTime();
  return ms < 60_000 ? "just now" : `${compactSpan(ms)} ago`;
}

/** Next expected ping: "in 52m", "in 2d", or "overdue 3m" once the time has passed. */
export function formatPingDue(at: Date, now: number = Date.now()): string {
  const ms = at.getTime() - now;
  return ms >= 0 ? `in ${compactSpan(ms)}` : `overdue ${compactSpan(-ms)}`;
}
