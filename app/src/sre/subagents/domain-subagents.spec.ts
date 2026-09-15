import { buildSreDomainSubagentSystemPrompt, createSreInvestigationSubagentTools } from "./domain-subagents";

describe("SRE domain subagents", () => {
  it("builds strict read-only prompts that require cited evidence", () => {
    const system = buildSreDomainSubagentSystemPrompt({
      domain: "telemetry",
      toolName: "telemetryInvestigator",
      title: "Telemetry subagent",
      description: "Analyze telemetry context.",
      focus: ["Prometheus evidence", "monitor latency"],
    });

    expect(system).toContain("read-only");
    expect(system).toContain("You do not call external systems yourself");
    expect(system).toContain("Never invent facts");
    expect(system).toContain("Cite evidence IDs");
    expect(system).toContain("Prometheus evidence");
  });

  it("creates telemetry, infrastructure, and code delivery subagent tools", () => {
    const tools = createSreInvestigationSubagentTools({ validateConfiguration: false });

    expect(Object.keys(tools).sort()).toEqual([
      "codeDeliveryInvestigator",
      "infrastructureInvestigator",
      "telemetryInvestigator",
    ]);
    expect(tools.telemetryInvestigator).toMatchObject({ description: expect.stringContaining("metrics") });
    expect(tools.infrastructureInvestigator).toMatchObject({ description: expect.stringContaining("Kubernetes") });
    expect(tools.codeDeliveryInvestigator).toMatchObject({ description: expect.stringContaining("GitHub") });
  });
});
