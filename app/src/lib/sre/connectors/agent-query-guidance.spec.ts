import {
  assertAgentConnectorQueryLanguage,
  createAgentConnectorFailureGuard,
  getAgentConnectorQueryGuidance,
} from "./agent-query-guidance";

describe("agent connector query guidance", () => {
  it("directs unknown Kubernetes label mappings to a bounded pod list", () => {
    expect(getAgentConnectorQueryGuidance("kubernetes")).toContain(
      "Use an explicit namespace and *",
    );
    expect(getAgentConnectorQueryGuidance("kubernetes")).toContain(
      "never derive a label from the service name",
    );
  });

  it("keeps Prometheus and Loki queries in their native languages", () => {
    expect(getAgentConnectorQueryGuidance("prometheus")).toContain("PromQL");
    expect(getAgentConnectorQueryGuidance("loki")).toContain("LogQL");

    expect(() =>
      assertAgentConnectorQueryLanguage("prometheus", "app=checkout-api"),
    ).toThrow("must be valid PromQL");
    expect(() =>
      assertAgentConnectorQueryLanguage("loki", "app=checkout-api"),
    ).toThrow("must be valid LogQL");
    expect(() =>
      assertAgentConnectorQueryLanguage(
        "prometheus",
        'sum(rate(http_requests_total{service="checkout"}[5m]))',
      ),
    ).not.toThrow();
    expect(() =>
      assertAgentConnectorQueryLanguage("loki", '{app="checkout"} |= "error"'),
    ).not.toThrow();
  });

  it("suppresses repeated terminal failures for one connector run", () => {
    const guard = createAgentConnectorFailureGuard();

    expect(guard.hasFailed("connector-1")).toBe(false);
    guard.markFailed("connector-1");
    expect(guard.hasFailed("connector-1")).toBe(true);
    expect(guard.hasFailed("connector-2")).toBe(false);
  });
});
