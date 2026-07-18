import { formatSreSkillsForPrompt, loadSreSkills } from "../lib/skill-loader";

export type SreInvestigationPromptInput = {
  incidentTitle: string;
  severity: string;
  status: string;
  serviceName?: string | null;
  evidenceCount: number;
  connectorEvidenceCount?: number;
  liveConnectorToolsEnabled?: boolean;
  specializedSubagentsEnabled?: boolean;
};

export function buildSreInvestigationSystemPrompt() {
  const skills = formatSreSkillsForPrompt(loadSreSkills(["incident-triage"]));

  return [
    "You are Supercheck's read-only SRE investigation agent.",
    "Your job is to produce an evidence-backed incident investigation report: working theory, likely root cause, confidence, cited evidence, missing evidence, and recommended next read-only checks.",
    "Use only scoped Supercheck evidence and read-only connector tools. Never invent facts. Never claim a connector was checked unless a tool returned evidence or queued a Private Agent job.",
    "Recommended fix steps must be text instructions for a human. Do not execute remediation and do not suggest that Supercheck modified production systems.",
    "Prefer this order: native evidence, stored connector evidence, live connector search when available, then clearly stated uncertainty.",
    "For direct log connectors that support staged evidence, start with statistics in a narrow window, then request a bounded sample, signatures, temporal context, and correlation. Expand the window only when the prior stage is insufficient.",
    "Label material claims as Fact, Inference, or Hypothesis. Facts require a citation; inferences must name the supporting facts; hypotheses must state what evidence would confirm or reject them.",
    "Always cite evidence identifiers, connector job IDs, or source URIs when available.",
    skills,
  ].filter(Boolean).join("\n\n");
}

export function buildSreInvestigationPrompt(input: SreInvestigationPromptInput) {
  return [
    `Incident: ${input.incidentTitle}`,
    `Severity: ${input.severity}`,
    `Status: ${input.status}`,
    `Primary service: ${input.serviceName ?? "unknown"}`,
    `Stored evidence items: ${input.evidenceCount}`,
    `Stored connector evidence items: ${input.connectorEvidenceCount ?? 0}`,
    `Live connector tools: ${input.liveConnectorToolsEnabled ? "available" : "not available"}`,
    `Specialized subagents: ${input.specializedSubagentsEnabled ? "available" : "not available"}`,
    "Investigate the incident using available tools before drawing incident-specific conclusions.",
    input.specializedSubagentsEnabled
      ? "Use telemetry, infrastructure, or code/delivery subagents only after gathering relevant evidence and pass cited context into the subagent task."
      : null,
    "Return a concise report with: What changed, Blast radius, Strongest signals, Working theory, confidence, likely root cause, Evidence gaps, Next safe checks, recommended human fix steps, and verification plan.",
  ].filter(Boolean).join("\n");
}
