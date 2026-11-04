import { isOverBroadPattern, renderDiagnosticQueryTemplate, validateDiagnosticQueryParameterSchema, validateTemplateFreeTextPositions, validateTemplatePlaceholderCoverage } from "./diagnostic-query";

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

  it("rejects a stored query type that is no longer supported (fails closed)", () => {
    expect(() =>
      renderDiagnosticQueryTemplate(
        { ...definition, queryType: "sql" as never, template: "select 1 where x = $id", parameterSchema: { id: "number" }, allowlist: { id: ["1"] } },
        { id: 1 }
      )
    ).toThrow('Unsupported diagnostic query type "sql"');
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

describe("diagnostic query pattern safety", () => {
  const schemaWith = (pattern: string) => ({
    host: { type: "string", pattern },
  });

  it.each(["(a+)+$", "(a*)*", "(x+x+)+y", "([a-z]+)*"])(
    "rejects nested-quantifier pattern %s",
    (pattern) => {
      expect(() => validateDiagnosticQueryParameterSchema(schemaWith(pattern))).toThrow(
        /too complex|invalid pattern/
      );
    }
  );

  it.each(["^[a-z0-9-]+$", "^\\d{1,5}$", "^(prod|staging)$", "^[a-z]+(-[a-z]+)?$"])(
    "still accepts ordinary pattern %s",
    (pattern) => {
      expect(() => validateDiagnosticQueryParameterSchema(schemaWith(pattern))).not.toThrow();
    }
  );
});

describe("diagnostic query pattern matching path", () => {
  const withPattern = (pattern: string) => ({
    ...definition,
    parameterSchema: { service: { type: "string", pattern } },
    allowlist: {},
  });

  it("rejects a stored nested-quantifier pattern at match time without hanging", () => {
    const start = Date.now();
    expect(() =>
      renderDiagnosticQueryTemplate(withPattern("(a+)+$"), { service: `${"a".repeat(40)}!` })
    ).toThrow(/too complex/);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("rejects values longer than the pattern input cap", () => {
    expect(() =>
      renderDiagnosticQueryTemplate(withPattern("^[a-z]+$"), { service: "a".repeat(1001) })
    ).toThrow(/too long/);
  });

  it("still matches an ordinary pattern", () => {
    expect(renderDiagnosticQueryTemplate(withPattern("^[a-z]+$"), { service: "checkout" }).query).toContain("checkout");
    expect(() =>
      renderDiagnosticQueryTemplate(withPattern("^[a-z]+$"), { service: "Checkout1" })
    ).toThrow(/required pattern/);
  });
});

describe("diagnostic query free-text and broad-pattern guards", () => {
  const base = { ...definition, allowlist: {}, parameterSchema: { v: "string" } };
  const render = (template: string, schema: Record<string, unknown>, value: string, allowlist = {}) =>
    renderDiagnosticQueryTemplate({ ...base, template, parameterSchema: schema, allowlist }, { v: value });

  it("rejects operators and spaces in an unquoted free-text position at render time", () => {
    expect(() => render("up > $v", { v: "string" }, "1 or vector(1)")).toThrow("unquoted free text");
    expect(() => render("/api/$v", { v: "string" }, "../admin")).toThrow("unquoted free text");
    expect(() => render("/api/$v", { v: "string" }, "a?x=1&y=2")).toThrow("unquoted free text");
  });

  it("still renders a plain token in an unquoted position (saved definitions keep working)", () => {
    expect(render("/api/$v", { v: "string" }, "checkout-api").query).toBe("/api/checkout-api");
  });

  it("allows spaces and operators inside quotes, but not the quote itself", () => {
    expect(render('{app="$v"}', { v: "string" }, "a b | c").query).toBe('{app="a b | c"}');
    expect(() => render('{app="$v"}', { v: "string" }, 'x"} or vector(1) #')).toThrow("disallowed characters");
  });

  it("treats an over-broad saved pattern as no constraint when rendering", () => {
    expect(() => render('{app="$v"}', { v: { type: "string", pattern: ".*" } }, 'x"} or {a="b')).toThrow("disallowed characters");
    expect(render('{app="$v"}', { v: { type: "string", pattern: ".*" } }, "benign").query).toBe('{app="benign"}');
  });

  it("keeps a strict pattern as the constraint, even in an unquoted position", () => {
    expect(render("up > $v", { v: { type: "string", pattern: "^[a-z ]+$" } }, "a b").query).toBe("up > a b");
  });

  it("detects over-broad patterns", () => {
    for (const p of [".*", "^.+$", "^[^x]+$", "a", "^[\\s\\S]*$"]) expect(isOverBroadPattern(p)).toBe(true);
    for (const p of ["^[a-zA-Z0-9_.:-]+$", "^[a-z ]+$"]) expect(isOverBroadPattern(p)).toBe(false);
  });

  it("rejects over-broad patterns when a definition is saved", () => {
    expect(() => validateDiagnosticQueryParameterSchema({ v: { type: "string", pattern: ".*" } })).toThrow("too broad");
    expect(() => validateDiagnosticQueryParameterSchema({ v: { type: "string", pattern: "^[a-z]+$" } })).not.toThrow();
  });

  it("rejects unconstrained free text in an unquoted position when a definition is saved", () => {
    expect(() => validateTemplateFreeTextPositions("up > $v", { v: "string" }, {})).toThrow("unquoted position");
    expect(() => validateTemplateFreeTextPositions('{a="$v"}', { v: "string" }, {})).not.toThrow();
    expect(() => validateTemplateFreeTextPositions("up > $v", { v: "number" }, {})).not.toThrow();
    expect(() => validateTemplateFreeTextPositions("up > $v", { v: { type: "string", pattern: "^[a-z]+$" } }, {})).not.toThrow();
    expect(() => validateTemplateFreeTextPositions("up > $v", { v: "string" }, { v: ["a", "b"] })).not.toThrow();
  });

  it("every built-in recipe passes the save-time guards", () => {
    const { diagnosticQueryAdapterRecipes } = jest.requireActual("./diagnostic-query-adapters");
    for (const r of diagnosticQueryAdapterRecipes) {
      expect(() => validateDiagnosticQueryParameterSchema(r.parameterSchema)).not.toThrow();
      expect(() => validateTemplateFreeTextPositions(r.template, r.parameterSchema, r.allowlist)).not.toThrow();
    }
  });

  describe("http_get templates", () => {
    const httpRender = (template: string, value: string) =>
      renderDiagnosticQueryTemplate({ ...base, queryType: "http_get", template }, { v: value });

    it("renders values verbatim, never encoded (adapters encode when they build the request)", () => {
      expect(httpRender("/api/v1/$v/pods", "ns/app").query).toBe("/api/v1/ns/app/pods");
      expect(httpRender('/search?q="$v"', "a b,c=d").query).toBe('/search?q="a b,c=d"');
    });

    it("keeps the strict token rule for unquoted free text and rejects unsafe characters", () => {
      expect(() => httpRender("/api/$v", "a b")).toThrow("unquoted free text");
      expect(() => httpRender("/api/$v", "../admin")).toThrow("unquoted free text");
      for (const bad of ['a"b', "a'b", "a`b", "a\\b", "a{b}", "a\nb", "a\rb"]) {
        expect(() => httpRender("/api/$v", bad)).toThrow("disallowed characters");
      }
    });
  });

  it("treats a backslash as literal inside a backtick string", () => {
    // `a\` closes at the second backtick, so $v after it is unquoted; in "..." the backslash would escape.
    expect(() => validateTemplateFreeTextPositions("`a\\` > $v", { v: "string" }, {})).toThrow("unquoted position");
    expect(() => validateTemplateFreeTextPositions('"a\\" > $v', { v: "string" }, {})).not.toThrow();
  });
});
