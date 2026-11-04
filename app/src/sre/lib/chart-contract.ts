/**
 * The inline chart contract shared by both Copilot chat routes (prompt text) and
 * the message renderer (limits), so the model is told what the UI will accept.
 */
export const SRE_CHART_TYPES = ["bar", "line", "area"] as const;

export const SRE_CHART_LIMITS = {
  maxSeries: 4,
  maxRows: 48,
  maxSources: 3,
  maxEvidenceIdsPerSource: 4,
} as const;

export const SRE_CHART_SAMPLE_JSON =
  '{"type":"line","title":"Short title","description":"Optional one-sentence context","sources":[{"label":"Prometheus","type":"prometheus","evidenceIds":["ev-123"],"query":"rate(http_requests_total[5m])"}],"xKey":"label","series":[{"key":"value","label":"Value"}],"data":[{"label":"api","value":12}]}';

/** Prompt lines describing the contract; callers add their own list prefix. */
export const SRE_CHART_PROMPT_LINES = [
  "When a small numeric summary is clearer as a chart and real values are available, include a fenced `chart` JSON block with this exact shape:",
  SRE_CHART_SAMPLE_JSON,
  `Supported chart types are ${SRE_CHART_TYPES.slice(0, -1).join(", ")}, and ${SRE_CHART_TYPES[SRE_CHART_TYPES.length - 1]}, with at most ${SRE_CHART_LIMITS.maxSeries} series and ${SRE_CHART_LIMITS.maxRows} data rows; series values must be numbers. Use only real values already present in evidence, the conversation, or the user request; do not fabricate chart data.`,
  "Include chart sources when values come from evidence, connectors, or user-provided data. Source labels must be non-secret names such as Prometheus, Grafana, Kubernetes, or Generated preview data.",
] as const;
