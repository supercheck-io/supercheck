import { formatMaintenanceWindow, statusPageTimeZone } from "./incident-schedule";

const start = "2030-01-05T02:00:00Z";
const end = "2030-01-05T04:00:00Z";

it("formats a maintenance window in the status page's time zone and names the zone", () => {
  expect(formatMaintenanceWindow("en-US", start, end, "Asia/Kolkata")).toBe("Jan 5, 2030, 07:30 AM GMT+5:30 – Jan 5, 2030, 09:30 AM GMT+5:30");
  expect(formatMaintenanceWindow("en-US", start, end)).toBe("Jan 5, 2030, 02:00 AM UTC – Jan 5, 2030, 04:00 AM UTC");
});

it("falls back to UTC for an unset or unknown time zone", () => {
  expect(statusPageTimeZone(null)).toBe("UTC");
  expect(statusPageTimeZone("Not/AZone")).toBe("UTC");
  expect(statusPageTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
});
