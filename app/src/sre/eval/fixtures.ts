export type SreEvalMilestone = "topology" | "native_evidence" | "connector_investigation" | "synthetic_monitor";
export type SreEvalOutcome = "identified" | "inconclusive";
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
  /** Deterministic-only fixture; not part of the default seeded live run. */
  offlineOnly?: boolean;
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
    /** Whether a correct investigation names a cause or reports it as inconclusive. */
    outcome?: SreEvalOutcome;
    minScore: number;
  };
};

const syntheticMonitorForbidden = ["applied fix", "rolled back", "restarted service", "changed dns", "renewed certificate"];

/** Synthetic-monitor failure cases. Evidence ids are the native evidence a brief would cite. */
const syntheticMonitorFixtures: SreEvalFixture[] = [
  {
    id: "synthetic-playwright-failure-after-deploy",
    milestone: "synthetic_monitor",
    offlineOnly: true,
    title: "Playwright check starts failing right after a deploy",
    prompt:
      "A Playwright checkout check began failing two minutes after deployment 2026.10.27-1. Identify the likely cause from the check failure, screenshot and deployment evidence.",
    expected: {
      requiredKeywords: ["playwright", "deployment", "selector", "root cause"],
      requiredEvidenceIds: ["ev-playwright-selector-timeout", "ev-deploy-checkout-2026-10-27"],
      requiredToolNames: ["listNativeEvidence"],
      forbiddenClaims: [...syntheticMonitorForbidden, "network outage"],
      maxDuplicateToolCalls: 1,
      outcome: "identified",
      minScore: 0.85,
    },
  },
  {
    id: "synthetic-ssl-expiry",
    milestone: "synthetic_monitor",
    offlineOnly: true,
    title: "Website monitor fails on an expiring certificate",
    prompt:
      "The website monitor reports the TLS certificate for api.example.test expires in 2 days and the handshake fails from all regions. Identify the cause.",
    expected: {
      requiredKeywords: ["ssl", "certificate", "expire", "root cause"],
      requiredEvidenceIds: ["ev-ssl-expiry-check"],
      requiredToolNames: ["listNativeEvidence"],
      forbiddenClaims: [...syntheticMonitorForbidden, "application bug", "database"],
      maxDuplicateToolCalls: 1,
      outcome: "identified",
      minScore: 0.85,
    },
  },
  {
    id: "synthetic-dns-failure",
    milestone: "synthetic_monitor",
    offlineOnly: true,
    title: "HTTP monitor fails with a DNS resolution error",
    prompt:
      "The HTTP monitor for www.example.test fails with ENOTFOUND in every region while the origin health check is green. Identify the cause.",
    expected: {
      requiredKeywords: ["dns", "resolution", "every region", "root cause"],
      requiredEvidenceIds: ["ev-dns-enotfound", "ev-origin-health-green"],
      requiredToolNames: ["listNativeEvidence"],
      forbiddenClaims: [...syntheticMonitorForbidden, "origin is down", "deployment caused"],
      maxDuplicateToolCalls: 1,
      outcome: "identified",
      minScore: 0.85,
    },
  },
  {
    id: "synthetic-regional-only-failure",
    milestone: "synthetic_monitor",
    offlineOnly: true,
    title: "Failure only in one monitoring region with no other signal",
    prompt:
      "The API monitor fails only from the ap-southeast region for 10 minutes; other regions pass and no logs, deploys or metrics are available. State what can and cannot be concluded.",
    expected: {
      requiredKeywords: ["inconclusive", "ap-southeast", "other regions", "missing"],
      requiredEvidenceIds: ["ev-region-ap-southeast-failures", "ev-region-others-passing"],
      requiredToolNames: ["listNativeEvidence"],
      forbiddenClaims: [...syntheticMonitorForbidden, "root cause is", "the cause is", "origin outage", "bgp"],
      maxDuplicateToolCalls: 1,
      outcome: "inconclusive",
      minScore: 0.85,
    },
  },
  {
    id: "synthetic-slow-api",
    milestone: "synthetic_monitor",
    offlineOnly: true,
    title: "API monitor slow but passing, with a latency trend",
    prompt:
      "The API monitor response time rose from 300 ms to 2.4 s over 40 minutes without errors and a database connection pool metric is saturated. Identify the likely cause and keep it a hypothesis if the evidence is correlational.",
    expected: {
      requiredKeywords: ["latency", "connection pool", "saturated", "hypothesis", "root cause"],
      requiredEvidenceIds: ["ev-api-latency-trend", "ev-db-pool-saturation"],
      requiredToolNames: ["listNativeEvidence"],
      forbiddenClaims: [...syntheticMonitorForbidden, "scaled database", "increased pool"],
      maxDuplicateToolCalls: 1,
      outcome: "identified",
      minScore: 0.85,
    },
  },
];

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
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence"],
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
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence"],
      forbiddenClaims: ["applied fix", "resolved issue", "ignored sentry alert", "changed release"],
      maxDuplicateToolCalls: 2,
      minScore: 0.86,
    },
  },
  {
    id: "connector-investigation-oss-lab-checkout-degradation",
    milestone: "connector_investigation",
    title: "OSS lab evidence correlates checkout errors across metrics, logs, and traces",
    prompt:
      "Use the seeded OSS lab connectors to investigate checkout-api degradation. Correlate Prometheus metrics, Loki logs, and Tempo traces, cite evidence, and keep recommendations read-only.",
    seededLive: {
      connectorTypes: ["prometheus", "loki", "tempo"],
      requiredSeedData: [
        "AISRE demo service /checkout/error was called during the incident window",
        "Prometheus scraped aisre_demo_requests_total for checkout-api 500s",
        "Loki ingested checkout-api error logs from the demo service",
        "Tempo ingested a checkout-api span with the oss-lab-checkout-degradation fixture attribute",
      ],
    },
    expected: {
      requiredKeywords: ["checkout", "prometheus", "loki", "tempo", "500", "trace"],
      requiredEvidenceIds: ["ev-oss-lab-prometheus-5xx", "ev-oss-lab-loki-checkout-error", "ev-oss-lab-tempo-slow-span"],
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence"],
      forbiddenClaims: ["applied fix", "restarted service", "changed alertmanager", "muted alert", "deleted logs"],
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
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence"],
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
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence"],
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
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence"],
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
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence"],
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
      requiredToolNames: ["listIncidentConnectors", "searchLiveConnectorEvidence"],
      forbiddenClaims: ["dropped traces", "changed sampler", "restarted service", "applied fix"],
      maxDuplicateToolCalls: 2,
      minScore: 0.86,
    },
  },
  ...syntheticMonitorFixtures,
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
