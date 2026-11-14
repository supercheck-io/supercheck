/**
 * Maintenance window time maths. The app is the only place that turns a window's local schedule into
 * UTC occurrences; the worker and every predicate only compare the stored occurrence_* timestamps.
 */

export type Recurrence = "once" | "daily" | "weekly" | "monthly";

export type WindowSchedule = {
  recurrence: Recurrence;
  /** IANA zone, for example "Europe/Berlin". */
  timezone: string;
  /** "HH:MM" wall-clock start in the window's zone. */
  localStartTime: string;
  durationMinutes: number;
  /** "YYYY-MM-DD", the first local date an occurrence may start on. */
  startsOn: string;
  /** "YYYY-MM-DD", the last local date an occurrence may start on. */
  endsOn?: string | null;
  /** 0 (Sunday) to 6, weekly only. */
  weekdays?: number[] | null;
  /** 1-28, or -1 for the month's last day; monthly only. */
  monthDay?: number | null;
};

export type Occurrence = { startsAt: Date; endsAt: Date };

export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 7 * 24 * 60;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** `Intl.supportedValuesOf` leaves out UTC and aliases such as Asia/Kolkata, so construct a formatter instead. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function wallParts(at: Date, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** The wall clock as if it were UTC, in ms; comparing two of these compares local times. */
function wallMs(at: Date, zone: string) {
  const p = wallParts(at, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
}

/**
 * The UTC instant of a local wall-clock time. In a DST overlap the earlier instant wins; in a DST gap
 * (the time does not exist) the first valid minute after it.
 */
export function zonedTimeToUtc(date: string, time: string, zone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  // Offsets either side of the target cover any transition within a day.
  const candidates = [target - DAY / 2, target + DAY / 2]
    .map((probe) => target - (wallMs(new Date(probe), zone) - probe))
    .sort((a, b) => a - b);
  const exact = candidates.find((utc) => wallMs(new Date(utc), zone) === target);
  if (exact !== undefined) return new Date(exact);
  // Gap: walk forward minute by minute (at most the gap, usually 60) to the first wall time at or after the target.
  let utc = candidates[0]!;
  while (wallMs(new Date(utc), zone) < target) utc += MINUTE;
  return new Date(utc);
}

const pad = (value: number) => String(value).padStart(2, "0");
const isoDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const dateMs = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
};

function matchesDay(schedule: WindowSchedule, dayMs: number): boolean {
  const date = new Date(dayMs);
  switch (schedule.recurrence) {
    case "once":
      return isoDate(dayMs) === schedule.startsOn;
    case "daily":
      return true;
    case "weekly":
      return (schedule.weekdays ?? []).includes(date.getUTCDay());
    case "monthly": {
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      return schedule.monthDay === -1 ? date.getUTCDate() === lastDay : date.getUTCDate() === schedule.monthDay;
    }
  }
}

/**
 * The occurrence that is active at `from`, or the next one to start after it; null when the schedule has no
 * more. Durations are real minutes, so an occurrence across a DST change is still exactly `durationMinutes`.
 */
export function occurrenceAtOrAfter(schedule: WindowSchedule, from: Date): Occurrence | null {
  const startDay = dateMs(schedule.startsOn);
  const endDay = schedule.endsOn ? dateMs(schedule.endsOn) : Number.POSITIVE_INFINITY;
  // An occurrence that started up to 7 days (the longest duration) plus a day of zone offset ago may still be running.
  const fromLocalDay = dateMs(isoDate(wallMs(from, schedule.timezone)));
  let day = Math.max(startDay, fromLocalDay - 8 * DAY);
  // Monthly "last day" needs at most ~13 months; daily the first iteration or two.
  for (let i = 0; i < 400 && day <= endDay; i += 1, day += DAY) {
    if (!matchesDay(schedule, day)) continue;
    const startsAt = zonedTimeToUtc(isoDate(day), schedule.localStartTime, schedule.timezone);
    const endsAt = new Date(startsAt.getTime() + schedule.durationMinutes * MINUTE);
    if (endsAt > from) return { startsAt, endsAt };
    if (schedule.recurrence === "once") return null;
  }
  return null;
}

/** The smallest gap in minutes between two occurrence starts, so a duration can be checked against it. */
export function minimumGapMinutes(schedule: Pick<WindowSchedule, "recurrence" | "weekdays">): number {
  if (schedule.recurrence === "daily") return 24 * 60;
  if (schedule.recurrence === "monthly") return 28 * 24 * 60;
  if (schedule.recurrence === "weekly") {
    const days = [...new Set(schedule.weekdays ?? [])].sort((a, b) => a - b);
    if (days.length <= 1) return 7 * 24 * 60;
    const gaps = days.map((d, i) => (i === days.length - 1 ? days[0]! + 7 - d : days[i + 1]! - d));
    return Math.min(...gaps) * 24 * 60;
  }
  return Number.POSITIVE_INFINITY;
}

/** Field errors for a schedule; empty when valid. Occurrences never overlap, so one stored slot is enough. */
export function validateSchedule(schedule: WindowSchedule): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isValidTimeZone(schedule.timezone)) errors.timezone = "Choose a valid time zone";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localStartTime)) errors.localStartTime = "Use HH:MM";
  if (!Number.isInteger(schedule.durationMinutes) || schedule.durationMinutes < MIN_DURATION_MINUTES || schedule.durationMinutes > MAX_DURATION_MINUTES) {
    errors.durationMinutes = "Duration must be between 5 minutes and 7 days";
  } else if (schedule.durationMinutes >= minimumGapMinutes(schedule)) {
    errors.durationMinutes = "Duration must be shorter than the time between occurrences";
  }
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && isoDate(dateMs(value)) === value;
  if (!validDate(schedule.startsOn)) errors.startsOn = "Use a real date";
  if (schedule.endsOn != null && (!validDate(schedule.endsOn) || schedule.endsOn < schedule.startsOn)) errors.endsOn = "End date must be on or after the start date";
  if (schedule.recurrence === "weekly" && (!schedule.weekdays?.length || schedule.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) {
    errors.weekdays = "Pick at least one weekday";
  }
  if (schedule.recurrence === "monthly" && !(schedule.monthDay === -1 || (Number.isInteger(schedule.monthDay) && schedule.monthDay! >= 1 && schedule.monthDay! <= 28))) {
    errors.monthDay = "Pick a day from 1 to 28, or the last day";
  }
  return errors;
}
