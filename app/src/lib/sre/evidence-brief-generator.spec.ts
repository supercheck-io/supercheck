import { generateEvidenceBrief } from "./evidence-brief-generator";

describe("generateEvidenceBrief", () => {
  const originalProvider = process.env.AI_PROVIDER;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = originalProvider;
    }

    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  it("falls back to a deterministic brief when AI is not configured", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "";
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const brief = await generateEvidenceBrief({
      incidentTitle: "checkout-api: Monitor Failure",
      incidentSeverity: "sev2",
      userId: "user_1",
      organizationId: "org_1",
      evidence: [
        {
          id: "evidence_1",
          title: "Monitor result: down at local",
          summary: "Monitor check was down; response time unknown; consecutive failures 3.",
          evidenceType: "metric",
          severity: "sev2",
          confidence: "0.85",
          sourceUri: "/monitors/monitor_1?result=result_1",
          rawContentExcerpt: "{\"status\":\"down\"}",
          observedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });

    expect(brief.provider).toBe("fallback");
    expect(brief.citedEvidenceIds).toEqual(["evidence_1"]);
    expect(brief.confidenceScore).toBe(0.85);
    expect(brief.summary).toContain("AI brief generation was unavailable");
    warnSpy.mockRestore();
  });
});
