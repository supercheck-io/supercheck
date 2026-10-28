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
 * best, weighted_average scales counts by weight.
 * shortcut: majority_vote uses the median monitor, not a per-bucket vote.
 */
export function combineMonitorDay(
  monitors: MonitorDayCounts[],
  method: string,
  failureThreshold: number,
): { totalChecks: number; successfulChecks: number } {
  if (monitors.length === 0) return { totalChecks: 0, successfulChecks: 0 };
  if (method === "weighted_average") {
    return monitors.reduce(
      (acc, m) => ({
        totalChecks: acc.totalChecks + m.weight * m.totalChecks,
        successfulChecks: acc.successfulChecks + m.weight * m.successfulChecks,
      }),
      { totalChecks: 0, successfulChecks: 0 },
    );
  }
  const ratio = (m: MonitorDayCounts) =>
    m.totalChecks === 0 ? 1 : m.successfulChecks / m.totalChecks;
  const worstFirst = [...monitors].sort((a, b) => ratio(a) - ratio(b));
  const index =
    method === "best_case"
      ? worstFirst.length - 1
      : method === "majority_vote"
        ? Math.floor(worstFirst.length / 2)
        : Math.min(Math.max(failureThreshold, 1) - 1, worstFirst.length - 1);
  const { totalChecks, successfulChecks } = worstFirst[index];
  return { totalChecks, successfulChecks };
}
