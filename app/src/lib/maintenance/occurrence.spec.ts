import { isValidTimeZone, minimumGapMinutes, occurrenceAtOrAfter, validateSchedule, zonedTimeToUtc, type WindowSchedule } from "./occurrence";

const iso = (date: Date | undefined) => date?.toISOString();
const base: WindowSchedule = { recurrence: "once", timezone: "Europe/Berlin", localStartTime: "02:00", durationMinutes: 90, startsOn: "2026-11-20" };

describe("zonedTimeToUtc", () => {
  it("converts wall time in winter and summer", () => {
    expect(iso(zonedTimeToUtc("2026-11-20", "02:00", "Europe/Berlin"))).toBe("2026-11-20T01:00:00.000Z");
    expect(iso(zonedTimeToUtc("2026-07-01", "02:00", "Europe/Berlin"))).toBe("2026-07-01T00:00:00.000Z");
    expect(iso(zonedTimeToUtc("2026-07-01", "09:30", "America/New_York"))).toBe("2026-07-01T13:30:00.000Z");
    expect(iso(zonedTimeToUtc("2026-07-01", "09:30", "UTC"))).toBe("2026-07-01T09:30:00.000Z");
    expect(iso(zonedTimeToUtc("2026-07-01", "09:30", "Asia/Kolkata"))).toBe("2026-07-01T04:00:00.000Z");
  });
  it("takes the earlier instant of a repeated hour far east of UTC", () => {
    // Auckland leaves daylight time at 03:00 NZDT on 4 Apr 2027 (14:00Z): 02:30 first happens at 13:30Z (+13).
    expect(zonedTimeToUtc("2027-04-04", "02:30", "Pacific/Auckland").toISOString()).toBe("2027-04-03T13:30:00.000Z");
    expect(zonedTimeToUtc("2027-04-04", "03:30", "Pacific/Auckland").toISOString()).toBe("2027-04-03T15:30:00.000Z");
    expect(zonedTimeToUtc("2027-09-26", "02:30", "Pacific/Auckland").toISOString()).toBe("2027-09-25T14:00:00.000Z");
  });

  it("moves a start inside a spring-forward gap to the first valid minute", () => {
    // Berlin 2026-03-29: 02:00 -> 03:00 local (01:00Z).
    expect(iso(zonedTimeToUtc("2026-03-29", "02:30", "Europe/Berlin"))).toBe("2026-03-29T01:00:00.000Z");
    // New York 2026-03-08: 02:00 -> 03:00 local (07:00Z).
    expect(iso(zonedTimeToUtc("2026-03-08", "02:15", "America/New_York"))).toBe("2026-03-08T07:00:00.000Z");
  });
  it("takes the earlier instant in a fall-back overlap", () => {
    // Berlin 2026-10-25: 02:30 happens at 00:30Z (CEST) and 01:30Z (CET).
    expect(iso(zonedTimeToUtc("2026-10-25", "02:30", "Europe/Berlin"))).toBe("2026-10-25T00:30:00.000Z");
    // New York 2026-11-01: 01:30 happens at 05:30Z (EDT) and 06:30Z (EST).
    expect(iso(zonedTimeToUtc("2026-11-01", "01:30", "America/New_York"))).toBe("2026-11-01T05:30:00.000Z");
  });
});

describe("occurrenceAtOrAfter", () => {
  it("returns a one-off before, during, and nothing after", () => {
    expect(occurrenceAtOrAfter(base, new Date("2026-11-01T00:00:00Z"))).toEqual({ startsAt: new Date("2026-11-20T01:00:00Z"), endsAt: new Date("2026-11-20T02:30:00Z") });
    expect(occurrenceAtOrAfter(base, new Date("2026-11-20T02:00:00Z"))?.startsAt).toEqual(new Date("2026-11-20T01:00:00Z"));
    expect(occurrenceAtOrAfter(base, new Date("2026-11-20T02:30:00Z"))).toBeNull();
  });

  it("keeps daily windows at the same local time across DST (Berlin and New York)", () => {
    const daily = { ...base, recurrence: "daily" as const, startsOn: "2026-03-27" };
    const starts = [27, 28, 29, 30].map((d) => iso(occurrenceAtOrAfter(daily, new Date(`2026-03-${d}T00:00:00Z`))?.startsAt));
    // 02:00 local: CET (01:00Z), CET, the gap moves to 03:00 CEST (01:00Z), then CEST (00:00Z).
    expect(starts).toEqual(["2026-03-27T01:00:00.000Z", "2026-03-28T01:00:00.000Z", "2026-03-29T01:00:00.000Z", "2026-03-30T00:00:00.000Z"]);
    const ny = { ...daily, timezone: "America/New_York", localStartTime: "09:00", startsOn: "2026-10-30" };
    expect(iso(occurrenceAtOrAfter(ny, new Date("2026-10-31T00:00:00Z"))?.startsAt)).toBe("2026-10-31T13:00:00.000Z");
    expect(iso(occurrenceAtOrAfter(ny, new Date("2026-11-02T00:00:00Z"))?.startsAt)).toBe("2026-11-02T14:00:00.000Z");
  });

  it("keeps the duration in real minutes across a DST change", () => {
    const overnight = { ...base, recurrence: "daily" as const, localStartTime: "01:00", durationMinutes: 180, startsOn: "2026-10-25" };
    const occurrence = occurrenceAtOrAfter(overnight, new Date("2026-10-24T12:00:00Z"))!;
    expect(occurrence.endsAt.getTime() - occurrence.startsAt.getTime()).toBe(180 * 60_000);
  });

  it("returns the active occurrence of a long window that started days ago", () => {
    const weekly = { ...base, recurrence: "weekly" as const, weekdays: [1], durationMinutes: 6 * 24 * 60, startsOn: "2026-11-02" };
    // Monday 2026-11-16 02:00 Berlin, six days long.
    expect(iso(occurrenceAtOrAfter(weekly, new Date("2026-11-21T12:00:00Z"))?.startsAt)).toBe("2026-11-16T01:00:00.000Z");
  });

  it("picks the chosen weekdays and respects the end date", () => {
    const weekly = { ...base, recurrence: "weekly" as const, weekdays: [1, 4], startsOn: "2026-11-01", endsOn: "2026-11-19" };
    // Monday 16th, then Thursday 19th, then nothing.
    expect(iso(occurrenceAtOrAfter(weekly, new Date("2026-11-14T00:00:00Z"))?.startsAt)).toBe("2026-11-16T01:00:00.000Z");
    expect(iso(occurrenceAtOrAfter(weekly, new Date("2026-11-17T00:00:00Z"))?.startsAt)).toBe("2026-11-19T01:00:00.000Z");
    expect(occurrenceAtOrAfter(weekly, new Date("2026-11-20T00:00:00Z"))).toBeNull();
  });

  it("never starts before startsOn", () => {
    const daily = { ...base, recurrence: "daily" as const, startsOn: "2026-12-01" };
    expect(iso(occurrenceAtOrAfter(daily, new Date("2026-11-01T00:00:00Z"))?.startsAt)).toBe("2026-12-01T01:00:00.000Z");
  });

  it("monthly last day occurs every month, including February and leap years", () => {
    const monthly = { ...base, recurrence: "monthly" as const, monthDay: -1, timezone: "UTC", startsOn: "2027-01-01" };
    const found: string[] = [];
    let from = new Date("2027-01-01T00:00:00Z");
    for (let i = 0; i < 14; i += 1) {
      const next = occurrenceAtOrAfter(monthly, from)!;
      found.push(next.startsAt.toISOString().slice(0, 10));
      from = next.endsAt;
    }
    expect(found).toEqual([
      "2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31", "2027-06-30", "2027-07-31",
      "2027-08-31", "2027-09-30", "2027-10-31", "2027-11-30", "2027-12-31", "2028-01-31", "2028-02-29",
    ]);
    expect(iso(occurrenceAtOrAfter({ ...monthly, monthDay: 15 }, new Date("2027-01-16T00:00:00Z"))?.startsAt)).toBe("2027-02-15T02:00:00.000Z");
  });
});

describe("validateSchedule", () => {
  it("accepts a valid schedule, including UTC and alias zones", () => {
    expect(validateSchedule(base)).toEqual({});
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
  it("rejects bad fields", () => {
    expect(validateSchedule({ ...base, timezone: "Nope/Nope", localStartTime: "25:00", startsOn: "2026-02-30", durationMinutes: 4 })).toEqual({
      timezone: expect.any(String), localStartTime: expect.any(String), startsOn: expect.any(String), durationMinutes: expect.any(String),
    });
    expect(validateSchedule({ ...base, durationMinutes: 10081 }).durationMinutes).toBeDefined();
    expect(validateSchedule({ ...base, endsOn: "2026-11-19" }).endsOn).toBeDefined();
  });
  it("requires 2 hours between the end of one occurrence and the start of the next", () => {
    expect(validateSchedule({ ...base, recurrence: "daily", durationMinutes: 1321 }).durationMinutes).toMatch(/2 hours/);
    expect(validateSchedule({ ...base, recurrence: "daily", durationMinutes: 1320 })).toEqual({});
    expect(minimumGapMinutes({ recurrence: "weekly", weekdays: [1, 2, 5] })).toBe(1440);
    expect(minimumGapMinutes({ recurrence: "weekly", weekdays: [0, 6] })).toBe(1440);
    expect(minimumGapMinutes({ recurrence: "weekly", weekdays: [1, 4] })).toBe(3 * 1440);
    expect(validateSchedule({ ...base, recurrence: "weekly", weekdays: [1, 4], durationMinutes: 3 * 1440 }).durationMinutes).toMatch(/2 hours/);
    expect(validateSchedule({ ...base, recurrence: "weekly", weekdays: [] }).weekdays).toBeDefined();
    expect(validateSchedule({ ...base, recurrence: "monthly", monthDay: 29 }).monthDay).toBeDefined();
    expect(validateSchedule({ ...base, recurrence: "monthly", monthDay: -1 })).toEqual({});
  });
});

describe("validateSchedule with cleared fields (REST and MCP updates share it)", () => {
  it("refuses a weekly window with no weekdays and a monthly window with no day", () => {
    expect(validateSchedule({ ...base, recurrence: "weekly", weekdays: null })).toHaveProperty("weekdays");
    expect(validateSchedule({ ...base, recurrence: "monthly", monthDay: null })).toHaveProperty("monthDay");
  });
  it("accepts a cleared end date", () => {
    expect(validateSchedule({ ...base, recurrence: "daily", endsOn: null })).toEqual({});
  });
});
