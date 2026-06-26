import { formatLocalDateParam } from "./use-monitor-details";

describe("formatLocalDateParam", () => {
  const originalTimezone = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTimezone;
  });

  it("formats the selected local calendar day without shifting to UTC", () => {
    process.env.TZ = "Asia/Kolkata";

    const selectedDate = new Date(2026, 5, 16);

    expect(selectedDate.toISOString().startsWith("2026-06-15")).toBe(true);
    expect(formatLocalDateParam(selectedDate)).toBe("2026-06-16");
  });

  it("pads single-digit months and days", () => {
    process.env.TZ = "UTC";

    expect(formatLocalDateParam(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
