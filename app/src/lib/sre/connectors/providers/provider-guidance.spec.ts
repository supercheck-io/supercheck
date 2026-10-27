import { assertAgentConnectorQueryLanguage, getAgentConnectorQueryGuidance } from "../agent-query-guidance";
import { getDiagnosticQueryAdapterRecipes, isDiagnosticQueryTypeCompatible } from "../diagnostic-query-adapters";
import { renderDiagnosticQueryTemplate } from "../diagnostic-query";
import { isLiveSearchConnectorType, isPrivateAgentConnectorType, connectorRequiresCredentials } from "../connector-capabilities";
import { isStagedLogConnectorType, validateStagedEvidenceQuery } from "../staged-evidence";
import { SRE_CONNECTOR_CATALOG } from "@/components/sre/connectors/connector-catalog";

const TYPES = ["jaeger", "newrelic", "splunk", "gcp_monitoring", "azure_monitor"] as const;

describe("observability provider wiring", () => {
  it.each(TYPES)("%s is live, private-agent capable, addable and has guidance", (type) => {
    expect(isLiveSearchConnectorType(type)).toBe(true);
    expect(isPrivateAgentConnectorType(type)).toBe(true);
    expect(SRE_CONNECTOR_CATALOG.find((i) => i.value === type)?.addable).toBe(true);
    expect(getAgentConnectorQueryGuidance(type)).not.toMatch(/native read-only query language/);
  });

  it("only Jaeger may run without a credential", () => {
    expect(connectorRequiresCredentials("jaeger")).toBe(false);
    for (const type of ["newrelic", "splunk", "gcp_monitoring", "azure_monitor"]) expect(connectorRequiresCredentials(type as never)).toBe(true);
  });

  it("agent query guard rejects writes before any network call", () => {
    expect(() => assertAgentConnectorQueryLanguage("splunk", "index=a | outputlookup x")).toThrow(/not allowed/);
    expect(() => assertAgentConnectorQueryLanguage("newrelic", "DELETE FROM x")).toThrow(/NRQL/);
    expect(() => assertAgentConnectorQueryLanguage("azure_monitor", ".drop table X")).toThrow(/control commands/);
    expect(() => assertAgentConnectorQueryLanguage("jaeger", "error:true")).toThrow(/service/);
    expect(() => assertAgentConnectorQueryLanguage("gcp_monitoring", "metrics: severity=1")).toThrow(/metric.type/);
    expect(() => assertAgentConnectorQueryLanguage("splunk", "index=a error")).not.toThrow();
  });

  it("staged evidence is enabled for Splunk and New Relic with aggregation required for statistics", () => {
    expect(isStagedLogConnectorType("splunk")).toBe(true);
    expect(isStagedLogConnectorType("newrelic")).toBe(true);
    expect(() => validateStagedEvidenceQuery({ connectorType: "splunk", stage: "statistics", query: "index=a error" })).toThrow(/stats/);
    expect(() => validateStagedEvidenceQuery({ connectorType: "splunk", stage: "statistics", query: "index=a | stats count" })).not.toThrow();
    expect(() => validateStagedEvidenceQuery({ connectorType: "newrelic", stage: "statistics", query: "SELECT message FROM Log" })).toThrow(/aggregation/);
    expect(() => validateStagedEvidenceQuery({ connectorType: "newrelic", stage: "sample", query: "SELECT message FROM Log" })).not.toThrow();
  });

  it.each(TYPES)("%s diagnostic recipes render to queries the provider accepts", (type) => {
    const recipes = getDiagnosticQueryAdapterRecipes(type);
    expect(recipes.length).toBeGreaterThan(0);
    expect(isDiagnosticQueryTypeCompatible(type, "http_get")).toBe(true);
    expect(isDiagnosticQueryTypeCompatible(type, "sql")).toBe(false);
    for (const recipe of recipes) {
      const params: Record<string, string> = recipe.id === "azure-resource-metric"
        ? { resource: "/subscriptions/44444444-4444-4444-4444-444444444444/resourceGroups/rg/providers/Microsoft.Web/sites/x" }
        : { service: "checkout" };
      const rendered = renderDiagnosticQueryTemplate({ id: recipe.id, queryType: recipe.queryType, template: recipe.template, parameterSchema: recipe.parameterSchema, allowlist: recipe.allowlist, maxRows: recipe.limits.maxRows, maxBytes: recipe.limits.maxBytes, maxSeconds: recipe.limits.maxSeconds }, params);
      expect(() => assertAgentConnectorQueryLanguage(type, rendered.query)).not.toThrow();
    }
  });
});
