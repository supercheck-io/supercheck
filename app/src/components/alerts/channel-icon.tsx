import { Siren, Webhook } from "lucide-react";
import { ConnectorTypeIcon } from "@/components/logo/connector-logos";
import { notificationProviders } from "@/components/alerts/data";
import { cn } from "@/lib/utils";

// Brand marks come from Simple Icons (CC0) via the connector logos; Better Stack
// is copied here. incident.io has no free mark, so it uses a lucide fallback.
const BETTER_STACK_PATH =
  "m.7792 10.7479-.7654 6.6384a2.0957 2.0957 0 0 0 .696 1.8122l1.8965 1.672c.6494.5725 1.658.0145 1.5185-.84L2.6039 10.705c-.1723-1.056-1.7022-1.02-1.8247.0429Zm12.3733 8.714L8.63 6.431c-.5023-1.4472-2.6082-1.3845-3.0203.0898l-1.376 4.9234c-.156.559-.216.8822.0005 1.4212h.5225l1.8993 6.0694c.294.7324.9017 1.3009 1.6611 1.5538l2.8315.9435c1.2417.4137 2.4268-.7513 2.004-1.97zm10.6297-1.0332L15.7907 3.4433c-.6971-1.3072-2.5779-1.2727-3.227.0589l-1.9652 3.9555c-.2375.487-.1274.6608.07.9435.1585.2268.526.2447.6758.012.147-.2287.488-.2076.6058.0375l5.1379 10.687a2.735 2.735 0 0 0 2.1416 1.6016l2.7183.3476c1.4628.1924 2.5299-1.3539 1.8343-2.6582z";

function BetterStackMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={cn("shrink-0 text-foreground", className)}>
      <path d={BETTER_STACK_PATH} />
    </svg>
  );
}

const PRESET_CONNECTOR_LOGO: Record<string, string> = {
  pagerduty: "pagerduty",
  jsm_ops: "jira",
  splunk_on_call: "splunk",
};

/**
 * One logo for every channel type and paging preset, always 16px by default and
 * decorative (aria-hidden): callers render the visible label next to it.
 */
export function ChannelTypeIcon({
  type,
  presetId,
  className = "h-4 w-4",
}: {
  type: string;
  presetId?: string;
  className?: string;
}) {
  if (type === "webhook" && presetId && presetId !== "custom") {
    const connector = PRESET_CONNECTOR_LOGO[presetId];
    if (connector) return <ConnectorTypeIcon type={connector} className={className} />;
    if (presetId === "better_stack") return <BetterStackMark className={className} />;
    return <Siren aria-hidden="true" className={cn("shrink-0 text-muted-foreground", className)} />;
  }
  if (type === "webhook") {
    return <Webhook aria-hidden="true" className={cn("shrink-0 text-muted-foreground", className)} />;
  }
  const provider = notificationProviders.find((p) => p.type === type);
  if (!provider) return <Webhook aria-hidden="true" className={cn("shrink-0 text-muted-foreground", className)} />;
  const Icon = provider.icon;
  return (
    <span aria-hidden="true" className="inline-flex shrink-0">
      <Icon className={cn("shrink-0", provider.color, className)} />
    </span>
  );
}
