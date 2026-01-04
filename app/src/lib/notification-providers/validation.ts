import type { NotificationProviderType } from "@/db/schema";

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
      break;
    case "webhook":
      if (missing("url")) {
        throw new Error("Webhook notification providers require a target URL.");
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
      break;
    case "teams":
      if (missing("teamsWebhookUrl")) {
        throw new Error(
          "Microsoft Teams notification providers require a webhook URL."
        );
      }
      break;
    default:
      throw new Error("Unsupported notification provider type.");
  }
}
