import {
  CheckCircle,
  AlertCircle,
  Clock,
  XCircle,
  Mail,
  Webhook,
  BotMessageSquare,
} from "lucide-react";
import { MicrosoftTeamsLogo } from "@/components/logo/microsoft-teams-logo";
import { TelegramLogo } from "@/components/logo/telegram-logo";
import { SlackLogo } from "@/components/logo/slack-logo";
import { DiscordLogo } from "@/components/logo/discord-logo";

export const alertStatuses = [
  {
    value: "sent",
    label: "Sent",
    icon: CheckCircle,
    color: "text-green-500",
  },
  {
    value: "failed",
    label: "Failed",
    icon: XCircle,
    color: "text-red-500",
  },
  {
    value: "pending",
    label: "Pending",
    icon: Clock,
    color: "text-yellow-500",
  },
  {
    value: "error",
    label: "Error",
    icon: AlertCircle,
    color: "text-orange-500",
  },
];

export const alertTypes = [
  {
    value: "job_failed",
    label: "Job Failed",
    icon: XCircle,
    color: "text-red-500",
  },
  {
    value: "job_success",
    label: "Job Success",
    icon: CheckCircle,
    color: "text-green-500",
  },
  {
    value: "job_timeout",
    label: "Job Timeout",
    icon: Clock,
    color: "text-yellow-500",
  },
  {
    value: "monitor_failure",
    label: "Monitor Failure",
    icon: XCircle,
    color: "text-red-500",
  },
  {
    value: "monitor_recovery",
    label: "Monitor Recovery",
    icon: CheckCircle,
    color: "text-green-500",
  },
  {
    value: "ssl_expiring",
    label: "SSL Expiring",
    icon: AlertCircle,
    color: "text-orange-500",
  },
];

export const notificationProviders = [
  {
    type: "email",
    label: "Email",
    icon: Mail,
    color: "text-blue-500",
  },
  {
    type: "slack",
    label: "Slack",
    icon: SlackLogo,
    color: "text-sky-500",
  },
  {
    type: "webhook",
    label: "Webhook",
    icon: Webhook,
    color: "text-green-500",
  },
  {
    type: "telegram",
    label: "Telegram",
    icon: TelegramLogo,
    color: "text-blue-400",
  },
  {
    type: "discord",
    label: "Discord",
    icon: DiscordLogo,
    color: "text-indigo-500",
  },
  {
    type: "teams",
    label: "Microsoft Teams",
    icon: MicrosoftTeamsLogo,
    color: "text-[#6264A7]",
  },
];

export const getNotificationProviderConfig = (type: string) => {
  // First try exact match
  const exactMatch = notificationProviders.find(provider => provider.type === type);
  if (exactMatch) {
    return exactMatch;
  }

  // If no exact match, try case-insensitive match
  const caseInsensitiveMatch = notificationProviders.find(provider =>
    provider.type.toLowerCase() === type.toLowerCase()
  );
  if (caseInsensitiveMatch) {
    return caseInsensitiveMatch;
  }

  // If still no match, create a fallback config for unknown providers
  return {
    type: type,
    label: type.charAt(0).toUpperCase() + type.slice(1), // Capitalize first letter
    icon: BotMessageSquare, // Default icon
    color: "text-gray-500", // Default color
  };
};
