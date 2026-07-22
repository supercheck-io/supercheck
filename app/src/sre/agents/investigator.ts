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
  storedEvidenceContext?: string[];
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
    "Treat the incident title and operator notes as unverified context, not evidence. Never infer a component failure merely because its name appears in the title.",
    "When the available evidence only establishes healthy resources, state that the root cause is undetermined and identify the missing signal. Do not invent a failure in the service, connector, or Private Agent.",
    "If stored connector evidence is present, do not describe connector evidence as absent. Distinguish healthy topology evidence from the missing logs, metrics, traces, or alerts needed to explain the incident.",
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
    input.storedEvidenceContext?.length
      ? [
          "Sanitized stored evidence (cite these identifiers for factual claims):",
          ...input.storedEvidenceContext.map((item) => `- ${item}`),
        ].join("\n")
      : "Sanitized stored evidence: none available",
    "Investigate the incident using available tools before drawing incident-specific conclusions.",
    input.specializedSubagentsEnabled
      ? "Use telemetry, infrastructure, or code/delivery subagents only after gathering relevant evidence and pass cited context into the subagent task."
      : null,
    "Return a concise report with: What changed, Blast radius, Strongest signals, Working theory, confidence, likely root cause, Evidence gaps, Next safe checks, recommended human fix steps, and verification plan.",
  ].filter(Boolean).join("\n");
}
