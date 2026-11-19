/** One date style for maintenance windows: the table, the dialog preview and the edit form agree. */
const RANGE_OPTIONS = { dateStyle: "medium", timeStyle: "short" } as const;

/** "Nov 21, 2026, 1:00 – 2:30 AM": start to end in `timeZone`, the date written once when both fall on the same day. */
export function formatWindowRange(start: Date, end: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { ...RANGE_OPTIONS, timeZone }).formatRange(start, end);
  } catch {
    // An unknown zone name (stored before validation) falls back to the viewer's zone.
    return new Intl.DateTimeFormat(undefined, RANGE_OPTIONS).formatRange(start, end);
  }
}

/** "45 min", "1 h 30 min", "2 d 4 h". */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "-";
  // Occurrences ended early can last a fraction of a minute; round once, before splitting.
  const total = Math.round(minutes);
  if (total === 0) return "<1 min";
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  return [days && `${days} d`, hours && `${hours} h`, mins && `${mins} min`].filter(Boolean).join(" ");
}

/**
 * The first window of a form's schedule, as wall-clock times in its own zone, or null while a field is incomplete.
 * shortcut: plain wall-clock arithmetic, so a window that crosses a DST change shows the end an hour off; the server computes the real instant.
 */
export function previewWindow(startsOn: string, localStartTime: string, durationMinutes: number): { start: Date; end: Date } | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsOn);
  const time = /^(\d{2}):(\d{2})$/.exec(localStartTime);
  if (!date || !time || !Number.isInteger(durationMinutes) || durationMinutes <= 0) return null;
  const start = new Date(Date.UTC(+date[1], +date[2] - 1, +date[3], +time[1], +time[2]));
  return { start, end: new Date(start.getTime() + durationMinutes * 60_000) };
}

/** Every IANA zone the browser knows, plus UTC and `current` (which may be an alias such as Asia/Calcutta). */
export function timeZoneOptions(current: string): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return [...new Set(["UTC", current, ...supported].filter(Boolean))];
}
