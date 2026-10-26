import type { ConnectorCredentialValue } from "../credential-vault";
import { parseAzureCredential } from "./azure-monitor";
import { parseGcpCredential } from "./gcp-monitoring";
import type { ProviderCredential } from "./provider-core";

/** Providers whose API host is fixed by the vendor, so no endpoint URL is collected. */
export const FIXED_ENDPOINT_PROVIDER_TYPES = [
  "newrelic",
  "gcp_monitoring",
  "azure_monitor",
] as const;

/** Providers that must be given the customer's own endpoint URL. */
export const ENDPOINT_REQUIRED_PROVIDER_TYPES = ["jaeger", "splunk"] as const;

export function providerEndpointRequirementError(
  connectorType: string,
  endpointUrl: string | null,
): string | null {
  if (
    endpointUrl &&
    (ENDPOINT_REQUIRED_PROVIDER_TYPES as readonly string[]).includes(connectorType)
  ) {
    try {
      if (new URL(endpointUrl).search) {
        return "The endpoint URL must not include a query string";
      }
    } catch {
      return "Enter a valid endpoint URL";
    }
  }
  if (
    !endpointUrl &&
    (ENDPOINT_REQUIRED_PROVIDER_TYPES as readonly string[]).includes(connectorType)
  ) {
    return connectorType === "splunk"
      ? "Splunk requires the management endpoint URL, for example https://splunk.example.com:8089"
      : "Jaeger requires the query service URL, for example https://jaeger.example.com";
  }
  return null;
}

/** Flat primitive fields only; nested objects are never forwarded to a provider. */
export function flatCredentialFields(value: ConnectorCredentialValue | null) {
  if (!value) return null;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string | number | boolean | null] =>
        entry[1] === null || typeof entry[1] !== "object",
    ),
  );
}

function nonEmpty(value: ConnectorCredentialValue, keys: string[]) {
  return keys.some((key) => {
    const candidate = value[key];
    return typeof candidate === "string" && candidate.trim().length > 0;
  });
}

/** Credential shape checks for the observability providers; null when valid or not one of them. */
export function providerCredentialRequirementError(
  connectorType: string,
  value: ConnectorCredentialValue,
): string | null {
  try {
    switch (connectorType) {
      case "newrelic": {
        if (!nonEmpty(value, ["apiKey", "api_key", "secret"])) {
          return "New Relic requires a User API key";
        }
        const accountId = value.accountId;
        if (!/^\d{1,12}$/.test(String(accountId ?? "").trim())) {
          return "New Relic requires a numeric account ID";
        }
        const region = String(value.region ?? "us").trim().toLowerCase();
        return region === "us" || region === "eu"
          ? null
          : "New Relic region must be us or eu";
      }
      case "splunk":
        return nonEmpty(value, ["secret", "apiKey"])
          ? null
          : "Splunk requires an authentication token";
      case "gcp_monitoring":
        parseGcpCredential(value as ProviderCredential);
        return null;
      case "azure_monitor":
        parseAzureCredential(value as ProviderCredential);
        return null;
      default:
        return null;
    }
  } catch (error) {
    return error instanceof Error
      ? error.message.replace(/^invalid credentials:\s*/i, "")
      : "Invalid credentials";
  }
}
