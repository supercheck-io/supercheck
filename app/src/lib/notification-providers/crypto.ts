import type {
  NotificationProviderConfig,
  NotificationProviderType,
  PlainNotificationProviderConfig,
} from "@/db/schema";
import {
  decryptJson,
  encryptJson,
  isSecretEnvelope,
  maskSecret,
  type SecretEnvelope,
} from "@/lib/security/secret-crypto";

const SENSITIVE_FIELDS: Record<NotificationProviderType, string[]> = {
  email: [],
  slack: ["webhookUrl"],
  webhook: ["url", "headers"],
  telegram: ["botToken"],
  discord: ["discordWebhookUrl"],
  teams: ["teamsWebhookUrl"],
};

const ALWAYS_SENSITIVE_FIELDS = new Set([
  "botToken",
  "webhookUrl",
  "discordWebhookUrl",
  "teamsWebhookUrl",
]);

const ALL_KNOWN_SENSITIVE_FIELDS = new Set([
  ...ALWAYS_SENSITIVE_FIELDS,
  ...Object.values(SENSITIVE_FIELDS).flat(),
]);

/**
 * Return sensitive config fields that may appear on a provider record.
 * Sensitive fields are preserved on partial config updates when the client
 * omits them (e.g. CLI pull strips masked secrets before writing to disk).
 * The list includes known fields from all provider types so stale legacy
 * fields are still treated as secrets after provider type changes.
 */
export function getSensitiveFieldsForProviderType(
  type: NotificationProviderType,
): string[] {
  return [
    ...ALL_KNOWN_SENSITIVE_FIELDS,
    ...(SENSITIVE_FIELDS[type] || []),
  ];
}

/**
 * Merge an incoming notification provider config over the existing config.
 *
 * The merge is shallow: existing fields are kept unless the incoming config
 * explicitly overrides them. Sensitive fields (e.g. webhook URLs) that are
 * omitted from the incoming config are explicitly preserved so that partial
 * updates from a pulled config do not erase secrets.
 */
export function mergeNotificationProviderConfig(
  type: NotificationProviderType,
  existingConfig: PlainNotificationProviderConfig,
  incomingConfig: PlainNotificationProviderConfig,
): PlainNotificationProviderConfig {
  const sensitiveFields = getSensitiveFieldsForProviderType(type);
  const merged = { ...existingConfig, ...incomingConfig };

  for (const field of sensitiveFields) {
    if (!(field in incomingConfig)) {
      merged[field] = existingConfig[field];
    }
  }

  if (type === "webhook") {
    // Stored credentials are bound to the exact URL they were saved for: another path on a shared host (Zapier, Make)
    // can belong to someone else. A changed preset must not fall back to the old URL either.
    const presetChanged =
      "preset" in incomingConfig && (incomingConfig.preset || "custom") !== (existingConfig.preset || "custom");
    // A sent url that is not a string counts as a change: validation rejects it later, the merge must not trust it.
    const urlChanged =
      "url" in incomingConfig &&
      (typeof incomingConfig.url !== "string" || normalizedUrl(incomingConfig.url) !== normalizedUrl(existingConfig.url));
    if (presetChanged && !("url" in incomingConfig)) delete merged.url;
    const hasStoredHeaders =
      typeof existingConfig.headers === "object" &&
      existingConfig.headers !== null &&
      Object.keys(existingConfig.headers).length > 0;
    if ((presetChanged || urlChanged) && !("headers" in incomingConfig) && hasStoredHeaders) {
      throw new Error(
        "Enter the webhook headers again, or {} for none: saved headers are not sent to a new URL or preset."
      );
    }
  }

  return merged;
}

function normalizedUrl(url: unknown): string | undefined {
  try {
    return new URL(String(url)).href;
  } catch {
    return undefined;
  }
}

export function encryptNotificationProviderConfig(
  config: PlainNotificationProviderConfig,
  context?: string,
): SecretEnvelope {
  return encryptJson(config, { context });
}

export function decryptNotificationProviderConfig(
  config: NotificationProviderConfig,
  context?: string,
): PlainNotificationProviderConfig {
  if (isSecretEnvelope(config)) {
    return decryptJson<PlainNotificationProviderConfig>(config, { context });
  }

  return (config as PlainNotificationProviderConfig) ?? {};
}

export function sanitizeConfigForClient(
  type: NotificationProviderType,
  config: PlainNotificationProviderConfig,
): {
  sanitizedConfig: PlainNotificationProviderConfig;
  maskedFields: string[];
} {
  const sanitized: PlainNotificationProviderConfig = { ...config };
  const maskedFields: string[] = [];

  const fieldsToMask = new Set([
    ...ALL_KNOWN_SENSITIVE_FIELDS,
    ...(SENSITIVE_FIELDS[type] || []),
  ]);

  fieldsToMask.forEach((field) => {
    if (sanitized[field] !== undefined && sanitized[field] !== null) {
      maskedFields.push(field);
      const value = sanitized[field];

      if (typeof value === "string" && value.length > 0) {
        sanitized[field] = maskSecret(value);
      } else if (field === "headers") {
        sanitized[field] = {};
      } else {
        sanitized[field] = undefined;
      }
    }
  });

  return { sanitizedConfig: sanitized, maskedFields };
}

export function isEncryptedNotificationConfig(
  config: NotificationProviderConfig,
): config is SecretEnvelope {
  return isSecretEnvelope(config);
}
