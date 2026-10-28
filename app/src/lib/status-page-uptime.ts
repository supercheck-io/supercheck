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
