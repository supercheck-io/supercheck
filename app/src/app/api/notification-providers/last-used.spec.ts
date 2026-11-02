import { sql } from "drizzle-orm";
import { alertHistory } from "@/db/schema";

// The route's MAX(sent_at) aggregate arrives from the driver as raw timestamptz text; mapWith decodes it.
describe("notification providers last-used aggregate", () => {
  it("decodes the raw timestamptz string to the right instant", () => {
    const aggregate = sql<Date>`MAX(${alertHistory.sentAt})`.mapWith(alertHistory.sentAt) as unknown as {
      decoder: { mapFromDriverValue: (value: unknown) => unknown };
    };
    const decoded = aggregate.decoder.mapFromDriverValue("2026-11-02 08:00:00.123456+00") as Date;
    expect(decoded).toBeInstanceOf(Date);
    expect(decoded.toISOString()).toBe("2026-11-02T08:00:00.123Z");
  });
});
