import {
  isValidTimeZone,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  occurrenceAtOrAfter,
  zonedTimeToUtc,
  type Occurrence,
  type WindowSchedule,
} from "@/lib/maintenance/occurrence";

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
 * The first window the server would schedule for this form, as real instants, or null while a field is
 * incomplete or out of range. Uses the server's own occurrence rule, so weekdays, month days and DST all match.
 */
export function previewWindow(schedule: WindowSchedule): Occurrence | null {
  const { startsOn, localStartTime, durationMinutes, timezone } = schedule;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{2}:\d{2}$/.test(localStartTime)) return null;
  if (!Number.isInteger(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) return null;
  if (!isValidTimeZone(timezone)) return null;
  const occurrence = occurrenceAtOrAfter(schedule, zonedTimeToUtc(startsOn, "00:00", timezone));
  return occurrence && !Number.isNaN(occurrence.endsAt.getTime()) ? occurrence : null;
}

/** Every IANA zone the browser knows, plus UTC and `current` (which may be an alias such as Asia/Calcutta). */
export function timeZoneOptions(current: string): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return [...new Set(["UTC", current, ...supported].filter(Boolean))];
}
