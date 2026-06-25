import type { LanguageModel } from "ai";

import { createSubagentTool } from "@/sre/lib/subagent-factory";
import type { SreAgentBudgetInput } from "@/sre/lib/budget-manager";

export type SreSubagentDomain = "telemetry" | "infrastructure" | "code_delivery";

export type CreateSreInvestigationSubagentToolsInput = {
  budget?: SreAgentBudgetInput;
  model?: LanguageModel;
  validateConfiguration?: boolean;
};

type DomainSubagentConfig = {
  domain: SreSubagentDomain;
  toolName: "telemetryInvestigator" | "infrastructureInvestigator" | "codeDeliveryInvestigator";
  title: string;
  description: string;
  focus: string[];
};

const domainSubagents: DomainSubagentConfig[] = [
  {
    domain: "telemetry",
    toolName: "telemetryInvestigator",
    title: "Telemetry subagent",
    description:
      "Analyze already gathered metrics, dashboards, traces, logs, and monitor evidence for likely incident signals. Use only the context supplied by the main SRE agent.",
    focus: [
      "Prometheus or Grafana evidence returned by read-only connector tools",
      "SuperCheck monitor trends, latency, availability, and threshold breaches",
      "correlation between symptom timing, severity, and affected service",
    ],
  },
  {
    domain: "infrastructure",
    toolName: "infrastructureInvestigator",
    title: "Infrastructure subagent",
    description:
      "Analyze already gathered Kubernetes and infrastructure evidence for read-only incident signals. Use only the context supplied by the main SRE agent.",
    focus: [
      "Kubernetes pod phase, readiness, restarts, scheduling, and namespace evidence",
      "infrastructure dependency symptoms that explain the primary service impact",
      "safe next checks a human or read-only connector query should perform",
    ],
  },
  {
    domain: "code_delivery",
    toolName: "codeDeliveryInvestigator",
    title: "Code and delivery subagent",
    description:
      "Analyze already gathered GitHub, deploy, commit, PR, and job-run evidence for likely delivery-related causes. Use only the context supplied by the main SRE agent.",
    focus: [
      "recent commits, pull requests, deployments, and CI/job failures",
      "temporal correlation between delivery changes and incident start time",
      "rollback or fix recommendations as human-readable instructions only",
    ],
  },
];

export function buildSreDomainSubagentSystemPrompt(config: DomainSubagentConfig) {
  return [
    `You are SuperCheck's ${config.title}.`,
    "You are read-only. You never modify production systems, repositories, Kubernetes resources, dashboards, incidents, or third-party tools.",
    "You do not call external systems yourself. Analyze only the task and context supplied by the main investigation agent.",
    "Never invent facts. If the provided context lacks evidence for a claim, say that the evidence is missing and recommend the next read-only check.",
    "Cite evidence IDs, connector job IDs, source URIs, or exact context labels whenever they are present.",
    "Keep the response concise: domain-specific finding, confidence, supporting evidence, missing evidence, and safe next checks.",
    `Focus areas: ${config.focus.join("; ")}.`,
  ].join("\n");
}

export function createSreInvestigationSubagentTools(input: CreateSreInvestigationSubagentToolsInput = {}) {
  return Object.fromEntries(
    domainSubagents.map((config) => [
      config.toolName,
      createSubagentTool({
        description: config.description,
        system: buildSreDomainSubagentSystemPrompt(config),
        budget: { maxSteps: 1, maxOutputTokens: 700, timeoutMs: 30_000, ...input.budget },
        model: input.model,
        validateConfiguration: input.validateConfiguration,
      }),
    ])
  ) as Record<DomainSubagentConfig["toolName"], ReturnType<typeof createSubagentTool>>;
}
