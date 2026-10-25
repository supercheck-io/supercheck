import { parseRunsView } from "./runs-view";

describe("parseRunsView", () => {
  it("accepts the three views", () => {
    expect(parseRunsView("all")).toBe("all");
    expect(parseRunsView("k6")).toBe("k6");
    expect(parseRunsView("playwright")).toBe("playwright");
  });
  it("falls back to all for unknown or missing values", () => {
    expect(parseRunsView("nope")).toBe("all");
    expect(parseRunsView(null)).toBe("all");
    expect(parseRunsView(undefined)).toBe("all");
  });
});
