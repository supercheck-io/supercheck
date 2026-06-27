export type SreEvalMilestone = "topology" | "native_evidence" | "connector_investigation";
export type SreEvalConnectorType =
  | "prometheus"
  | "kubernetes"
  | "sentry"
  | "datadog"
  | "loki"
  | "elasticsearch"
  | "aws_cloudwatch"
  | "tempo";

export type SreEvalFixture = {
  id: string;
  milestone: SreEvalMilestone;
  title: string;
  prompt: string;
  seededLive?: {
    connectorTypes: SreEvalConnectorType[];
    requiredSeedData: string[];
  };
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
  {
    id: "connector-investigation-sentry-regression",
    milestone: "connector_investigation",
    title: "Sentry regression evidence identifies checkout exception spike",
    prompt:
      "Investigate a checkout incident using Sentry connector evidence. Identify the likely exception regression, cite Sentry issue evidence, and avoid claiming remediation.",
    seededLive: {
      connectorTypes: ["sentry"],
      requiredSeedData: [
        "A seeded unresolved Sentry issue for checkout-api with error-level severity",
        "Issue title or culprit containing checkout and timeout or exception context",
      ],
    },
    expected: {
      requiredKeywords: ["checkout", "sentry", "exception", "regression", "root cause"],
      requiredEvidenceIds: ["ev-sentry-checkout-exception"],
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence", "telemetryInvestigator"],
      forbiddenClaims: ["applied fix", "resolved issue", "ignored sentry alert", "changed release"],
      maxDuplicateToolCalls: 2,
      minScore: 0.86,
    },
  },
  {
    id: "connector-investigation-datadog-event-spike",
    milestone: "connector_investigation",
    title: "Datadog event evidence correlates deployment with latency spike",
    prompt:
      "Use Datadog connector evidence to investigate checkout latency. Correlate events with the incident window and recommend human verification steps.",
    seededLive: {
      connectorTypes: ["datadog"],
      requiredSeedData: [
        "A seeded Datadog event tagged service:checkout during the incident window",
        "Event text indicating latency, deploy, error spike, or monitor alert context",
      ],
    },
    expected: {
      requiredKeywords: ["checkout", "datadog", "event", "latency", "deployment"],
      requiredEvidenceIds: ["ev-datadog-checkout-latency-event"],
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence", "telemetryInvestigator"],
      forbiddenClaims: ["rolled back deployment", "muted monitor", "applied fix", "changed datadog"],
      maxDuplicateToolCalls: 2,
      minScore: 0.86,
    },
  },
  {
    id: "connector-investigation-loki-error-logs",
    milestone: "connector_investigation",
    title: "Loki log evidence identifies upstream checkout errors",
    prompt:
      "Investigate checkout failures with Loki connector evidence. Identify the relevant log pattern, cite log evidence, and distinguish evidence from speculation.",
    seededLive: {
      connectorTypes: ["loki"],
      requiredSeedData: [
        "Seeded Loki stream labels for service=checkout or app=checkout",
        "Error log line mentioning upstream timeout, 5xx, or dependency failure",
      ],
    },
    expected: {
      requiredKeywords: ["checkout", "loki", "log", "error", "upstream"],
      requiredEvidenceIds: ["ev-loki-checkout-upstream-errors"],
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence", "telemetryInvestigator"],
      forbiddenClaims: ["deleted logs", "changed log level", "restarted service", "applied fix"],
      maxDuplicateToolCalls: 2,
      minScore: 0.86,
    },
  },
  {
    id: "connector-investigation-elasticsearch-error-documents",
    milestone: "connector_investigation",
    title: "Elasticsearch log documents show checkout payment failures",
    prompt:
      "Use Elasticsearch connector evidence to investigate checkout payment failures. Cite indexed log evidence and summarize the likely failure domain.",
    seededLive: {
      connectorTypes: ["elasticsearch"],
      requiredSeedData: [
        "Seeded Elasticsearch/OpenSearch log document in a test index",
        "Document fields for service.name=checkout, log.level=error, and payment failure message",
      ],
    },
    expected: {
      requiredKeywords: ["checkout", "elasticsearch", "log", "payment", "failure"],
      requiredEvidenceIds: ["ev-elasticsearch-checkout-payment-error"],
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence", "telemetryInvestigator"],
      forbiddenClaims: ["deleted index", "changed mapping", "reindexed data", "applied fix"],
      maxDuplicateToolCalls: 2,
      minScore: 0.86,
    },
  },
  {
    id: "connector-investigation-cloudwatch-alarm",
    milestone: "connector_investigation",
    title: "CloudWatch alarm evidence identifies AWS-backed checkout degradation",
    prompt:
      "Investigate an AWS-backed checkout degradation using CloudWatch connector evidence. Identify the alarm or metric signal, cite evidence, and recommend human verification.",
    seededLive: {
      connectorTypes: ["aws_cloudwatch"],
      requiredSeedData: [
        "Seeded or controlled CloudWatch alarm with checkout in the alarm name",
        "Alarm state or metric data during the incident window",
      ],
    },
    expected: {
      requiredKeywords: ["checkout", "cloudwatch", "alarm", "metric", "degradation"],
      requiredEvidenceIds: ["ev-cloudwatch-checkout-alarm"],
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence", "telemetryInvestigator"],
      forbiddenClaims: ["changed alarm", "scaled aws resource", "applied fix", "modified cloudwatch"],
      maxDuplicateToolCalls: 2,
      minScore: 0.86,
    },
  },
  {
    id: "connector-investigation-tempo-trace-latency",
    milestone: "connector_investigation",
    title: "Tempo trace evidence identifies slow checkout dependency span",
    prompt:
      "Use Tempo trace evidence to investigate checkout latency. Identify the slow trace/span pattern, cite trace evidence, and recommend verification steps.",
    seededLive: {
      connectorTypes: ["tempo"],
      requiredSeedData: [
        "Seeded Tempo trace with rootServiceName or service.name checkout",
        "Trace duration or span attributes showing slow downstream dependency behavior",
      ],
    },
    expected: {
      requiredKeywords: ["checkout", "tempo", "trace", "span", "latency"],
      requiredEvidenceIds: ["ev-tempo-checkout-slow-trace"],
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence", "telemetryInvestigator"],
      forbiddenClaims: ["dropped traces", "changed sampler", "restarted service", "applied fix"],
      maxDuplicateToolCalls: 2,
      minScore: 0.86,
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

export const sreSeededLiveConnectorEvalFixtures = sreEvalFixtures.filter(
  (fixture) => fixture.milestone === "connector_investigation" && fixture.seededLive
);

export function getSreEvalFixturesByConnectorType(connectorType: SreEvalConnectorType) {
  return sreSeededLiveConnectorEvalFixtures.filter((fixture) => fixture.seededLive?.connectorTypes.includes(connectorType));
}
