import { buildMonitorResultsDateRange } from "./date-range";

describe("buildMonitorResultsDateRange DST", () => {
  it("takes the offset of each boundary, so a 23-hour spring-forward day ends at the right instant", () => {
    // America/New_York 2026-03-08: midnight is UTC-5 (offset 300), the next midnight UTC-4 (offset 240).
    const range = buildMonitorResultsDateRange("2026-03-08", 300, 240);
    expect(range?.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(range?.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("takes the offset of each boundary on a 25-hour fall-back day", () => {
    const range = buildMonitorResultsDateRange("2026-11-01", 240, 300);
    expect(range?.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(range?.end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("uses the start offset for both boundaries when no end offset is given", () => {
    const range = buildMonitorResultsDateRange("2026-06-16", -330);
    expect(range?.end.toISOString()).toBe("2026-06-16T18:30:00.000Z");
  });
});
