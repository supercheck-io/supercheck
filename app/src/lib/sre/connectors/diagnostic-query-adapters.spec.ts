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
    expect(isDiagnosticQueryTypeCompatible("prometheus", "sql")).toBe(false);
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
});
