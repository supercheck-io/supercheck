import {
  isSreTriageAgentEnabled,
  isSreInvestigationAgentEnabled,
  isSreAutomaticTriageEnabled,
  isSreBackgroundAlertTriageEnabled,
  isSreAgentSandboxEnabled,
  isSreAlertCorrelationEnabled,
  isSreStagedEvidenceEnabled,
} from "./feature-gates";

describe("AI SRE feature defaults", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SRE_")) delete process.env[key];
    }
  });
  afterEach(() => { process.env = originalEnv; });

  it("enables manual workflows while keeping automatic and infrastructure workflows opt-in", () => {
    expect(isSreTriageAgentEnabled()).toBe(true);
    expect(isSreInvestigationAgentEnabled()).toBe(true);
    expect(isSreAutomaticTriageEnabled()).toBe(false);
    expect(isSreBackgroundAlertTriageEnabled()).toBe(false);
    expect(isSreAgentSandboxEnabled()).toBe(false);
    expect(isSreAlertCorrelationEnabled()).toBe(false);
    expect(isSreStagedEvidenceEnabled()).toBe(false);
  });

  it.each(["false", "0", " FALSE "])("honors manual workflow opt-outs: %s", (value) => {
    process.env.SRE_TRIAGE_AGENT_ENABLED = value;
    process.env.SRE_INVESTIGATION_AGENT_ENABLED = value;
    process.env.SRE_TRIAGE_AGENT_AUTO_ENABLED = "true";
    process.env.SRE_TRIAGE_AGENT_BACKGROUND_ENABLED = "true";
    expect(isSreTriageAgentEnabled()).toBe(false);
    expect(isSreInvestigationAgentEnabled()).toBe(false);
    expect(isSreAutomaticTriageEnabled()).toBe(false);
    expect(isSreBackgroundAlertTriageEnabled()).toBe(false);
  });

  it("allows automatic workflows only when explicitly enabled", () => {
    process.env.SRE_TRIAGE_AGENT_AUTO_ENABLED = "true";
    process.env.SRE_TRIAGE_AGENT_BACKGROUND_ENABLED = "true";
    expect(isSreAutomaticTriageEnabled()).toBe(true);
    expect(isSreBackgroundAlertTriageEnabled()).toBe(true);
  });
});
