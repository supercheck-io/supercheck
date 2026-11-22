export type DailyCheckCounts = {
  date: string;
  totalChecks: number;
  successfulChecks: number;
};

/** Check-weighted availability; missing observations never imply uptime. */
export function checkUptimePercentage(days: DailyCheckCounts[]): number | null {
  const total = days.reduce((sum, day) => sum + day.totalChecks, 0);
  if (total === 0) return null;
  return (
    (days.reduce((sum, day) => sum + day.successfulChecks, 0) / total) * 100
  );
}

export type MonitorDayCounts = {
  weight: number;
  totalChecks: number;
  successfulChecks: number;
};

/**
 * Combine one day's per-monitor counts the way the component status is
 * aggregated, so the bar agrees with the badge. worst_case/majority_vote pick
 * the monitor at the failureThreshold-th worst / median position, best_case the
 * best, weighted_average takes the weighted mean of per-monitor ratios.
 * shortcut: majority_vote uses the median monitor, not a per-bucket vote.
 */
export function combineMonitorDay(
  monitors: MonitorDayCounts[],
  method: string,
  failureThreshold: number,
): { totalChecks: number; successfulChecks: number } {
  if (monitors.length === 0) return { totalChecks: 0, successfulChecks: 0 };
  const ratio = (m: MonitorDayCounts) =>
    m.totalChecks === 0 ? 1 : m.successfulChecks / m.totalChecks;
  if (method === "weighted_average") {
    // Weight monitors equally per check ratio (as the status aggregator does), not per check volume.
    const weights = monitors.reduce((sum, m) => sum + m.weight, 0) || 1;
    const mean = monitors.reduce((sum, m) => sum + m.weight * ratio(m), 0) / weights;
    return { totalChecks: 10000, successfulChecks: Math.round(mean * 10000) };
  }
  // Fewer monitors than the threshold can never fail the component.
  if (failureThreshold > monitors.length) {
    const total = Math.max(...monitors.map((m) => m.totalChecks));
    return { totalChecks: total, successfulChecks: total };
  }
  const worstFirst = [...monitors].sort((a, b) => ratio(a) - ratio(b));
  const index =
    method === "best_case"
      ? worstFirst.length - 1
      : method === "majority_vote"
        ? Math.floor((worstFirst.length - 1) / 2) // lower median: ties resolve to the worse monitor
        : Math.max(failureThreshold, 1) - 1;
  const { totalChecks, successfulChecks } = worstFirst[index];
  return { totalChecks, successfulChecks };
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Share of partial-outage time counted as downtime; major outage counts in full (as Atlassian Statuspage does). */
const PARTIAL_OUTAGE_WEIGHT = 0.3;
/** Weighted downtime in a day at which a manual component's bar turns red instead of yellow. */
const RED_AFTER_MINUTES = 60;

export type BarLevel = "operational" | "minor" | "critical" | "maintenance" | "nodata";

export type BarIncident = {
  id: string;
  name: string;
  impact: string;
  status: string;
  createdAt: Date | string | null;
  resolvedAt: Date | string | null;
  updatedAt?: Date | string | null;
  scheduledFor?: Date | string | null;
  scheduledUntil?: Date | string | null;
  /** What the component showed while the incident was open. Older rows without it fall back to the impact. */
  componentStatus?: string | null;
};

export type UptimeDay = {
  date: Date;
  level: BarLevel;
  /** Uptime for the day: check-based for monitored components, weighted downtime for manual ones. */
  uptime: number | null;
  incidents: Array<{ id: string; name: string; level: BarLevel }>;
};

type Kind = "major" | "partial" | "degraded" | "maintenance" | "none";
const STATUS_KIND: Record<string, Kind> = {
  major_outage: "major",
  partial_outage: "partial",
  degraded_performance: "degraded",
  under_maintenance: "maintenance",
};
const IMPACT_KIND: Record<string, Kind> = { critical: "major", major: "partial", minor: "degraded" };
const KIND_LEVEL: Record<Kind, BarLevel> = {
  major: "critical",
  partial: "minor",
  degraded: "minor",
  maintenance: "maintenance",
  none: "operational",
};

const time = (value: Date | string | null | undefined) => (value ? new Date(value).getTime() : null);

function kindOf(incident: BarIncident): Kind {
  if (incident.scheduledFor) return "maintenance";
  // The impact stands in only for older rows without a component status; "operational" means no effect.
  return incident.componentStatus
    ? (STATUS_KIND[incident.componentStatus] ?? "none")
    : (IMPACT_KIND[incident.impact] ?? "none");
}

/** When the incident affected the component, or null for maintenance that has not started. */
function incidentSpan(incident: BarIncident, now: number): [number, number] | null {
  const maintenance = Boolean(incident.scheduledFor);
  const start = maintenance ? time(incident.scheduledFor) : time(incident.createdAt);
  if (start === null || start > now) return null;
  if (incident.status === "scheduled") return null;
  // Resolved rows from before resolvedAt was always set end at their last change; open ones run until now.
  const end =
    time(incident.resolvedAt) ??
    (incident.status === "resolved" ? (time(incident.updatedAt) ?? start) : now);
  return end > start ? [start, Math.min(end, now)] : null;
}

/** Total length of the union of intervals clipped to [from, to). */
function covered(intervals: Array<[number, number]>, from: number, to: number) {
  const clipped = intervals
    .map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of clipped) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

/**
 * 90 UTC days of bars for one component, ending today.
 * - Monitored (`metrics` given): coloured by the day's checks; a day without checks has no data, and uptime is
 *   successful checks over total checks.
 * - Manual: from the status updates that affected the component, timed by minutes in each status. Major outage
 *   counts fully and partial outage 30%; degraded performance and maintenance are not downtime. A day is yellow for
 *   any downtime or degraded time, red from an hour of weighted downtime, blue for maintenance only. Days before
 *   `startedAt` have no data. `currentStatus` colours today when it was set by hand with no update behind it.
 */
export function buildUptimeDays({
  now: nowDate = new Date(),
  startedAt,
  incidents,
  metrics,
  currentStatus,
}: {
  now?: Date;
  startedAt: Date | string | null;
  incidents: BarIncident[];
  metrics?: DailyCheckCounts[];
  currentStatus?: string;
}): { days: UptimeDay[]; uptime: number | null } {
  const now = nowDate.getTime();
  const today = new Date(nowDate);
  today.setUTCHours(0, 0, 0, 0);
  const windowStart = today.getTime() - 89 * DAY_MS;
  const spans = incidents
    .map((incident) => ({ incident, kind: kindOf(incident), span: incidentSpan(incident, now) }))
    .filter((entry): entry is { incident: BarIncident; kind: Kind; span: [number, number] } => entry.span !== null);
  const of = (...kinds: Kind[]) => spans.filter((entry) => kinds.includes(entry.kind)).map((entry) => entry.span);
  const weightedDowntime = (from: number, to: number) => {
    const major = covered(of("major"), from, to);
    return major + PARTIAL_OUTAGE_WEIGHT * (covered(of("major", "partial"), from, to) - major);
  };
  const byDate = new Map((metrics ?? []).map((metric) => [metric.date, metric]));
  const start = time(startedAt) ?? now;

  const days = Array.from({ length: 90 }, (_, index): UptimeDay => {
    const dayStart = windowStart + index * DAY_MS;
    const date = new Date(dayStart);
    const dayEnd = Math.min(dayStart + DAY_MS, now);
    const dayIncidents = spans
      .filter(({ span }) => span[0] < dayEnd && span[1] > dayStart)
      .map(({ incident, kind }) => ({ id: incident.id, name: incident.name, level: KIND_LEVEL[kind] }));
    if (metrics) {
      const metric = byDate.get(date.toISOString().slice(0, 10));
      const uptime = checkUptimePercentage(metric ? [metric] : []);
      const level: BarLevel = uptime === null ? "nodata" : uptime === 100 ? "operational" : uptime === 0 ? "critical" : "minor";
      return { date, level, uptime, incidents: dayIncidents };
    }
    const from = Math.max(dayStart, start);
    if (dayEnd <= from) return { date, level: "nodata", uptime: null, incidents: [] };
    const downtime = weightedDowntime(from, dayEnd);
    const degraded = covered(of("degraded"), from, dayEnd) > 0;
    const maintenance = covered(of("maintenance"), from, dayEnd) > 0;
    let level: BarLevel =
      downtime >= RED_AFTER_MINUTES * MINUTE_MS ? "critical" : downtime > 0 || degraded ? "minor" : maintenance ? "maintenance" : "operational";
    // A status set by hand has no start time, so it colours today only and is left out of uptime.
    // shortcut: no component status history; record status changes if owners need hand-set outages timed.
    if (index === 89 && currentStatus) {
      const current = KIND_LEVEL[STATUS_KIND[currentStatus] ?? "none"];
      const rank: BarLevel[] = ["operational", "maintenance", "minor", "critical"];
      if (rank.indexOf(current) > rank.indexOf(level)) level = current;
    }
    return { date, level, uptime: (1 - downtime / (dayEnd - from)) * 100, incidents: dayIncidents };
  });

  if (metrics) {
    const inWindow = new Set(days.map((day) => day.date.toISOString().slice(0, 10)));
    return { days, uptime: checkUptimePercentage(metrics.filter((metric) => inWindow.has(metric.date))) };
  }
  const from = Math.max(windowStart, start);
  if (now <= from) return { days, uptime: null };
  return { days, uptime: Math.max(0, (1 - weightedDowntime(from, now) / (now - from)) * 100) };
}
