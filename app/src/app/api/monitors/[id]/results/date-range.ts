const DATE_FILTER_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type DateRange = {
  start: Date;
  end: Date;
};

export function buildMonitorResultsDateRange(
  dateFilter: string,
  timezoneOffsetMinutes: number | null = null
): DateRange | null {
  if (!DATE_FILTER_PATTERN.test(dateFilter)) {
    return null;
  }

  const [year, month, day] = dateFilter.split("-").map(Number);
  const utcStart = Date.UTC(year, month - 1, day);
  const parsedStart = new Date(utcStart);

  if (
    parsedStart.getUTCFullYear() !== year ||
    parsedStart.getUTCMonth() !== month - 1 ||
    parsedStart.getUTCDate() !== day
  ) {
    return null;
  }

  const offsetMilliseconds = (timezoneOffsetMinutes ?? 0) * 60 * 1000;
  const start = new Date(utcStart + offsetMilliseconds);
  const end = new Date(Date.UTC(year, month - 1, day + 1) + offsetMilliseconds);

  return { start, end };
}
