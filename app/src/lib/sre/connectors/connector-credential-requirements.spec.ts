import { connectorCredentialRequirementError } from "./connector-credential-requirements";

describe("connectorCredentialRequirementError", () => {
  it("requires Datadog API and application keys and ignores a lone secret", () => {
    expect(
      connectorCredentialRequirementError("datadog", { secret: "dd-api-only" }),
    ).toBe("Datadog requires both an API key and an application key");
    expect(
      connectorCredentialRequirementError("datadog", { apiKey: "dd-api" }),
    ).toBe("Datadog requires both an API key and an application key");
    expect(
      connectorCredentialRequirementError("datadog", {
        apiKey: "dd-api",
        applicationKey: "dd-app",
      }),
    ).toBeNull();
  });

  it("does not require a second key for single-secret connectors", () => {
    expect(
      connectorCredentialRequirementError("github", { secret: "ghp_lab" }),
    ).toBeNull();
    expect(
      connectorCredentialRequirementError("gitlab", { secret: "glpat-lab" }),
    ).toBeNull();
    expect(
      connectorCredentialRequirementError("pagerduty", { secret: "pd-key" }),
    ).toBeNull();
  });

  it("requires CloudWatch access key id and secret", () => {
    expect(
      connectorCredentialRequirementError("aws_cloudwatch", { apiKey: "AKIA" }),
    ).toBe("AWS CloudWatch requires an access key ID and a secret access key");
    expect(
      connectorCredentialRequirementError("aws_cloudwatch", {
        apiKey: "AKIA",
        secret: "secret",
      }),
    ).toBeNull();
  });

  it("requires a knowledge connector token and a sane email", () => {
    expect(connectorCredentialRequirementError("jira", { email: "a@b.co" })).toContain("API token");
    expect(connectorCredentialRequirementError("confluence", { secret: "t", email: "nope" })).toContain("valid email");
    expect(connectorCredentialRequirementError("jira", { secret: "t", email: "a@b.co" })).toBeNull();
    expect(connectorCredentialRequirementError("jira", { secret: "pat" })).toBeNull();
    expect(connectorCredentialRequirementError("notion", { secret: " " })).toContain("integration token");
    expect(connectorCredentialRequirementError("notion", { secret: "x" })).toBeNull();
  });
});
