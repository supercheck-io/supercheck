import {
  isSreEnabled,
  isSreTriageAgentEnabled,
  isSreInvestigationAgentEnabled,
  isSreAutomaticTriageEnabled,
  isSreBackgroundAlertTriageEnabled,
  isSreAgentSandboxEnabled,
  isSreAlertCorrelationEnabled,
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

  it("enables manual SRE workflows and keeps automation off by default", () => {
    expect(isSreEnabled()).toBe(true);
    expect(isSreTriageAgentEnabled()).toBe(true);
    expect(isSreInvestigationAgentEnabled()).toBe(true);
    expect(isSreAutomaticTriageEnabled()).toBe(false);
    expect(isSreBackgroundAlertTriageEnabled()).toBe(false);
    expect(isSreAlertCorrelationEnabled()).toBe(true);
    expect(isSreAgentSandboxEnabled()).toBe(false);
  });

  it.each(["true", "1", " TRUE "])("enables automation only when opted in: %s", (value) => {
    process.env.SRE_AUTOMATION_ENABLED = value;
    expect(isSreAutomaticTriageEnabled()).toBe(true);
    expect(isSreBackgroundAlertTriageEnabled()).toBe(true);
  });

  it.each(["", "false", "0", "yes", "enabled"])("keeps automation off for %j", (value) => {
    process.env.SRE_AUTOMATION_ENABLED = value;
    expect(isSreAutomaticTriageEnabled()).toBe(false);
    expect(isSreBackgroundAlertTriageEnabled()).toBe(false);
    expect(isSreTriageAgentEnabled()).toBe(true);
  });

  it.each(["false", "0", " FALSE "])("disables all AI workflows: %s", (value) => {
    process.env.SRE_ENABLED = value;
    process.env.SRE_AUTOMATION_ENABLED = "true";
    expect(isSreEnabled()).toBe(false);
    expect(isSreTriageAgentEnabled()).toBe(false);
    expect(isSreInvestigationAgentEnabled()).toBe(false);
    expect(isSreAutomaticTriageEnabled()).toBe(false);
    expect(isSreBackgroundAlertTriageEnabled()).toBe(false);
    expect(isSreAlertCorrelationEnabled()).toBe(false);
  });
});
