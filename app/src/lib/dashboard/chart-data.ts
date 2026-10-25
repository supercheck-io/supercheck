/**
 * Pure data builders for the dashboard charts. Kept free of React so the
 * logic (gaps, axis domains, status buckets) is unit-testable.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "YYYY-MM-DD" for the UTC calendar day of `date` (matches SQL DATE() output). */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "MMM d" label for a "YYYY-MM-DD" key, without any timezone shifting. */
export function formatDayKey(key: string): string {
  const [, m, d] = key.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!month) return key;
  return `${month} ${Number(d)}`;
}

/** The last `days` UTC day keys ending at `now`, oldest first. */
export function lastDayKeys(now: Date, days: number): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime());
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(utcDayKey(d));
  }
  return keys;
}

export type UptimePoint = {
  /** "MMM d" label used for ticks and tooltips. */
  date: string;
  key: string;
  /** null = no checks that day (rendered as a gap, never back-filled). */
  uptime: number | null;
};

export function buildUptimeSeries(
  trend: Array<{ date: string; uptime: number }> | undefined,
  days: number,
  now: Date
): UptimePoint[] {
  const byDay = new Map<string, number>();
  for (const item of trend ?? []) {
    if (item && typeof item.date === "string" && Number.isFinite(item.uptime)) {
      byDay.set(item.date.slice(0, 10), item.uptime);
    }
  }
  return lastDayKeys(now, days).map((key) => {
    const raw = byDay.get(key);
    return {
      key,
      date: formatDayKey(key),
      uptime:
        raw === undefined
          ? null
          : Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100,
    };
  });
}

/**
 * Y axis for an uptime percentage chart: max is always 100, min is the data
 * minimum floored to a clean step (5, or 10 when the range is wide), with at
 * most 5 evenly spaced ticks on that step.
 */
export function uptimeAxis(values: Array<number | null | undefined>): {
  domain: [number, number];
  ticks: number[];
} {
  const nums = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
  const dataMin = nums.length ? Math.min(...nums) : 100;
  const range = 100 - dataMin;
  const step = range > 40 ? 20 : range > 20 ? 10 : 5;
  const min = Math.max(0, Math.min(95, Math.floor(dataMin / step) * step));
  const ticks: number[] = [];
  for (let t = min; t < 100; t += step) ticks.push(t);
  ticks.push(100);
  return { domain: [min, 100], ticks };
}

export type MonitorStatusCounts = Partial<
  Record<"up" | "down" | "paused" | "pending" | "maintenance" | "error", number>
>;

export const MONITOR_STATUS_META: Array<{
  key: keyof MonitorStatusCounts;
  name: string;
  color: string;
}> = [
  { key: "up", name: "Up", color: "var(--success)" },
  { key: "down", name: "Down", color: "var(--failure)" },
  { key: "error", name: "Error", color: "var(--warning)" },
  { key: "maintenance", name: "Maintenance", color: "var(--chart-1)" },
  { key: "pending", name: "Pending", color: "var(--chart-3)" },
  { key: "paused", name: "Paused", color: "var(--muted-foreground)" },
];

/** Every non-zero monitor status bucket, in a stable severity-friendly order. */
export function buildMonitorStatusBuckets(counts: MonitorStatusCounts) {
  return MONITOR_STATUS_META.map((meta) => ({
    name: meta.name,
    count: Math.max(0, Number(counts[meta.key]) || 0),
    fill: meta.color,
  })).filter((b) => b.count > 0);
}

export type RunTrendLabels = {
  /** Axis tick: "MMM d" on the first point of each day, empty for same-day repeats. */
  tickLabel: string;
  /** Tooltip: "MMM d, HH:mm" so same-day runs are distinguishable. */
  tooltipLabel: string;
};

/**
 * Time-aware labels for per-run trend charts. Several runs on one day would
 * otherwise repeat the same "MMM d" tick ("Oct 3, Oct 3").
 */
export function labelRunTrend(
  points: Array<{ date: string | null }>
): RunTrendLabels[] {
  let previousDay = "";
  return points.map(({ date }) => {
    const parsed = date ? new Date(date) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return { tickLabel: "", tooltipLabel: "" };
    }
    const dayLabel = `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}`;
    const hh = String(parsed.getHours()).padStart(2, "0");
    const mm = String(parsed.getMinutes()).padStart(2, "0");
    const tickLabel = dayLabel === previousDay ? "" : dayLabel;
    previousDay = dayLabel;
    return { tickLabel, tooltipLabel: `${dayLabel}, ${hh}:${mm}` };
  });
}
