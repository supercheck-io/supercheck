export function getAgentConnectorQueryGuidance(connectorType: string) {
  switch (connectorType) {
    case "kubernetes":
      return "Kubernetes label selector only. Use an explicit namespace and * until evidence verifies a label mapping; never derive a label from the service name.";
    case "prometheus":
      return 'PromQL only, for example up or sum(rate(http_requests_total{service="checkout"}[5m])). Never use a bare Kubernetes label selector.';
    case "loki":
      return 'LogQL only, for example {app="checkout"} or {app="checkout"} |= "error". Never use a bare Kubernetes label selector.';
    case "grafana":
      return "Plain dashboard search text, for example checkout latency.";
    default:
      return "Use the connector's native read-only query language.";
  }
}

function looksLikeBareLabelSelector(query: string) {
  return /^[A-Za-z0-9_.\/-]+\s*(?:=|!=)\s*[A-Za-z0-9_.\/-]+$/.test(
    query.trim(),
  );
}

export function assertAgentConnectorQueryLanguage(
  connectorType: string,
  query: string,
) {
  const trimmed = query.trim();

  if (connectorType === "prometheus" && looksLikeBareLabelSelector(trimmed)) {
    throw new Error(
      "Prometheus connector query must be valid PromQL, not a Kubernetes label selector",
    );
  }

  if (
    connectorType === "loki" &&
    (!trimmed.includes("{") || !trimmed.includes("}"))
  ) {
    throw new Error(
      "Loki connector query must be valid LogQL with a stream selector",
    );
  }
}

export function createAgentConnectorFailureGuard() {
  const failedConnectorIds = new Set<string>();

  return {
    hasFailed: (connectorId: string) => failedConnectorIds.has(connectorId),
    markFailed: (connectorId: string) => failedConnectorIds.add(connectorId),
  };
}
