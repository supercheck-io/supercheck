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
    expect(prompt).toContain("checkout latency");
    expect(prompt).toContain("Connector evidence items: 1");
  });
});
