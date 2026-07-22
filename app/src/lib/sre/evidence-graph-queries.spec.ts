import {
  formatSreEvidenceGraphTitle,
  formatSreInvestigationTypeLabel,
} from "./evidence-graph-display";

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

describe("formatSreInvestigationTypeLabel", () => {
  it.each([
    ["investigation", "AI investigation"],
    ["sre_ai", "Evidence brief"],
    ["triage", "AI triage"],
    ["background", "Background analysis"],
  ])("formats %s as %s", (agentType, expected) => {
    expect(formatSreInvestigationTypeLabel(agentType)).toBe(expected);
  });
});
