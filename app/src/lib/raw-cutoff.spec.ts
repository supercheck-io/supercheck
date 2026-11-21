/** @jest-environment node */
import { rawCutoff } from "./raw-cutoff";

describe("rawCutoff", () => {
  it("is the UTC start of the day `days` ago, whatever the time of day", () => {
    expect(rawCutoff(7, Date.parse("2026-11-21T00:10:00Z")).toISOString()).toBe("2026-11-14T00:00:00.000Z");
    expect(rawCutoff(7, Date.parse("2026-11-21T23:59:00Z")).toISOString()).toBe("2026-11-14T00:00:00.000Z");
    expect(rawCutoff(3, Date.parse("2026-11-21T20:00:00Z")).toISOString()).toBe("2026-11-18T00:00:00.000Z");
  });
});
