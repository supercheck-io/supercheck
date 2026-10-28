import {
  isSreEnabled,
  isSreTriageAgentEnabled,
  isSreInvestigationAgentEnabled,
  isSreAutomaticTriageEnabled,
  isSreBackgroundAlertTriageEnabled,
  isSreAgentSandboxEnabled,
  isSreAlertCorrelationEnabled,
} from "./feature-gates";

// AI triage gate (app only). The incident pipeline gate is SRE_ENABLED alone and is
// mirrored in worker/src/monitor/services/sre-alert-triage-queue.service.spec.ts.
// [SRE_ENABLED, SRE_AUTOMATION_ENABLED, automatic triage enabled]
const AUTOMATION_GATE_CONTRACT: Array<[string | undefined, string | undefined, boolean]> = [
  [undefined, undefined, false],
  [undefined, "true", true],
  [undefined, "1", true],
  [undefined, " TRUE ", true],
  [undefined, "yes", false],
  [undefined, "false", false],
  ["true", "true", true],
  ["false", "true", false],
  ["0", "1", false],
  [" FALSE ", "true", false],
  ["", "true", true],
];

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
    // Incident pipeline is on by default; only AI triage is opt-in.
    expect(isSreBackgroundAlertTriageEnabled()).toBe(true);
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
    expect(isSreBackgroundAlertTriageEnabled()).toBe(true);
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

  it.each([[undefined, true], ["false", false], ["0", false], [" FALSE ", false], ["", true]] as Array<[string | undefined, boolean]>)(
    "incident pipeline gate depends only on SRE_ENABLED=%j -> %s",
    (sre, expected) => {
      if (sre !== undefined) process.env.SRE_ENABLED = sre;
      expect(isSreBackgroundAlertTriageEnabled()).toBe(expected);
    },
  );

  it.each(AUTOMATION_GATE_CONTRACT)("automation gate contract: SRE_ENABLED=%j SRE_AUTOMATION_ENABLED=%j -> %s", (sre, automation, expected) => {
    if (sre !== undefined) process.env.SRE_ENABLED = sre;
    if (automation !== undefined) process.env.SRE_AUTOMATION_ENABLED = automation;
    expect(isSreAutomaticTriageEnabled()).toBe(expected);
  });
});
