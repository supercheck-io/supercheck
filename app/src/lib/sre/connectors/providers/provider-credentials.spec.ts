import { connectorCredentialRequirementError } from "../connector-credential-requirements";
import { flatCredentialFields, providerEndpointRequirementError } from "./provider-credentials";

const azure = { tenantId: "11111111-1111-1111-1111-111111111111", clientId: "22222222-2222-2222-2222-222222222222", secret: "x" };

describe("provider credential requirements", () => {
  it("validates New Relic", () => {
    expect(connectorCredentialRequirementError("newrelic", { apiKey: "k", accountId: "123" })).toBeNull();
    expect(connectorCredentialRequirementError("newrelic", { accountId: "123" })).toMatch(/User API key/);
    expect(connectorCredentialRequirementError("newrelic", { apiKey: "k", accountId: "abc" })).toMatch(/numeric account ID/);
    expect(connectorCredentialRequirementError("newrelic", { apiKey: "k", accountId: "1", region: "apac" })).toMatch(/us or eu/);
  });
  it("validates Splunk, GCP and Azure", () => {
    expect(connectorCredentialRequirementError("splunk", { secret: "t" })).toBeNull();
    expect(connectorCredentialRequirementError("splunk", { secret: " " })).toMatch(/token/);
    expect(connectorCredentialRequirementError("gcp_monitoring", { secret: "{}" })).toMatch(/service_account/);
    expect(connectorCredentialRequirementError("azure_monitor", azure)).toBeNull();
    expect(connectorCredentialRequirementError("azure_monitor", { ...azure, clientId: "x" })).toMatch(/GUID/);
  });
  it("requires an endpoint only for Jaeger and Splunk", () => {
    expect(providerEndpointRequirementError("jaeger", null)).toMatch(/query service URL/);
    expect(providerEndpointRequirementError("splunk", null)).toMatch(/8089/);
    expect(providerEndpointRequirementError("splunk", "https://s")).toBeNull();
    expect(providerEndpointRequirementError("newrelic", null)).toBeNull();
    expect(providerEndpointRequirementError("jaeger", "https://j.example.com/?x=1")).toMatch(/query string/);
    expect(providerEndpointRequirementError("jaeger", "https://j.example.com/base")).toBeNull();
  });
  it("drops nested credential objects", () => {
    expect(flatCredentialFields({ a: "1", b: { c: "2" }, d: null })).toEqual({ a: "1", d: null });
    expect(flatCredentialFields(null)).toBeNull();
  });
});
