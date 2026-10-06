function enabledByDefault(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0";
}

export function isSreTriageAgentEnabled() {
  return enabledByDefault(process.env.SRE_TRIAGE_AGENT_ENABLED);
}

export function isSreAutomaticTriageEnabled() {
  return isSreTriageAgentEnabled() && process.env.SRE_TRIAGE_AGENT_AUTO_ENABLED === "true";
}

export function isSreBackgroundAlertTriageEnabled() {
  return isSreTriageAgentEnabled() && process.env.SRE_TRIAGE_AGENT_BACKGROUND_ENABLED === "true";
}

export function isSreInvestigationAgentEnabled() {
  return enabledByDefault(process.env.SRE_INVESTIGATION_AGENT_ENABLED);
}

export function isSreAgentSandboxEnabled() {
  return process.env.SRE_AGENT_SANDBOX_ENABLED === "true";
}

export function isSreAlertCorrelationEnabled() {
  return process.env.SRE_ALERT_CORRELATION_ENABLED === "true";
}

export function isSreStagedEvidenceEnabled() {
  return process.env.SRE_STAGED_EVIDENCE_ENABLED === "true";
}
