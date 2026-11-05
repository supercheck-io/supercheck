import { describeEvidenceBrief } from "./evidence-brief-summary";

describe("describeEvidenceBrief", () => {
  it("summarises the brief fields", () => {
    expect(describeEvidenceBrief({ suspectedFailureDomain: "deploy", evidenceCount: 1, confidenceScore: 0.5 })).toBe(
      "1 evidence item reviewed; suspected failure domain: deploy; confidence 50%.",
    );
  });
  it("falls back when fields are missing", () => {
    expect(describeEvidenceBrief({})).toBe("Evidence brief generated.");
  });
});
