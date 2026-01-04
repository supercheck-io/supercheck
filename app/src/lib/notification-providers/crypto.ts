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
    ...ALWAYS_SENSITIVE_FIELDS,
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
