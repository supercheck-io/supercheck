function enabledByDefault(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0";
}

function enabledOnlyWhenExplicit(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

export function isSreEnabled() {
  return enabledByDefault(process.env.SRE_ENABLED);
}

export const isSreTriageAgentEnabled = isSreEnabled;
export const isSreInvestigationAgentEnabled = isSreEnabled;
export const isSreAlertCorrelationEnabled = isSreEnabled;

// Automatic triage is opt-in: it only runs when SRE_AUTOMATION_ENABLED is
// explicitly "true" or "1". Keep in sync with
// the AI step of the alert pipeline (the worker gate only needs SRE_ENABLED).
export function isSreAutomaticTriageEnabled() {
  return isSreEnabled() && enabledOnlyWhenExplicit(process.env.SRE_AUTOMATION_ENABLED);
}

// The alert->incident pipeline (queue, processor, incident creation/recovery)
// needs only SRE_ENABLED. Keep in sync with
// worker/src/monitor/services/sre-alert-triage-queue.service.ts. AI triage on
// top of it still needs isSreAutomaticTriageEnabled().
export const isSreBackgroundAlertTriageEnabled = isSreEnabled;

// Internal sandbox infrastructure is separate from normal SRE workflows.
export function isSreAgentSandboxEnabled() {
  return process.env.SRE_AGENT_SANDBOX_ENABLED === "true";
}
