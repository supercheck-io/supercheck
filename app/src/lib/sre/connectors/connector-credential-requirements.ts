import type { ConnectorCredentialValue } from "./credential-vault";
import { providerCredentialRequirementError } from "./providers/provider-credentials";

function trimmedCredentialField(
  value: ConnectorCredentialValue | null | undefined,
  keys: string[],
): string | null {
  if (!value) {
    return null;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

export function connectorCredentialRequirementError(
  connectorType: string,
  value: ConnectorCredentialValue | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  if (connectorType === "datadog") {
    const apiKey = trimmedCredentialField(value, ["apiKey", "api_key"]);
    const applicationKey = trimmedCredentialField(value, [
      "applicationKey",
      "application_key",
      "appKey",
      "app_key",
    ]);
    if (!apiKey || !applicationKey) {
      return "Datadog requires both an API key and an application key";
    }
    return null;
  }

  if (connectorType === "jira" || connectorType === "confluence") {
    const label = connectorType === "jira" ? "Jira" : "Confluence";
    const token = trimmedCredentialField(value, ["apiKey", "api_key", "secret"]);
    const email = trimmedCredentialField(value, ["email", "username"]);
    if (!token) {
      return `${label} requires an API token (Cloud) or a personal access token (Data Center)`;
    }
    if (email && !email.includes("@")) {
      return `${label} account email must be a valid email address`;
    }
    return null;
  }

  if (connectorType === "notion") {
    return trimmedCredentialField(value, ["apiKey", "api_key", "secret"])
      ? null
      : "Notion requires an internal integration token";
  }

  const providerError = providerCredentialRequirementError(connectorType, value);
  if (providerError) {
    return providerError;
  }

  if (connectorType === "aws_cloudwatch") {
    const accessKeyId = trimmedCredentialField(value, [
      "apiKey",
      "api_key",
      "accessKeyId",
      "access_key_id",
    ]);
    const secret = trimmedCredentialField(value, [
      "secret",
      "secretAccessKey",
      "secret_access_key",
    ]);
    if (!accessKeyId || !secret) {
      return "AWS CloudWatch requires an access key ID and a secret access key";
    }
  }

  return null;
}
