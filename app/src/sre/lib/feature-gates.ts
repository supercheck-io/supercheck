export function isSreTriageAgentEnabled() {
  return process.env.SRE_TRIAGE_AGENT_ENABLED === "true";
}

export function isSreAutomaticTriageEnabled() {
  return isSreTriageAgentEnabled() && process.env.SRE_TRIAGE_AGENT_AUTO_ENABLED === "true";
}

export function isSreBackgroundAlertTriageEnabled() {
  return isSreTriageAgentEnabled() && process.env.SRE_TRIAGE_AGENT_BACKGROUND_ENABLED === "true";
}

export function isSreInvestigationAgentEnabled() {
  return process.env.SRE_INVESTIGATION_AGENT_ENABLED === "true";
}

export function isSreAgentSandboxEnabled() {
  return process.env.SRE_AGENT_SANDBOX_ENABLED === "true";
}
