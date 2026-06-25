import { buildSreInvestigationPrompt, buildSreInvestigationSystemPrompt } from "./investigator";

describe("SRE investigation prompt", () => {
  it("builds read-only investigation instructions with connector availability", () => {
    const system = buildSreInvestigationSystemPrompt();
    const prompt = buildSreInvestigationPrompt({
      incidentTitle: "checkout latency",
      severity: "sev2",
      status: "investigating",
      serviceName: "checkout-api",
      evidenceCount: 4,
      connectorEvidenceCount: 2,
      liveConnectorToolsEnabled: true,
      specializedSubagentsEnabled: true,
    });

    expect(system).toContain("read-only SRE investigation agent");
    expect(system).toContain("Recommended fix steps must be text instructions");
    expect(system).toContain("Never suggest executing shell commands");
    expect(prompt).toContain("checkout latency");
    expect(prompt).toContain("Live connector tools: available");
    expect(prompt).toContain("Specialized subagents: available");
    expect(prompt).toContain("pass cited context into the subagent task");
    expect(prompt).toContain("verification plan");
  });
});
