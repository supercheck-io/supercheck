import { buildSreTriagePrompt, buildSreTriageSystemPrompt } from "./triage";

describe("SRE triage prompt", () => {
  it("builds read-only triage instructions with skill content", () => {
    const system = buildSreTriageSystemPrompt();
    const prompt = buildSreTriagePrompt({
      incidentTitle: "checkout latency",
      severity: "sev2",
      serviceName: "checkout-api",
      evidenceCount: 3,
      connectorEvidenceCount: 1,
    });

    expect(system).toContain("read-only SRE triage agent");
    expect(system).toContain("Never suggest executing shell commands");
    expect(system).toContain("never infer a label selector");
    expect(system).toContain("query * for a bounded pod list");
    expect(system).toContain("Never send a Kubernetes selector as PromQL");
    expect(system).toContain("Query a failed connector at most once");
    expect(system).toContain("Always return a non-empty answer");
    expect(prompt).toContain("checkout latency");
    expect(prompt).toContain("Connector evidence items: 1");
  });
});
