const DATE_FILTER_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type DateRange = {
  start: Date;
  end: Date;
};

export function buildMonitorResultsDateRange(
  dateFilter: string,
  timezoneOffsetMinutes: number | null = null,
  // The offset in force at the end of the day. A DST change day has two, so one shared value is an hour off
  // at one boundary; without it the start offset is used for both.
  endTimezoneOffsetMinutes: number | null = timezoneOffsetMinutes
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

  const start = new Date(utcStart + (timezoneOffsetMinutes ?? 0) * 60 * 1000);
  const end = new Date(Date.UTC(year, month - 1, day + 1) + (endTimezoneOffsetMinutes ?? 0) * 60 * 1000);

  return { start, end };
}
