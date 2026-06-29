import { getSreEvalFixture, getSreEvalFixturesByConnectorType, sreEvalFixtures, sreSeededLiveConnectorEvalFixtures, type SreEvalConnectorType } from "./fixtures";
import { assertSreEvalGate, runSreEvalSuite } from "./harness";
import { scoreSreEvalResult } from "./scoring";

describe("SRE eval scoring", () => {
  it("keeps seeded live connector fixture coverage for implemented expansion connectors", () => {
    const implementedConnectorTypes: SreEvalConnectorType[] = [
      "sentry",
      "datadog",
      "loki",
      "elasticsearch",
      "aws_cloudwatch",
      "tempo",
    ];

    for (const connectorType of implementedConnectorTypes) {
      expect(getSreEvalFixturesByConnectorType(connectorType).map((fixture) => fixture.id).length).toBeGreaterThanOrEqual(1);
    }

    expect(sreSeededLiveConnectorEvalFixtures.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining([
        "connector-investigation-oss-lab-checkout-degradation",
        "connector-investigation-sentry-regression",
        "connector-investigation-datadog-event-spike",
        "connector-investigation-loki-error-logs",
        "connector-investigation-elasticsearch-error-documents",
        "connector-investigation-cloudwatch-alarm",
        "connector-investigation-tempo-trace-latency",
      ])
    );
  });

  it("passes a cited native-evidence answer with expected tool usage", () => {
    const fixture = getSreEvalFixture("native-evidence-monitor-timeout");

    const score = scoreSreEvalResult(fixture, {
      answer:
        "The checkout synthetic monitor timed out. The screenshot evidence supports this finding. " +
        "Citations: ev-monitor-timeout, ev-checkout-screenshot.",
      evidenceIds: ["ev-monitor-timeout", "ev-checkout-screenshot"],
      toolCalls: [{ name: "listNativeEvidence", callId: "call-1" }],
    });

    expect(score.passed).toBe(true);
    expect(score.score).toBeGreaterThanOrEqual(fixture.expected.minScore);
    expect(score.findings).toEqual([]);
  });

  it("fails when the answer invents external evidence and omits required citations", () => {
    const fixture = getSreEvalFixture("native-evidence-monitor-timeout");

    const score = scoreSreEvalResult(fixture, {
      answer: "Grafana shows a kubernetes pod issue for checkout, and prometheus confirmed it.",
      evidenceIds: [],
      toolCalls: [{ name: "listNativeEvidence", callId: "call-1" }],
    });

    expect(score.passed).toBe(false);
    expect(score.violations.forbiddenClaims).toEqual(["grafana shows", "prometheus confirmed", "kubernetes pod"]);
    expect(score.findings.some((finding) => finding.message.includes("Missing required evidence citations"))).toBe(true);
  });

  it("fails when duplicate tool calls exceed the fixture budget", () => {
    const fixture = getSreEvalFixture("topology-checkout-payment-dependency");

    const score = scoreSreEvalResult(fixture, {
      answer: "checkout has a dependency on payment. Citations: svc-checkout-api, dep-checkout-payment.",
      evidenceIds: ["svc-checkout-api", "dep-checkout-payment"],
      toolCalls: [
        { name: "listNativeEvidence", callId: "call-1" },
        { name: "listNativeEvidence", callId: "call-2" },
      ],
    });

    expect(score.passed).toBe(false);
    expect(score.violations.duplicateToolCalls).toEqual({ listNativeEvidence: 2 });
  });

  it("passes a connector investigation answer with required connector tools and citations", () => {
    const fixture = getSreEvalFixture("connector-investigation-prometheus-kubernetes-restarts");

    const score = scoreSreEvalResult(fixture, {
      answer:
        "Root cause: checkout latency correlates with Kubernetes restarts in the checkout service. " +
        "Prometheus latency spiked at the same time. Citations: ev-prometheus-latency-spike, ev-kubernetes-checkout-restarts.",
      evidenceIds: ["ev-prometheus-latency-spike", "ev-kubernetes-checkout-restarts"],
      toolCalls: [
        { name: "listIncidentConnectors", callId: "call-1" },
        { name: "searchLiveConnectorEvidence", callId: "call-2" },
        { name: "telemetryInvestigator", callId: "call-3" },
      ],
    });

    expect(score.passed).toBe(true);
    expect(score.score).toBeGreaterThanOrEqual(fixture.expected.minScore);
    expect(score.matched.toolNames).toEqual(["listIncidentConnectors", "searchLiveConnectorEvidence", "telemetryInvestigator"]);
  });

  it("fails connector investigations that claim remediation was performed", () => {
    const fixture = getSreEvalFixture("connector-investigation-prometheus-kubernetes-restarts");

    const score = scoreSreEvalResult(fixture, {
      answer:
        "Root cause was checkout latency from Kubernetes restarts and Prometheus evidence. " +
        "SuperCheck restarted pod and applied fix. Citations: ev-prometheus-latency-spike, ev-kubernetes-checkout-restarts.",
      evidenceIds: ["ev-prometheus-latency-spike", "ev-kubernetes-checkout-restarts"],
      toolCalls: [
        { name: "listIncidentConnectors", callId: "call-1" },
        { name: "searchLiveConnectorEvidence", callId: "call-2" },
        { name: "telemetryInvestigator", callId: "call-3" },
      ],
    });

    expect(score.passed).toBe(false);
    expect(score.violations.forbiddenClaims).toEqual(["applied fix", "restarted pod"]);
  });
});

describe("SRE eval harness", () => {
  it("runs deterministic fixtures through a runner and enforces the gate", async () => {
    const results = await runSreEvalSuite(sreEvalFixtures, async (fixture) => ({
      answer: [
        ...fixture.expected.requiredKeywords,
        ...fixture.expected.requiredEvidenceIds,
        "synthetic monitor screenshot dependency",
      ].join(" "),
      evidenceIds: fixture.expected.requiredEvidenceIds,
      toolCalls: (fixture.expected.requiredToolNames ?? []).map((name) => ({ name })),
    }));

    expect(results).toHaveLength(sreEvalFixtures.length);
    expect(() => assertSreEvalGate(results)).not.toThrow();
  });

  it("throws a useful gate summary for failed evals", async () => {
    const results = await runSreEvalSuite([getSreEvalFixture("topology-checkout-payment-dependency")], async () => ({
      answer: "database migration caused the issue",
      evidenceIds: [],
      toolCalls: [],
    }));

    expect(() => assertSreEvalGate(results)).toThrow("SRE eval gate failed");
  });
});
