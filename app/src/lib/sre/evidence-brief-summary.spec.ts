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
  it("keeps zero values and drops non-finite confidence", () => {
    expect(describeEvidenceBrief({ evidenceCount: 0, confidenceScore: 0 })).toBe("0 evidence items reviewed; confidence 0%.");
    expect(describeEvidenceBrief({ evidenceCount: 2, confidenceScore: NaN })).toBe("2 evidence items reviewed.");
    expect(describeEvidenceBrief({ evidenceCount: 2, confidenceScore: Infinity })).toBe("2 evidence items reviewed.");
  });
});
