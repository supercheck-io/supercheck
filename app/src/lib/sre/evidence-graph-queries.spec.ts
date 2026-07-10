import { formatSreEvidenceGraphTitle } from "./evidence-graph-display";

describe("formatSreEvidenceGraphTitle", () => {
  it("uses a stable label instead of exposing a full markdown report", () => {
    expect(
      formatSreEvidenceGraphTitle(
        "### Incident Investigation Report **Incident Description:** checkout failed",
        "investigator investigation",
      ),
    ).toBe("investigator investigation");
  });

  it("normalizes a concise root-cause hypothesis for graph display", () => {
    expect(
      formatSreEvidenceGraphTitle(
        "**Database saturation** after the latest deployment\nMore details",
        "investigator investigation",
      ),
    ).toBe("Database saturation after the latest deployment");
  });

  it("falls back when the stored hypothesis is empty", () => {
    expect(
      formatSreEvidenceGraphTitle("   ", "investigator investigation"),
    ).toBe("investigator investigation");
  });
});
