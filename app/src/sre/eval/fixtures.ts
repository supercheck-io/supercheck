export type SreEvalMilestone = "topology" | "native_evidence" | "connector_investigation";

export type SreEvalFixture = {
  id: string;
  milestone: SreEvalMilestone;
  title: string;
  prompt: string;
  expected: {
    requiredKeywords: string[];
    requiredEvidenceIds: string[];
    requiredToolNames?: string[];
    forbiddenClaims: string[];
    maxDuplicateToolCalls?: number;
    minScore: number;
  };
};

export const sreEvalFixtures: SreEvalFixture[] = [
  {
    id: "topology-checkout-payment-dependency",
    milestone: "topology",
    title: "Checkout depends on payment service",
    prompt: "Identify the affected service and upstream/downstream dependency from the provided service topology evidence.",
    expected: {
      requiredKeywords: ["checkout", "payment", "dependency"],
      requiredEvidenceIds: ["svc-checkout-api", "dep-checkout-payment"],
      requiredToolNames: ["listNativeEvidence"],
      forbiddenClaims: ["database migration", "kubernetes restart", "prometheus confirmed"],
      maxDuplicateToolCalls: 1,
      minScore: 0.82,
    },
  },
  {
    id: "native-evidence-monitor-timeout",
    milestone: "native_evidence",
    title: "Synthetic monitor timeout with screenshot evidence",
    prompt: "Produce a native-evidence incident brief for a checkout synthetic monitor timeout.",
    expected: {
      requiredKeywords: ["timeout", "checkout", "synthetic monitor", "screenshot"],
      requiredEvidenceIds: ["ev-monitor-timeout", "ev-checkout-screenshot"],
      requiredToolNames: ["listNativeEvidence"],
      forbiddenClaims: ["grafana shows", "prometheus confirmed", "kubernetes pod", "applied fix"],
      maxDuplicateToolCalls: 1,
      minScore: 0.85,
    },
  },
  {
    id: "connector-investigation-prometheus-kubernetes-restarts",
    milestone: "connector_investigation",
    title: "Connector RCA from Prometheus latency and Kubernetes restarts",
    prompt:
      "Investigate checkout latency using scoped connector evidence. Identify the most likely root cause, cite connector evidence, and recommend human verification steps.",
    expected: {
      requiredKeywords: ["checkout", "latency", "kubernetes", "restart", "prometheus", "root cause"],
      requiredEvidenceIds: ["ev-prometheus-latency-spike", "ev-kubernetes-checkout-restarts"],
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence", "telemetryInvestigator"],
      forbiddenClaims: ["applied fix", "restarted pod", "scaled deployment", "modified kubernetes", "pushed commit"],
      maxDuplicateToolCalls: 2,
      minScore: 0.88,
    },
  },
];

export function getSreEvalFixture(id: string) {
  const fixture = sreEvalFixtures.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Unknown SRE eval fixture: ${id}`);
  }

  return fixture;
}
