import type { NotificationProviderType } from "@/db/schema";
import { validateWebhookUrlString } from "@/lib/url-validator";

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
