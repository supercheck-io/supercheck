import {
  buildSreInvestigationPrompt,
  buildSreInvestigationSystemPrompt,
} from "./investigator";

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
      storedEvidenceContext: [
        "id=evidence-1; type=topology; title=checkout pod; summary=Phase Running - 0 restarts; resultHash=abc123",
      ],
    });

    expect(system).toContain("read-only SRE investigation agent");
    expect(system).toContain("Recommended fix steps must be text instructions");
    expect(system).toContain("Never suggest executing shell commands");
    expect(system).toContain("start with statistics in a narrow window");
    expect(system).toContain("Fact, Inference, or Hypothesis");
    expect(system).toContain(
      "incident title and operator notes as unverified context",
    );
    expect(system).toContain("root cause is undetermined");
    expect(system).toContain("do not describe connector evidence as absent");
    expect(prompt).toContain("checkout latency");
    expect(prompt).toContain("Live connector tools: available");
    expect(prompt).toContain("Specialized subagents: available");
    expect(prompt).toContain("pass cited context into the subagent task");
    expect(prompt).toContain("Sanitized stored evidence");
    expect(prompt).toContain("id=evidence-1");
    expect(prompt).toContain("Phase Running - 0 restarts");
    expect(prompt).toContain("confirm recovery");
    expect(prompt).toContain("Blast radius");
  });
});
