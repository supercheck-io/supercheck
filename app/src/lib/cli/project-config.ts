import { createHmac } from "crypto";
import type {
  NotificationProviderType,
  PlainNotificationProviderConfig,
} from "@/db/schema";
import type {
  SreIntegrationCorrelationStrategy,
  SreIntegrationKey,
} from "@/lib/sre/integration-bindings";

export const CLI_PROJECT_CONFIG_SCHEMA_VERSION = 1;
export const CLI_PROJECT_CONFIG_HASH_VERSION = "hmac-sha256:v1";

export type CliProjectConfigNotificationProviderInput = {
  id: string;
  name: string;
  type: NotificationProviderType;
  isEnabled: boolean;
  config: PlainNotificationProviderConfig;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type CliProjectConfigSreIntegrationBindingInput = {
  id: string;
  integrationKey: SreIntegrationKey;
  correlationStrategy: SreIntegrationCorrelationStrategy;
  enabled: boolean;
  notificationProviderId: string;
  externalConnectorId: string;
  externalConnectorName: string;
  externalConnectorType: string;
  externalConnectorStatus: string;
  serviceIds: string[];
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type CliProjectConfigProviderSummary = Record<string, unknown> & {
  secretHandling: "redacted";
};

export type CliProjectConfigNotificationProvider = {
  id: string;
  name: string;
  type: NotificationProviderType;
  enabled: boolean;
  configSummary: CliProjectConfigProviderSummary;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CliProjectConfigSreIntegrationBinding = {
  id: string;
  integrationKey: SreIntegrationKey;
  correlationStrategy: SreIntegrationCorrelationStrategy;
  enabled: boolean;
  notificationProviderId: string;
  externalConnector: {
    id: string;
    name: string;
    type: string;
    status: string;
  };
  serviceIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type CliProjectConfigSnapshot = {
  schemaVersion: typeof CLI_PROJECT_CONFIG_SCHEMA_VERSION;
  generatedAt: string;
  hashVersion: typeof CLI_PROJECT_CONFIG_HASH_VERSION;
  organization: {
    id: string;
    name: string | null;
    slug: string | null;
  };
  project: {
    id: string;
    name: string;
    slug: string | null;
  };
  notificationProviders: CliProjectConfigNotificationProvider[];
  sreIntegrationBindings: CliProjectConfigSreIntegrationBinding[];
  warnings: string[];
};

export function buildCliProjectConfigSnapshot(input: {
  generatedAt: Date;
  hashKey: string;
  organization: {
    id: string;
    name?: string | null;
    slug?: string | null;
  };
  project: {
    id: string;
    name: string;
    slug?: string | null;
  };
  notificationProviders: CliProjectConfigNotificationProviderInput[];
  sreIntegrationBindings: CliProjectConfigSreIntegrationBindingInput[];
}): CliProjectConfigSnapshot {
  return {
    schemaVersion: CLI_PROJECT_CONFIG_SCHEMA_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    hashVersion: CLI_PROJECT_CONFIG_HASH_VERSION,
    organization: {
      id: input.organization.id,
      name: input.organization.name ?? null,
      slug: input.organization.slug ?? null,
    },
    project: {
      id: input.project.id,
      name: input.project.name,
      slug: input.project.slug ?? null,
    },
    notificationProviders: input.notificationProviders.map((provider) =>
      serializeNotificationProviderForCli(provider, input.hashKey),
    ),
    sreIntegrationBindings: input.sreIntegrationBindings.map(
      serializeSreIntegrationBindingForCli,
    ),
    warnings: [
      "Notification provider endpoint URLs, tokens, headers, and message templates are redacted. Use this snapshot for pull/diff; deploy flows must send explicit replacement secrets.",
    ],
  };
}

export function serializeNotificationProviderForCli(
  provider: CliProjectConfigNotificationProviderInput,
  hashKey: string,
): CliProjectConfigNotificationProvider {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    enabled: provider.isEnabled,
    configSummary: summarizeProviderConfig(provider.type, provider.config, hashKey),
    createdAt: toIsoString(provider.createdAt),
    updatedAt: toIsoString(provider.updatedAt),
  };
}

export function serializeSreIntegrationBindingForCli(
  binding: CliProjectConfigSreIntegrationBindingInput,
): CliProjectConfigSreIntegrationBinding {
  return {
    id: binding.id,
    integrationKey: binding.integrationKey,
    correlationStrategy: binding.correlationStrategy,
    enabled: binding.enabled,
    notificationProviderId: binding.notificationProviderId,
    externalConnector: {
      id: binding.externalConnectorId,
      name: binding.externalConnectorName,
      type: binding.externalConnectorType,
      status: binding.externalConnectorStatus,
    },
    serviceIds: [...binding.serviceIds].sort(),
    createdAt: toIsoString(binding.createdAt),
    updatedAt: toIsoString(binding.updatedAt),
  };
}

function summarizeProviderConfig(
  type: NotificationProviderType,
  config: PlainNotificationProviderConfig,
  hashKey: string,
): CliProjectConfigProviderSummary {
  switch (type) {
    case "email":
      return {
        secretHandling: "redacted",
        recipientCount: countEmailRecipients(config.emails),
        recipientsConfigured: hasText(config.emails),
      };
    case "slack":
      return {
        secretHandling: "redacted",
        webhookUrlConfigured: hasText(config.webhookUrl),
        webhookUrlFingerprint: fingerprintText(config.webhookUrl, hashKey),
        channelConfigured: hasText(config.channel),
      };
    case "discord":
      return {
        secretHandling: "redacted",
        webhookUrlConfigured: hasText(config.discordWebhookUrl),
        webhookUrlFingerprint: fingerprintText(config.discordWebhookUrl, hashKey),
      };
    case "teams":
      return {
        secretHandling: "redacted",
        webhookUrlConfigured: hasText(config.teamsWebhookUrl),
        webhookUrlFingerprint: fingerprintText(config.teamsWebhookUrl, hashKey),
      };
    case "telegram":
      return {
        secretHandling: "redacted",
        botTokenConfigured: hasText(config.botToken),
        botTokenFingerprint: fingerprintText(config.botToken, hashKey),
        chatIdConfigured: hasText(config.chatId),
        chatIdFingerprint: fingerprintText(config.chatId, hashKey),
      };
    case "webhook":
      return summarizeWebhookConfig(config, hashKey);
  }
}

function summarizeWebhookConfig(
  config: PlainNotificationProviderConfig,
  hashKey: string,
): CliProjectConfigProviderSummary {
  const headers = readStringRecord(config.headers);
  const bodyTemplate = typeof config.bodyTemplate === "string"
    ? config.bodyTemplate
    : undefined;

  return {
    secretHandling: "redacted",
    preset: config.preset ?? "custom",
    method: config.method ?? "POST",
    endpointConfigured: hasText(config.url),
    endpointFingerprint: fingerprintText(config.url, hashKey),
    headersConfigured: headers.size > 0,
    headerNames: Array.from(headers.keys()).sort(),
    bodyTemplateConfigured: hasText(bodyTemplate),
    bodyTemplateFingerprint: fingerprintText(bodyTemplate, hashKey),
  };
}

function countEmailRecipients(value: unknown): number {
  if (typeof value !== "string") {
    return 0;
  }

  return value
    .split(/[,;\n]/)
    .map((recipient) => recipient.trim())
    .filter(Boolean).length;
}

function readStringRecord(value: unknown): Map<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Map();
  }

  const entries: Array<[string, string]> = [];
  for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.trim();
    if (normalizedKey.length > 0 && typeof headerValue === "string") {
      entries.push([normalizedKey, headerValue]);
    }
  }

  return new Map(entries);
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function fingerprintText(value: unknown, hashKey: string): string | null {
  if (!hasText(value)) {
    return null;
  }

  return createHmac("sha256", hashKey)
    .update(value as string)
    .digest("hex");
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
