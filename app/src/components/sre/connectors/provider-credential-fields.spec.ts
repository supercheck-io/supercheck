import {
  buildProviderCredentialValue,
  getProviderCredentialFields,
} from "./provider-credential-fields";

describe("provider credential fields", () => {
  it("defines fields only for structured providers", () => {
    expect(getProviderCredentialFields("azure_monitor")?.map((f) => f.key)).toEqual(["tenantId", "clientId", "secret", "workspaceId"]);
    expect(getProviderCredentialFields("splunk")).toBeNull();
  });

  it("requires required fields and trims values, omitting empty optional ones", () => {
    const fields = getProviderCredentialFields("newrelic")!;
    expect(buildProviderCredentialValue(fields, { apiKey: "k" })).toEqual({ error: "Account ID is required" });
    expect(buildProviderCredentialValue(fields, { apiKey: " k ", accountId: "12", region: " " })).toEqual({ value: { apiKey: "k", accountId: "12" } });
  });
});
