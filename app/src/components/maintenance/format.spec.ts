import { dstNote, formatDuration, formatWindowRange, previewWindow, timeZoneOptions } from "./format";

describe("maintenance format", () => {
  it("writes the date once for a same-day window and twice across midnight, in the window's zone", () => {
    const sameDay = formatWindowRange(new Date("2026-11-21T03:00:00Z"), new Date("2026-11-21T04:00:00Z"), "UTC");
    expect(sameDay.match(/2026/g)).toHaveLength(1);
    const overnight = formatWindowRange(new Date("2026-11-21T03:00:00Z"), new Date("2026-11-21T07:00:00Z"), "America/New_York");
    expect(overnight).toMatch(/20.*2026.*21.*2026/);
  });

  it("falls back to the viewer's zone for an unknown zone name", () => {
    expect(formatWindowRange(new Date("2026-11-21T03:00:00Z"), new Date("2026-11-21T04:00:00Z"), "Not/AZone")).toMatch(/2026/);
  });

  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(240)).toBe("4 h");
    expect(formatDuration(3000)).toBe("2 d 2 h");
    expect(formatDuration(Number.NaN)).toBe("-");
    expect(formatDuration(119.6)).toBe("2 h");
    expect(formatDuration(59.75)).toBe("1 h");
    expect(formatDuration(0.3)).toBe("<1 min");
  });

  const once = { recurrence: "once" as const, timezone: "UTC", localStartTime: "22:00", durationMinutes: 240, startsOn: "2026-11-20" };

  it("previews the window the server would schedule", () => {
    expect(previewWindow(once)!.endsAt.toISOString()).toBe("2026-11-21T02:00:00.000Z");
  });

  it("uses real elapsed time across a DST change", () => {
    // 01:30 New York on the spring-forward night plus 2 h is 04:30 local, not 03:30.
    const p = previewWindow({ ...once, timezone: "America/New_York", startsOn: "2027-03-14", localStartTime: "01:30", durationMinutes: 120 })!;
    expect(formatWindowRange(p.startsAt, p.endsAt, "America/New_York")).toMatch(/1:30.*4:30/);
  });

  it("starts a recurring preview on the first matching day, not on the start date", () => {
    // 2026-11-20 is a Friday; a Monday-only window first runs on the 23rd.
    expect(previewWindow({ ...once, recurrence: "weekly", weekdays: [1] })!.startsAt.toISOString()).toBe("2026-11-23T22:00:00.000Z");
    expect(previewWindow({ ...once, recurrence: "monthly", monthDay: 15, startsOn: "2026-11-01" })!.startsAt.toISOString()).toBe("2026-11-15T22:00:00.000Z");
  });

  it("returns null for incomplete or out-of-range input instead of throwing", () => {
    expect(previewWindow({ ...once, startsOn: "" })).toBeNull();
    expect(previewWindow({ ...once, durationMinutes: 0 })).toBeNull();
    expect(previewWindow({ ...once, durationMinutes: 1e20 })).toBeNull();
    expect(previewWindow({ ...once, timezone: "Not/AZone" })).toBeNull();
  });

  it("always offers UTC and the current zone, once each", () => {
    const zones = timeZoneOptions("Asia/Calcutta");
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Asia/Calcutta");
    expect(new Set(zones).size).toBe(zones.length);
  });

  describe("dstNote", () => {
    const ny = "America/New_York";
    const note = (startsOn: string, time: string, minutes: number, zone = ny) => {
      const p = previewWindow({ recurrence: "once", timezone: zone, localStartTime: time, durationMinutes: minutes, startsOn })!;
      return dstNote(p.startsAt, p.endsAt, zone);
    };

    it("flags a spring-forward window", () => {
      expect(note("2027-03-14", "01:30", 90)).toMatch(/go forward 1 h.*further apart/);
    });

    it("flags a fall-back window", () => {
      expect(note("2026-11-01", "00:30", 180)).toMatch(/go back 1 h.*closer/);
    });

    it("covers the repeated hour, a window ending at the change, and southern-hemisphere zones", () => {
      expect(note("2026-11-01", "01:30", 60)).toMatch(/go back 1 h/);
      expect(note("2027-03-14", "00:00", 120)).toMatch(/go forward 1 h/);
      expect(note("2027-03-14", "02:30", 60)).toBeNull();
      expect(note("2026-04-05", "01:00", 180, "Australia/Sydney")).toMatch(/go back 1 h/);
    });

    it("stays quiet when no change falls inside the window", () => {
      expect(note("2027-03-14", "04:00", 60)).toBeNull();
      expect(note("2027-03-13", "01:30", 90)).toBeNull();
      expect(note("2027-03-14", "01:30", 90, "UTC")).toBeNull();
      expect(note("2027-03-14", "01:30", 90, "Asia/Kolkata")).toBeNull();
    });

    it("handles half-hour shifts and unknown zones", () => {
      expect(note("2026-10-04", "01:30", 120, "Australia/Lord_Howe")).toMatch(/forward 30 min/);
      expect(dstNote(new Date(0), new Date(3_600_000), "Not/AZone")).toBeNull();
    });
  });
});
