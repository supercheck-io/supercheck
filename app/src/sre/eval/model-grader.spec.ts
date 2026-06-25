import { generateText, type LanguageModel } from "ai";

import { getSreEvalFixture } from "./fixtures";
import { buildSreEvalModelGraderPrompt, gradeSreEvalResultWithModel } from "./model-grader";
import { scoreSreEvalResult } from "./scoring";

jest.mock("ai", () => ({
  ...jest.requireActual("ai"),
  generateText: jest.fn(),
}));

const mockGenerateText = generateText as jest.MockedFunction<typeof generateText>;
const mockModel = {} as LanguageModel;

describe("SRE eval model grader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds a bounded redacted grading prompt", () => {
    const fixture = getSreEvalFixture("connector-investigation-prometheus-kubernetes-restarts");
    const agentResult = {
      answer:
        "Root cause uses token=secret-value and Authorization: Bearer abc123. " +
        "Citations: ev-prometheus-latency-spike, ev-kubernetes-checkout-restarts.",
      evidenceIds: ["ev-prometheus-latency-spike", "ev-kubernetes-checkout-restarts"],
      toolCalls: [{ name: "searchLiveConnectorEvidence" }],
    };
    const prompt = buildSreEvalModelGraderPrompt({
      fixture,
      agentResult,
      deterministicScore: scoreSreEvalResult(fixture, agentResult),
    });

    expect(prompt).toContain("Grade this SuperCheck SRE investigation eval result");
    expect(prompt).not.toContain("secret-value");
    expect(prompt).not.toContain("abc123");
    expect(prompt.length).toBeLessThanOrEqual(12_000);
  });

  it("returns a validated model grade from strict JSON", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        score: 0.93,
        passed: true,
        confidence: "high",
        findings: ["Cites required connector evidence"],
        rationale: "The answer cites Prometheus and Kubernetes evidence and avoids remediation claims.",
      }),
      finishReason: "stop",
    } as Awaited<ReturnType<typeof generateText>>);
    const fixture = getSreEvalFixture("connector-investigation-prometheus-kubernetes-restarts");
    const agentResult = {
      answer:
        "Root cause: checkout latency correlates with Kubernetes restarts and Prometheus latency. " +
        "Citations: ev-prometheus-latency-spike, ev-kubernetes-checkout-restarts.",
      evidenceIds: ["ev-prometheus-latency-spike", "ev-kubernetes-checkout-restarts"],
      toolCalls: [
        { name: "listIncidentConnectors" },
        { name: "searchLiveConnectorEvidence" },
        { name: "telemetryInvestigator" },
      ],
    };

    const grade = await gradeSreEvalResultWithModel({
      fixture,
      agentResult,
      deterministicScore: scoreSreEvalResult(fixture, agentResult),
      evaluatedModelId: "investigator-model",
      graderModelId: "independent-grader-model",
      model: mockModel,
      validateConfiguration: false,
    });

    expect(grade).toMatchObject({ score: 0.93, passed: true, confidence: "high", modelId: "independent-grader-model" });
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({ model: mockModel, maxOutputTokens: 800 }));
  });

  it("requires a different grader model unless explicitly allowed", async () => {
    const fixture = getSreEvalFixture("native-evidence-monitor-timeout");
    const agentResult = {
      answer: "checkout synthetic monitor timeout. Citations: ev-monitor-timeout, ev-checkout-screenshot.",
      evidenceIds: ["ev-monitor-timeout", "ev-checkout-screenshot"],
      toolCalls: [{ name: "listNativeEvidence" }],
    };

    await expect(
      gradeSreEvalResultWithModel({
        fixture,
        agentResult,
        deterministicScore: scoreSreEvalResult(fixture, agentResult),
        evaluatedModelId: "same-model",
        graderModelId: "same-model",
        model: mockModel,
        validateConfiguration: false,
      })
    ).rejects.toThrow("SRE eval model grader must use a different model from the evaluated model");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });
});
