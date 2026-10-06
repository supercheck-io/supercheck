function enabledByDefault(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0";
}

export function isSreEnabled() {
  return enabledByDefault(process.env.SRE_ENABLED);
}

export const isSreTriageAgentEnabled = isSreEnabled;
export const isSreInvestigationAgentEnabled = isSreEnabled;
export const isSreAlertCorrelationEnabled = isSreEnabled;

export function isSreAutomaticTriageEnabled() {
  return isSreEnabled() && enabledByDefault(process.env.SRE_AUTOMATION_ENABLED);
}

export const isSreBackgroundAlertTriageEnabled = isSreAutomaticTriageEnabled;

// Internal sandbox infrastructure is separate from normal SRE workflows.
export function isSreAgentSandboxEnabled() {
  return process.env.SRE_AGENT_SANDBOX_ENABLED === "true";
}
