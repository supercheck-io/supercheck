import { generateText, streamText } from "ai";

import { checkSreDailyTokenLimit, recordSreTokenUsage } from "@/lib/sre/sre-daily-token-limit";
import { generateEvidenceBrief, streamEvidenceBrief } from "./evidence-brief-generator";

jest.mock("@/lib/sre/sre-daily-token-limit", () => ({
  checkSreDailyTokenLimit: jest.fn().mockResolvedValue({ allowed: true, resetTime: 0 }),
  recordSreTokenUsage: jest.fn(),
}));
jest.mock("ai", () => ({ ...jest.requireActual("ai"), generateText: jest.fn(), streamText: jest.fn() }));

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

    const brief = await generateEvidenceBrief({
      incidentTitle: "checkout-api: Monitor Failure",
      incidentSeverity: "sev2",
      userId: "user_1",
      organizationId: "org_1",
      evidence: [
        {
          id: "evidence_1",
          title: "Monitor result: down at local",
          summary:
            "Monitor check was down; response time unknown; consecutive failures 3.",
          evidenceType: "metric",
          severity: "sev2",
          confidence: "0.85",
          sourceUri: "/monitors/monitor_1?result=result_1",
          rawContentExcerpt: '{"status":"down"}',
          observedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });

    expect(brief.provider).toBe("fallback");
    expect(brief.citedEvidenceIds).toEqual(["evidence_1"]);
    expect(brief.confidenceScore).toBe(0.85);
    expect(brief.summary).toContain("AI brief generation was unavailable");
  });

  it("does not tell an already mapped incident to add service mapping when evidence is absent", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "";

    const brief = await generateEvidenceBrief({
      incidentTitle: "checkout-api: controlled acceptance test",
      incidentSeverity: "sev3",
      userId: "user_1",
      organizationId: "org_1",
      evidence: [],
    });

    expect(brief.summary).toContain(
      "Link a relevant monitor, job, run, alert, or connector evidence source.",
    );
    expect(brief.summary).not.toContain("mapped to a service");
  });

  it("serves the deterministic brief without calling the model over the daily limit", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    jest.mocked(checkSreDailyTokenLimit).mockResolvedValueOnce({ allowed: false, resetTime: Date.now() + 1000 });

    const brief = await generateEvidenceBrief({
      incidentTitle: "Checkout", incidentSeverity: "sev2", userId: "u", organizationId: "org-a",
      evidence: [{ id: "e1", sourceType: "native", title: "t", summary: "s", evidenceType: "metric", severity: null, confidence: "0.8", sourceUri: null, rawContentExcerpt: null, observedAt: new Date() }] as never,
    });

    expect(brief.provider).toBe("fallback");
    expect(checkSreDailyTokenLimit).toHaveBeenCalledWith("org-a");
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("streamEvidenceBrief", () => {
  const input = {
    incidentTitle: "Checkout", incidentSeverity: "sev2", userId: "u", organizationId: "org-a",
    evidence: [{ id: "e1", title: "t", summary: "s", evidenceType: "metric", severity: null, confidence: "0.8", sourceUri: "x", rawContentExcerpt: null, observedAt: new Date() }],
  };
  beforeEach(() => { process.env.AI_PROVIDER = "openai"; process.env.OPENAI_API_KEY = "test-key"; jest.mocked(recordSreTokenUsage).mockClear(); });

  const mockStream = (opts: { chunks: string[]; error?: unknown }) =>
    jest.mocked(streamText).mockImplementation(((args: { onError: (e: { error: unknown }) => void; onFinish: (e: unknown) => void }) => ({
      textStream: (async function* () {
        yield* opts.chunks;
        if (opts.error) args.onError({ error: opts.error });
      })(),
    })) as never);

  it("fails instead of appending the fallback when the stream errors after output started", async () => {
    mockStream({ chunks: ["partial"], error: new Error("boom") });
    const sent: string[] = [];
    await expect(streamEvidenceBrief(input as never, (c) => { sent.push(c); })).rejects.toThrow("boom");
    expect(sent).toEqual(["partial"]);
  });

  it("falls back when the stream errors before any output", async () => {
    mockStream({ chunks: [], error: new Error("boom") });
    const brief = await streamEvidenceBrief(input as never, () => undefined);
    expect(brief.provider).toBe("fallback");
  });

  it("records usage from the SDK finish and abort callbacks", async () => {
    mockStream({ chunks: ["ok"] });
    await streamEvidenceBrief(input as never, () => undefined);
    const args = jest.mocked(streamText).mock.calls[0][0] as unknown as { onFinish: (e: unknown) => void; onAbort: (e: unknown) => void };
    args.onFinish({ totalUsage: { totalTokens: 10 } });
    args.onAbort({ steps: [{ usage: { totalTokens: 4 } }, { usage: { totalTokens: 3 } }] });
    expect(recordSreTokenUsage).toHaveBeenCalledWith("org-a", { totalTokens: 10 });
    expect(recordSreTokenUsage).toHaveBeenCalledWith("org-a", { totalTokens: 7 });
  });
});
