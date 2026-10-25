import { formatTestTypeBreakdown } from "./test-types";

describe("formatTestTypeBreakdown", () => {
  it("formats counts with friendly labels, largest first", () => {
    expect(
      formatTestTypeBreakdown([
        { type: "browser", count: 1 },
        { type: "api", count: 3 },
      ])
    ).toBe("3 API · 1 browser");
  });
  it("skips zero counts and handles empty input", () => {
    expect(formatTestTypeBreakdown([{ type: "api", count: 0 }])).toBe("");
    expect(formatTestTypeBreakdown(undefined)).toBe("");
  });
  it("falls back to the lower-cased raw type", () => {
    expect(formatTestTypeBreakdown([{ type: "Grpc", count: 2 }])).toBe("2 grpc");
  });
});
