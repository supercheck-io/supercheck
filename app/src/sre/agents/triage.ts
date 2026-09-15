import { formatSreSkillsForPrompt, loadSreSkills } from "../lib/skill-loader";

export type SreTriagePromptInput = {
  incidentTitle: string;
  severity: string;
  serviceName?: string | null;
  evidenceCount: number;
  connectorEvidenceCount?: number;
};

export function buildSreTriageSystemPrompt() {
  const skills = formatSreSkillsForPrompt(loadSreSkills(["incident-triage"]));

  return [
    "You are Supercheck's read-only SRE triage agent.",
    "Use only provided incident context and tool results. Do not invent facts.",
    "Do not recommend production mutations or execute remediation. Recommend investigation and verification steps only.",
    "Always cite evidence identifiers when available and call out uncertainty.",
    "For Kubernetes, never infer a label selector from an incident title or service name. If the namespace is known but no label mapping has been verified by evidence or a tool result, query * for a bounded pod list and match returned pod names before using a selector.",
    "Use each connector's queryGuidance and native query language. Never send a Kubernetes selector as PromQL or LogQL.",
    "A connector response marked error, failed, or queued without evidence is not evidence. Query a failed connector at most once during this run unless the response explicitly says it is retryable; use another source or report the connector failure and evidence gap.",
    "Always return a non-empty answer. If connector checks fail, name the failed source and what could not be verified instead of ending on tool calls.",
    skills,
  ].filter(Boolean).join("\n\n");
}

export function buildSreTriagePrompt(input: SreTriagePromptInput) {
  return [
    `Incident: ${input.incidentTitle}`,
    `Severity: ${input.severity}`,
    `Primary service: ${input.serviceName ?? "unknown"}`,
    `Stored evidence items: ${input.evidenceCount}`,
    `Connector evidence items: ${input.connectorEvidenceCount ?? 0}`,
    "Return: initial classification, likely failure domains, confidence, missing evidence, and next read-only checks.",
  ].join("\n");
}
