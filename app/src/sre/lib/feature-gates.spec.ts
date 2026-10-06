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

  it("enables normal and automated SRE workflows by default", () => {
    expect(isSreEnabled()).toBe(true);
    expect(isSreTriageAgentEnabled()).toBe(true);
    expect(isSreInvestigationAgentEnabled()).toBe(true);
    expect(isSreAutomaticTriageEnabled()).toBe(true);
    expect(isSreBackgroundAlertTriageEnabled()).toBe(true);
    expect(isSreAlertCorrelationEnabled()).toBe(true);
    expect(isSreAgentSandboxEnabled()).toBe(false);
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

  it.each(["false", "0", " FALSE "])("can stop automation while allowing manual requests: %s", (value) => {
    process.env.SRE_AUTOMATION_ENABLED = value;
    expect(isSreTriageAgentEnabled()).toBe(true);
    expect(isSreInvestigationAgentEnabled()).toBe(true);
    expect(isSreAutomaticTriageEnabled()).toBe(false);
    expect(isSreBackgroundAlertTriageEnabled()).toBe(false);
  });
});
