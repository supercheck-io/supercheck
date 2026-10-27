export type ProviderCredentialField = {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
  secret: boolean;
  multiline?: boolean;
  help?: string;
};

/** Structured credential inputs for providers that need more than one value. */
export const PROVIDER_CREDENTIAL_FIELDS: Record<
  string,
  ProviderCredentialField[]
> = {
  newrelic: [
    {
      key: "apiKey",
      label: "User API key",
      placeholder: "NRAK-...",
      required: true,
      secret: true,
      help: "A User key (not a license or ingest key) from a user with read-only access.",
    },
    {
      key: "accountId",
      label: "Account ID",
      placeholder: "1234567",
      required: true,
      secret: false,
    },
    {
      key: "region",
      label: "Data region (us or eu)",
      placeholder: "us",
      required: false,
      secret: false,
    },
  ],
  gcp_monitoring: [
    {
      key: "secret",
      label: "Service account JSON key",
      placeholder: '{"type":"service_account", ...}',
      required: true,
      secret: true,
      multiline: true,
      help: "Grant Monitoring Viewer and Logs Viewer only.",
    },
    {
      key: "projectId",
      label: "Project ID",
      placeholder: "my-project-123",
      required: false,
      secret: false,
      help: "Defaults to the project in the key file.",
    },
  ],
  azure_monitor: [
    {
      key: "tenantId",
      label: "Tenant ID",
      placeholder: "Directory (tenant) ID",
      required: true,
      secret: false,
    },
    {
      key: "clientId",
      label: "Client ID",
      placeholder: "Application (client) ID",
      required: true,
      secret: false,
    },
    {
      key: "secret",
      label: "Client secret",
      placeholder: "App registration secret",
      required: true,
      secret: true,
    },
    {
      key: "workspaceId",
      label: "Log Analytics workspace ID",
      placeholder: "Needed for KQL log queries",
      required: false,
      secret: false,
    },
  ],
};

export function getProviderCredentialFields(type: string) {
  return PROVIDER_CREDENTIAL_FIELDS[type] ?? null;
}

export function buildProviderCredentialValue(
  fields: ProviderCredentialField[],
  values: Record<string, string>,
): { error: string; value?: undefined } | { value: Record<string, string>; error?: undefined } {
  const missing = fields.find(
    (field) => field.required && !values[field.key]?.trim(),
  );
  if (missing) return { error: `${missing.label} is required` };
  return {
    value: Object.fromEntries(
      fields
        .filter((field) => values[field.key]?.trim())
        .map((field) => [field.key, values[field.key].trim()]),
    ),
  };
}
