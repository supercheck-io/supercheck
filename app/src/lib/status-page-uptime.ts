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
/** Share of a partial outage counted as downtime (major outage counts in full), as on most hosted status pages. */
const PARTIAL_OUTAGE_WEIGHT = 0.3;

export type BarLevel = "operational" | "minor" | "major" | "critical" | "maintenance" | "nodata";

export type BarIncident = {
  id: string;
  name: string;
  impact: string;
  status: string;
  createdAt: Date | string | null;
  resolvedAt: Date | string | null;
  scheduledFor?: Date | string | null;
  scheduledUntil?: Date | string | null;
};

export type UptimeDay = {
  date: Date;
  level: BarLevel;
  /** Check-weighted uptime for the day; only components that follow their monitors have it. */
  uptime: number | null;
  /** Days with checks (automatic) or with observed history (manual); grey otherwise. */
  hasData: boolean;
  incidents: Array<{ id: string; name: string; impact: string }>;
};

const time = (value: Date | string | null | undefined) => (value ? new Date(value).getTime() : null);

/** The time an incident affected the component, or null for maintenance that has not started. */
function incidentSpan(incident: BarIncident, now: number): [number, number] | null {
  const maintenance = Boolean(incident.scheduledFor);
  const start = maintenance ? time(incident.scheduledFor) : time(incident.createdAt);
  if (start === null || start > now) return null;
  if (maintenance && incident.status === "scheduled") return null;
  const end = time(incident.resolvedAt) ?? (maintenance ? Math.min(time(incident.scheduledUntil) ?? now, now) : now);
  return end > start ? [start, end] : null;
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

const IMPACT_LEVEL: Record<string, BarLevel> = { none: "operational", minor: "minor", major: "major", critical: "critical" };
const LEVEL_RANK: BarLevel[] = ["critical", "major", "minor", "maintenance", "operational"];

/**
 * 90 UTC days of bars for one component, ending today.
 * - Manual (default): green unless an incident affected the component; a day is coloured by its worst incident impact.
 *   Days before `startedAt` are grey. Uptime counts a critical incident as full and a major one as partial downtime.
 * - Automatic (`metrics` given): coloured by the checks of the linked monitors; uptime is check-weighted. Days before
 *   the first check are grey; a later day without checks (monitor paused) is green.
 */
export function buildUptimeDays({
  now: nowDate = new Date(),
  startedAt,
  incidents,
  metrics,
}: {
  now?: Date;
  startedAt: Date | string | null;
  incidents: BarIncident[];
  metrics?: DailyCheckCounts[];
}): { days: UptimeDay[]; uptime: number | null } {
  const now = nowDate.getTime();
  const today = new Date(nowDate);
  today.setUTCHours(0, 0, 0, 0);
  const windowStart = today.getTime() - 89 * DAY_MS;
  const spans = incidents
    .map((incident) => ({ incident, span: incidentSpan(incident, now) }))
    .filter((entry): entry is { incident: BarIncident; span: [number, number] } => entry.span !== null);
  const automatic = metrics !== undefined;
  const byDate = new Map((metrics ?? []).map((metric) => [metric.date, metric]));
  const firstCheck = [...byDate.keys()].sort()[0];
  const start = automatic ? (firstCheck ? Date.parse(firstCheck) : Infinity) : (time(startedAt) ?? now);

  const days = Array.from({ length: 90 }, (_, index): UptimeDay => {
    const dayStart = windowStart + index * DAY_MS;
    const date = new Date(dayStart);
    const dayEnd = Math.min(dayStart + DAY_MS, now);
    const onDay = spans.filter(({ span }) => span[0] < dayEnd && span[1] > Math.max(dayStart, start));
    const dayIncidents = onDay.map(({ incident }) => ({ id: incident.id, name: incident.name, impact: incident.impact }));
    const maintenance = onDay.some(({ incident }) => incident.scheduledFor);
    const worstIncident = LEVEL_RANK.find((level) =>
      onDay.some(({ incident }) => !incident.scheduledFor && IMPACT_LEVEL[incident.impact] === level),
    );
    if (automatic) {
      const metric = byDate.get(date.toISOString().slice(0, 10));
      const uptime = checkUptimePercentage(metric ? [metric] : []);
      if (uptime === null) {
        const level: BarLevel = dayEnd <= start ? "nodata" : maintenance ? "maintenance" : "operational";
        return { date, level, uptime, hasData: false, incidents: dayIncidents };
      }
      const level: BarLevel = uptime === 100 ? "operational" : uptime === 0 ? "critical" : "minor";
      return { date, level, uptime, hasData: true, incidents: dayIncidents };
    }
    if (dayEnd <= start) return { date, level: "nodata", uptime: null, hasData: false, incidents: [] };
    const level: BarLevel = worstIncident && worstIncident !== "operational" ? worstIncident : maintenance ? "maintenance" : "operational";
    return { date, level, uptime: null, hasData: true, incidents: dayIncidents };
  });

  if (automatic) {
    const inWindow = new Set(days.map((day) => day.date.toISOString().slice(0, 10)));
    return { days, uptime: checkUptimePercentage((metrics ?? []).filter((metric) => inWindow.has(metric.date))) };
  }
  const from = Math.max(windowStart, start);
  if (now <= from) return { days, uptime: null };
  const of = (impact: string) => spans.filter(({ incident }) => !incident.scheduledFor && incident.impact === impact).map(({ span }) => span);
  const critical = covered(of("critical"), from, now);
  const partial = covered([...of("critical"), ...of("major")], from, now) - critical;
  const downtime = critical + PARTIAL_OUTAGE_WEIGHT * partial;
  return { days, uptime: Math.max(0, (1 - downtime / (now - from)) * 100) };
}
