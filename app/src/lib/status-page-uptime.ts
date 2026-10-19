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
