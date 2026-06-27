import type { NotificationProviderType } from "@/db/schema";
import { validateWebhookUrlString } from "@/lib/url-validator";
import {
  normalizeWebhookMethod,
  parseWebhookJsonTemplate,
} from "@/lib/notification-providers/webhook-template";
import { getWebhookPreset } from "@/lib/notification-providers/webhook-presets";

const WEBHOOK_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const WEBHOOK_MAX_HEADERS = 20;
const WEBHOOK_MAX_HEADER_VALUE_LENGTH = 1000;
const WEBHOOK_BLOCKED_HEADERS = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
]);

/**
 * Known-safe webhook endpoint hostnames per provider type.
 * Used as defense-in-depth to ensure webhook URLs target legitimate services.
 */
const PROVIDER_ALLOWED_HOSTS: Partial<Record<NotificationProviderType, string[]>> = {
  slack: ["hooks.slack.com"],
  discord: [
    "discord.com",
    "discordapp.com",
    "canary.discord.com",
    "ptb.discord.com",
  ],
  teams: [
    "outlook.office.com",
    "outlook.office365.com",
    "webhook.office.com",
    ".webhook.office.com",
    ".logic.azure.com",
    ".azurewebsites.net",
  ],
};

/**
 * Validate a webhook URL for SSRF safety and optionally check against provider-specific allowlist.
 * Reusable across create, update, and test paths to follow DRY principle.
 *
 * @throws Error if URL is invalid, targets private networks, or doesn't match provider allowlist
 */
export function validateProviderWebhookUrl(
  url: string,
  providerType: NotificationProviderType,
  fieldName: string = "URL"
): void {
  // SSRF validation: block private/internal IPs and require HTTPS
  const urlValidation = validateWebhookUrlString(url);
  if (!urlValidation.valid) {
    throw new Error(`${fieldName}: ${urlValidation.error || "Invalid URL"}`);
  }

  // Provider-specific hostname allowlist validation
  const allowedHosts = PROVIDER_ALLOWED_HOSTS[providerType];
  if (allowedHosts && allowedHosts.length > 0) {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.toLowerCase();
      const isAllowed = allowedHosts.some((allowed) => {
        if (allowed.startsWith(".")) {
          // Suffix match for wildcard subdomains
          return hostname.endsWith(allowed) || hostname === allowed.slice(1);
        }
        return hostname === allowed;
      });
      if (!isAllowed) {
        throw new Error(
          `${fieldName} must target a valid ${providerType} endpoint (${allowedHosts.filter((h) => !h.startsWith(".")).join(", ")})`
        );
      }
    } catch (parseError) {
      if (parseError instanceof Error && parseError.message.includes("must target")) {
        throw parseError;
      }
      throw new Error(`${fieldName}: Invalid URL format`);
    }
  }
}

export function validateProviderConfig(
  type: NotificationProviderType,
  config: Record<string, unknown>
) {
  const missing = (field: string) =>
    !config[field] ||
    (typeof config[field] === "string" && !(config[field] as string).trim());

  switch (type) {
    case "email":
      if (missing("emails")) {
        throw new Error(
          "Email notification providers require at least one email address."
        );
      }
      break;
    case "slack":
      if (missing("webhookUrl")) {
        throw new Error("Slack notification providers require a webhook URL.");
      }
      validateProviderWebhookUrl(config.webhookUrl as string, "slack", "Webhook URL");
      break;
    case "webhook":
      if (missing("url")) {
        throw new Error("Webhook notification providers require a target URL.");
      }
      validateProviderWebhookUrl(config.url as string, "webhook", "Target URL");
      if (config.method !== undefined) {
        normalizeWebhookMethod(config.method);
      }
      if (config.preset !== undefined && !getWebhookPreset(config.preset)) {
        throw new Error("Webhook preset is not supported.");
      }
      validateWebhookHeaders(config.headers);
      if (
        typeof config.bodyTemplate === "string" &&
        config.bodyTemplate.trim().length > 0
      ) {
        parseWebhookJsonTemplate(config.bodyTemplate);
      }
      break;
    case "telegram":
      if (missing("botToken") || missing("chatId")) {
        throw new Error(
          "Telegram notification providers require both bot token and chat ID."
        );
      }
      break;
    case "discord":
      if (missing("discordWebhookUrl")) {
        throw new Error(
          "Discord notification providers require a webhook URL."
        );
      }
      validateProviderWebhookUrl(config.discordWebhookUrl as string, "discord", "Discord Webhook URL");
      break;
    case "teams":
      if (missing("teamsWebhookUrl")) {
        throw new Error(
          "Microsoft Teams notification providers require a webhook URL."
        );
      }
      validateProviderWebhookUrl(config.teamsWebhookUrl as string, "teams", "Teams Webhook URL");
      break;
    default:
      throw new Error("Unsupported notification provider type.");
  }
}

export function validateWebhookHeaders(headers: unknown): void {
  if (headers === undefined || headers === null) {
    return;
  }

  normalizeWebhookHeaders(headers);
}

export function normalizeWebhookHeaders(
  headers: unknown,
): Record<string, string> | undefined {
  if (headers === undefined || headers === null) {
    return undefined;
  }

  if (
    typeof headers !== "object" ||
    Array.isArray(headers)
  ) {
    throw new Error("Webhook headers must be a JSON object.");
  }

  const normalizedEntries = Object.entries(headers as Record<string, unknown>)
    .map(([rawName, rawValue]) => {
      const name = rawName.trim();
      const value =
        typeof rawValue === "string" ? rawValue.trim() : rawValue;
      return [name, value] as const;
    })
    .filter(([name, value]) => {
      return name.length > 0 || (typeof value === "string" && value.length > 0);
    });

  if (normalizedEntries.length > WEBHOOK_MAX_HEADERS) {
    throw new Error(
      `Webhook headers cannot exceed ${WEBHOOK_MAX_HEADERS} entries.`,
    );
  }

  const normalizedHeaders: Record<string, string> = {};
  const seenHeaderNames = new Set<string>();

  for (const [name, value] of normalizedEntries) {
    const lowerName = name.toLowerCase();

    if (!WEBHOOK_HEADER_NAME_PATTERN.test(name)) {
      throw new Error(`Webhook header "${name}" has an invalid name.`);
    }

    if (WEBHOOK_BLOCKED_HEADERS.has(lowerName)) {
      throw new Error(`Webhook header "${name}" is managed by Supercheck.`);
    }

    if (seenHeaderNames.has(lowerName)) {
      throw new Error(`Webhook header "${name}" is duplicated.`);
    }

    if (typeof value !== "string") {
      throw new Error(`Webhook header "${name}" value must be a string.`);
    }

    if (value.length > WEBHOOK_MAX_HEADER_VALUE_LENGTH) {
      throw new Error(
        `Webhook header "${name}" cannot exceed ${WEBHOOK_MAX_HEADER_VALUE_LENGTH} characters.`,
      );
    }

    seenHeaderNames.add(lowerName);
    normalizedHeaders[name] = value;
  }

  return Object.keys(normalizedHeaders).length > 0
    ? normalizedHeaders
    : undefined;
}

export function normalizeProviderConfig(
  type: NotificationProviderType,
  config: Record<string, unknown>
): Record<string, unknown> {
  if (type !== "webhook") {
    return { ...config };
  }

  const normalizedConfig = { ...config };

  if (config.method !== undefined) {
    normalizedConfig.method = normalizeWebhookMethod(config.method);
  }

  const normalizedHeaders = normalizeWebhookHeaders(config.headers);
  if (normalizedHeaders) {
    normalizedConfig.headers = normalizedHeaders;
  } else {
    delete normalizedConfig.headers;
  }

  if (typeof config.bodyTemplate === "string") {
    const trimmedBodyTemplate = config.bodyTemplate.trim();
    if (trimmedBodyTemplate) {
      normalizedConfig.bodyTemplate = trimmedBodyTemplate;
    } else {
      delete normalizedConfig.bodyTemplate;
    }
  }

  return normalizedConfig;
}
