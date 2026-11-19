import { formatDuration, formatWindowRange, previewWindow, timeZoneOptions } from "./format";

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

  it("previews the end time as wall-clock arithmetic and rejects incomplete input", () => {
    const preview = previewWindow("2026-11-20", "22:00", 240)!;
    expect(preview.end.toISOString()).toBe("2026-11-21T02:00:00.000Z");
    expect(previewWindow("", "22:00", 60)).toBeNull();
    expect(previewWindow("2026-11-20", "22:00", 0)).toBeNull();
  });

  it("always offers UTC and the current zone, once each", () => {
    const zones = timeZoneOptions("Asia/Calcutta");
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Asia/Calcutta");
    expect(new Set(zones).size).toBe(zones.length);
  });
});
