import {
  diagnosticQueryAdapterRecipes,
  getDiagnosticQueryAdapterRecipes,
  isDiagnosticQueryTypeCompatible,
} from "./diagnostic-query-adapters";
import { renderDiagnosticQueryTemplate } from "./diagnostic-query";

describe("diagnostic query adapters", () => {
  it("provides renderable Prometheus recipes", () => {
    const [recipe] = getDiagnosticQueryAdapterRecipes("prometheus");

    expect(recipe?.queryType).toBe("promql");
    expect(() =>
      renderDiagnosticQueryTemplate(
        {
          id: recipe.id,
          queryType: recipe.queryType,
          template: recipe.template,
          parameterSchema: recipe.parameterSchema,
          allowlist: recipe.allowlist,
          maxRows: recipe.limits.maxRows,
          maxBytes: recipe.limits.maxBytes,
          maxSeconds: recipe.limits.maxSeconds,
        },
        { service: "checkout", window: "5m" },
      ),
    ).not.toThrow();
  });

  it("maps complex connector types to compatible diagnostic query types", () => {
    expect(isDiagnosticQueryTypeCompatible("prometheus", "promql")).toBe(true);
    expect(isDiagnosticQueryTypeCompatible("loki", "logql")).toBe(true);
    expect(isDiagnosticQueryTypeCompatible("tempo", "traceql")).toBe(true);
    expect(isDiagnosticQueryTypeCompatible("aws_cloudwatch", "http_get")).toBe(true);
    expect(isDiagnosticQueryTypeCompatible("elasticsearch", "http_get")).toBe(true);
  });

  it("renders every built-in recipe with adapter-compatible parameters", () => {
    const parametersByRecipe: Record<
      string,
      Record<string, string | number>
    > = {
      "prometheus-http-5xx-rate": { service: "checkout", window: "5m" },
      "prometheus-latency-p95": { service: "checkout", window: "5m" },
      "loki-service-errors": { service: "checkout", pattern: "error" },
      "tempo-service-error-traces": { service: "checkout" },
      "tempo-slow-service-traces": {
        service: "checkout",
        min_duration: "1s",
      },
      "cloudwatch-active-alarms": {
        alarm_prefix: "checkout",
        state: "ALARM",
      },
      "cloudwatch-metric-data": {
        namespace: "AWS/ApplicationELB",
        metric: "TargetResponseTime",
        dimension: "LoadBalancer=app/checkout api/123",
        stat: "Average",
        period: 300,
      },
      "elasticsearch-service-errors": {
        service: "checkout",
        pattern: "error",
      },
      "jaeger-service-error-traces": { service: "checkout" },
      "jaeger-slow-service-traces": { service: "checkout", min_duration: "1s" },
      "newrelic-error-rate-by-transaction": { service: "checkout" },
      "newrelic-latency-p95-by-transaction": { service: "checkout" },
      "splunk-service-errors": { service: "checkout", pattern: "error" },
      "splunk-error-count-by-sourcetype": { service: "checkout" },
      "gcp-service-error-logs": { service: "checkout" },
      "gcp-cloud-run-request-count": { service: "checkout" },
      "azure-app-exceptions": { service: "checkout" },
      "azure-resource-metric": {
        resource:
          "/subscriptions/44444444-4444-4444-4444-444444444444/resourceGroups/rg/providers/Microsoft.Web/sites/x",
        metric: "Http5xx",
        agg: "Total",
      },
    };

    for (const recipe of diagnosticQueryAdapterRecipes) {
      const rendered = renderDiagnosticQueryTemplate(
        {
          id: recipe.id,
          queryType: recipe.queryType,
          template: recipe.template,
          parameterSchema: recipe.parameterSchema,
          allowlist: recipe.allowlist,
          maxRows: recipe.limits.maxRows,
          maxBytes: recipe.limits.maxBytes,
          maxSeconds: recipe.limits.maxSeconds,
        },
        parametersByRecipe[recipe.id] ?? {},
      );

      expect(rendered.query).toBeTruthy();
      expect(
        recipe.connectorTypes.every((connectorType) =>
          isDiagnosticQueryTypeCompatible(connectorType, recipe.queryType),
        ),
      ).toBe(true);
    }
  });

  it("renders provider-specific fields for Elasticsearch service errors", () => {
    const [recipe] = getDiagnosticQueryAdapterRecipes("elasticsearch");
    const rendered = renderDiagnosticQueryTemplate(
      {
        id: recipe.id,
        queryType: recipe.queryType,
        template: recipe.template,
        parameterSchema: recipe.parameterSchema,
        allowlist: recipe.allowlist,
        maxRows: recipe.limits.maxRows,
        maxBytes: recipe.limits.maxBytes,
        maxSeconds: recipe.limits.maxSeconds,
      },
      { service: "checkout", pattern: "error" },
    );

    expect(rendered.query).toContain("log.level:error");
    expect(rendered.query).toContain("message:error");
    expect(rendered.query).toContain("error.message:error");
  });

  it("keeps future connector types backwards-compatible", () => {
    expect(isDiagnosticQueryTypeCompatible("future_connector", "http_get")).toBe(true);
    expect(getDiagnosticQueryAdapterRecipes("future_connector")).toEqual([]);
  });

  it("does not ship sample service names in built-in recipe allowlists", () => {
    const serializedRecipes = JSON.stringify([
      ...getDiagnosticQueryAdapterRecipes("prometheus"),
      ...getDiagnosticQueryAdapterRecipes("loki"),
      ...getDiagnosticQueryAdapterRecipes("tempo"),
      ...getDiagnosticQueryAdapterRecipes("aws_cloudwatch"),
      ...getDiagnosticQueryAdapterRecipes("elasticsearch"),
    ]);

    expect(serializedRecipes).not.toContain("checkout");
  });

  describe("string parameter injection", () => {
    const def = (parameterSchema: Record<string, unknown>) => ({
      id: "q", queryType: "promql" as const,
      template: 'rate(http_requests_total{service="{{service}}"}[5m])',
      parameterSchema: parameterSchema as never, allowlist: {}, maxRows: 10, maxBytes: 1000, maxSeconds: 5,
    });
    const payload = 'x"} or {namespace="kube-system';

    it("rejects query-syntax characters in unconstrained string params", () => {
      expect(() => renderDiagnosticQueryTemplate(def({ service: { type: "string" } }), { service: payload })).toThrow();
      expect(renderDiagnosticQueryTemplate(def({ service: { type: "string" } }), { service: "checkout-api" }).query).toContain('service="checkout-api"');
    });

    it("still enforces a schema pattern", () => {
      expect(() => renderDiagnosticQueryTemplate(def({ service: { type: "string", pattern: "^[a-z-]+$" } }), { service: payload })).toThrow();
    });
  });
});
