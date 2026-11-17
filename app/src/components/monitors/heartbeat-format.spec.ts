import {
  formatHeartbeatMinutes,
  formatPingAgo,
  formatPingDue,
  formatRunDuration,
  heartbeatFormValues,
  heartbeatScheduleLabel,
  heartbeatSplitMinutes,
  heartbeatToMinutes,
} from "./heartbeat-format";

describe("heartbeat format helpers", () => {
  it("converts number + unit to minutes and rejects non-integers", () => {
    expect(heartbeatToMinutes("5", "minutes")).toBe(5);
    expect(heartbeatToMinutes(2, "hours")).toBe(120);
    expect(heartbeatToMinutes("31", "days")).toBe(44640);
    expect(heartbeatToMinutes("1.5", "hours")).toBeNaN();
    expect(heartbeatToMinutes("", "hours")).toBe(0);
  });

  it("splits minutes into the largest even unit", () => {
    expect(heartbeatSplitMinutes(1440)).toEqual({ value: 1, unit: "days" });
    expect(heartbeatSplitMinutes(120)).toEqual({ value: 2, unit: "hours" });
    expect(heartbeatSplitMinutes(90)).toEqual({ value: 90, unit: "minutes" });
    expect(heartbeatSplitMinutes(0)).toEqual({ value: 0, unit: "minutes" });
    expect(heartbeatFormValues(60, 10)).toEqual({
      heartbeatConfig_every: "1",
      heartbeatConfig_everyUnit: "hours",
      heartbeatConfig_grace: "10",
      heartbeatConfig_graceUnit: "minutes",
    });
  });

  it("labels the schedule for the list and detail page", () => {
    expect(heartbeatScheduleLabel(60, 10)).toBe("Every 1 h, grace 10 min");
    expect(heartbeatScheduleLabel(1530, 30)).toBe("Every 1 d 1 h 30 min, grace 30 min");
    expect(formatHeartbeatMinutes(0)).toBe("0 min");
  });

  it("formats run durations", () => {
    expect(formatRunDuration(null)).toBeNull();
    expect(formatRunDuration(-1)).toBeNull();
    expect(formatRunDuration(850)).toBe("850 ms");
    expect(formatRunDuration(12_000)).toBe("12 s");
    expect(formatRunDuration(248_000)).toBe("4 min 08 s");
    expect(formatRunDuration(3_900_000)).toBe("1 h 05 min");
  });

  it("formats compact last-ping and next-due labels", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    const at = (ms: number) => new Date(now + ms);
    expect(formatPingAgo(at(-30_000), now)).toBe("just now");
    expect(formatPingAgo(at(-5 * 60_000), now)).toBe("5m ago");
    expect(formatPingAgo(at(-8 * 3_600_000), now)).toBe("8h ago");
    expect(formatPingAgo(at(-3 * 86_400_000), now)).toBe("3d ago");
    expect(formatPingDue(at(52 * 60_000 + 5_000), now)).toBe("in 52m");
    expect(formatPingDue(at(30_000), now)).toBe("in <1m");
    expect(formatPingDue(at(2 * 86_400_000), now)).toBe("in 2d");
    expect(formatPingDue(at(-3 * 60_000 - 1_000), now)).toBe("overdue 3m");
  });
});
