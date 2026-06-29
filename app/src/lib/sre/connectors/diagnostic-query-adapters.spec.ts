import { getDiagnosticQueryAdapterRecipes, isDiagnosticQueryTypeCompatible } from "./diagnostic-query-adapters";
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

  it("keeps future connector types backwards-compatible", () => {
    expect(isDiagnosticQueryTypeCompatible("future_connector", "http_get")).toBe(true);
    expect(getDiagnosticQueryAdapterRecipes("future_connector")).toEqual([]);
  });
});
