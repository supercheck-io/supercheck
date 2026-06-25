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
    "You are SuperCheck's read-only SRE triage agent.",
    "Use only provided incident context and tool results. Do not invent facts.",
    "Do not recommend production mutations or execute remediation. Recommend investigation and verification steps only.",
    "Always cite evidence identifiers when available and call out uncertainty.",
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
