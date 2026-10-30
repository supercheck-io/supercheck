import { getNextRunDate } from "./cron-utils";

describe("getNextRunDate", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("evaluates the cron in UTC regardless of the server timezone", () => {
    process.env.TZ = "America/New_York";
    expect(getNextRunDate("0 12 * * *", new Date("2025-01-01T00:00:00Z"))?.toISOString()).toBe(
      "2025-01-01T12:00:00.000Z",
    );
  });
});
