import { formatLocalDateParam } from "./use-monitor-details";

describe("formatLocalDateParam", () => {
  it("formats the selected local calendar day without shifting to UTC", () => {
    // new Date(year, month, day) creates a date at local midnight.
    // The formatLocalDateParam function formats based on local components, 
    // ensuring it doesn't get shifted to the previous day in UTC representation.
    const selectedDate = new Date(2026, 5, 16);
    expect(formatLocalDateParam(selectedDate)).toBe("2026-06-16");
  });

  it("pads single-digit months and days", () => {
    expect(formatLocalDateParam(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
