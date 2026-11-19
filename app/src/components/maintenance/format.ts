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

/** Minutes `timeZone` is ahead of UTC at `at`, read from the zone's wall clock. */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(at).map((p) => [p.type, Number(p.value)]),
  );
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((wallAsUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * A note for a window that crosses a DST change in `timeZone`, or null. The duration is elapsed time, so the
 * wall-clock gap between start and end differs by the shift: a spring-forward skips an hour, a fall-back repeats one.
 */
export function dstNote(start: Date, end: Date, timeZone: string): string | null {
  let shift: number;
  try {
    shift = zoneOffsetMinutes(end, timeZone) - zoneOffsetMinutes(start, timeZone);
  } catch {
    return null;
  }
  if (shift === 0) return null;
  const amount = formatDuration(Math.abs(shift));
  return shift > 0
    ? `Clocks go forward ${amount} in this window, so the start and end times look ${amount} further apart than the duration.`
    : `Clocks go back ${amount} in this window, so the start and end times look ${amount} closer than the duration.`;
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
