import { renderDiagnosticQueryTemplate, validateDiagnosticQueryParameterSchema, validateTemplatePlaceholderCoverage } from "./diagnostic-query";

const definition = {
  id: "018f0000-0000-7000-8000-000000000001",
  queryType: "promql" as const,
  template: "sum(rate(http_requests_total{service=\"$service\"}[5m])) by (route)",
  parameterSchema: { service: "string" },
  allowlist: { service: ["checkout"] },
  maxRows: 100,
  maxBytes: 1_048_576,
  maxSeconds: 10,
};

describe("diagnostic-query", () => {
  it("renders allowlisted parameters", () => {
    const rendered = renderDiagnosticQueryTemplate(definition, { service: "checkout" });

    expect(rendered.query).toContain('service="checkout"');
    expect(rendered.effectiveLimits.maxRows).toBe(100);
  });

  it("rejects parameters outside the allowlist", () => {
    expect(() => renderDiagnosticQueryTemplate(definition, { service: "payments" })).toThrow("not allowlisted");
  });

  it("rejects unexpected parameters", () => {
    expect(() => renderDiagnosticQueryTemplate(definition, { service: "checkout", secret: "x" })).toThrow("Unexpected diagnostic query parameter");
  });

  it("rejects write-shaped sql", () => {
    expect(() =>
      renderDiagnosticQueryTemplate(
        { ...definition, queryType: "sql", template: "delete from users where id = $id", parameterSchema: { id: "number" }, allowlist: { id: ["1"] } },
        { id: 1 }
      )
    ).toThrow("read-only");
  });

  it("allows read-only sql when disallowed words appear inside string literals", () => {
    const rendered = renderDiagnosticQueryTemplate(
      {
        ...definition,
        queryType: "sql",
        template: "select * from status_events where state = 'drop' and action = 'delete'",
        parameterSchema: {},
        allowlist: {},
      },
      {}
    );

    expect(rendered.query).toContain("state = 'drop'");
  });

  it("allows read-only sql when disallowed words appear inside comments or quoted identifiers", () => {
    const rendered = renderDiagnosticQueryTemplate(
      {
        ...definition,
        queryType: "sql",
        template: '/* delete historical rows */ select "drop" from status_events -- update dashboard label',
        parameterSchema: {},
        allowlist: {},
      },
      {}
    );

    expect(rendered.query).toContain('select "drop"');
  });

  it("allows semicolons inside sql string literals but still rejects executable separators", () => {
    expect(() =>
      renderDiagnosticQueryTemplate(
        {
          ...definition,
          queryType: "sql",
          template: "select * from status_events where message = 'api; still read only'",
          parameterSchema: {},
          allowlist: {},
        },
        {}
      )
    ).not.toThrow();

    expect(() =>
      renderDiagnosticQueryTemplate(
        {
          ...definition,
          queryType: "sql",
          template: "select * from status_events; select * from users",
          parameterSchema: {},
          allowlist: {},
        },
        {}
      )
    ).toThrow("disallowed write or multi-statement token");
  });

  it("still rejects sql write tokens outside literals and comments", () => {
    expect(() =>
      renderDiagnosticQueryTemplate(
        {
          ...definition,
          queryType: "sql",
          template: "with recent as (select * from status_events) drop table users",
          parameterSchema: {},
          allowlist: {},
        },
        {}
      )
    ).toThrow("disallowed write or multi-statement token");
  });

  it("validates template placeholder coverage against allowlist", () => {
    expect(() => validateTemplatePlaceholderCoverage('sum(rate(http_requests_total{service="$service"}[5m]))', { service: ["checkout"] })).not.toThrow();
  });

  it("rejects template with placeholder not in allowlist", () => {
    expect(() => validateTemplatePlaceholderCoverage('sum(rate(http_requests_total{service="$service", env="$env"}[5m]))', { service: ["checkout"] })).toThrow("not in the allowlist");
  });

  it("rejects template with no placeholders", () => {
    expect(() => validateTemplatePlaceholderCoverage("sum(rate(http_requests_total[5m]))", { service: ["checkout"] })).toThrow("at least one parameter placeholder");
  });

  it("validates brace-style placeholders", () => {
    expect(() => validateTemplatePlaceholderCoverage("sum(rate({{service}}[5m]))", { service: ["checkout"] })).not.toThrow();
  });

  it("validates object-form parameter schemas", () => {
    expect(() =>
      validateDiagnosticQueryParameterSchema({
        service: { type: "string", enum: ["checkout", "payments"], default: "checkout", maxLength: 50 },
        minutes: { type: "number", min: 1, max: 60, default: 5 },
        window: { type: "duration", default: "5m" },
        since: { type: "date", required: false },
      })
    ).not.toThrow();
  });

  it("rejects unsupported parameter schema keys", () => {
    expect(() => validateDiagnosticQueryParameterSchema({ service: { type: "string", secret: true } })).toThrow("unsupported key");
  });

  it("rejects parameter schema defaults outside enum constraints", () => {
    expect(() => validateDiagnosticQueryParameterSchema({ service: { type: "string", enum: ["checkout"], default: "payments" } })).toThrow("schema enum");
  });

  it("uses schema defaults for missing parameters", () => {
    const rendered = renderDiagnosticQueryTemplate(
      {
        ...definition,
        template: 'sum(rate(http_requests_total{service="$service"}[$window]))',
        parameterSchema: { service: "string", window: { type: "duration", default: "5m" } },
        allowlist: { service: ["checkout"], window: ["5m"] },
      },
      { service: "checkout" }
    );

    expect(rendered.query).toContain("[5m]");
  });

  it("rejects numeric parameters outside schema bounds", () => {
    expect(() =>
      renderDiagnosticQueryTemplate(
        { ...definition, template: "topk($limit, http_requests_total)", parameterSchema: { limit: { type: "number", min: 1, max: 10 } }, allowlist: { limit: [1, 5, 10] } },
        { limit: 50 }
      )
    ).toThrow("at most 10");
  });

  it("rejects invalid duration parameters", () => {
    expect(() =>
      renderDiagnosticQueryTemplate(
        { ...definition, template: "sum(rate(http_requests_total[$window]))", parameterSchema: { window: { type: "duration" } }, allowlist: { window: ["5 minutes"] } },
        { window: "5 minutes" }
      )
    ).toThrow("bounded duration");
  });

  it("rejects invalid date parameters", () => {
    expect(() =>
      renderDiagnosticQueryTemplate(
        { ...definition, queryType: "logql", template: '{service="checkout"} |= "$since"', parameterSchema: { since: { type: "date" } }, allowlist: { since: ["not-a-date"] } },
        { since: "not-a-date" }
      )
    ).toThrow("valid date/time");
  });
});
