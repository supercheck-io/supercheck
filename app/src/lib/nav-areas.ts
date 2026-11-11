import {
  Bot, BellRing, Boxes, Cable, CalendarClock, ChartColumn, ClipboardList, Code, Globe, History,
  RadioTower, ShieldCheck, Siren, SquareLibrary, Tally4, Target, UserCog, Variable,
  type LucideIcon,
} from "lucide-react";

import type { AreaTone } from "@/components/ui/icon-chip";

/**
 * Single source of truth for each destination's icon and area colour (DESIGN.md).
 * The sidebar, command palette, Quick Create and page headers all read from here.
 */
type NavEntry = { title: string; icon: LucideIcon; tone: AreaTone };

export const NAV = {
  dashboard: { title: "Dashboard", icon: ChartColumn, tone: "respond" },
  incidents: { title: "Incidents", icon: Siren, tone: "respond" },
  services: { title: "Services", icon: Boxes, tone: "respond" },
  integrations: { title: "Integrations", icon: Cable, tone: "respond" },
  savedQueries: { title: "Saved queries", icon: SquareLibrary, tone: "respond" },
  privateAgents: { title: "Private Agents", icon: RadioTower, tone: "respond" },
  copilot: { title: "Copilot", icon: Bot, tone: "ai" },
  statusPages: { title: "Status Pages", icon: Tally4, tone: "communicate" },
  notifications: { title: "Notifications", icon: BellRing, tone: "communicate" },
  deliveryHistory: { title: "Delivery history", icon: History, tone: "communicate" },
  requirements: { title: "Requirements", icon: Target, tone: "automate" },
  tests: { title: "Tests", icon: Code, tone: "automate" },
  jobs: { title: "Jobs", icon: CalendarClock, tone: "automate" },
  runs: { title: "Runs", icon: ClipboardList, tone: "automate" },
  variables: { title: "Variables", icon: Variable, tone: "automate" },
  monitors: { title: "Monitors", icon: Globe, tone: "monitor" },
  organization: { title: "Organization", icon: UserCog, tone: "settings" },
  superAdmin: { title: "Super Admin", icon: ShieldCheck, tone: "settings" },
} satisfies Record<string, NavEntry>;

// Static class strings so Tailwind can see them.
export const AREA_TEXT: Record<AreaTone, string> = {
  automate: "text-automate",
  monitor: "text-monitor",
  respond: "text-respond",
  communicate: "text-communicate",
  ai: "text-ai",
  settings: "text-settings",
};

/** Active sidebar icon takes the item's area colour. */
export const AREA_ACTIVE_ICON: Record<AreaTone, string> = {
  automate: "[&[data-active=true]>svg]:text-automate",
  monitor: "[&[data-active=true]>svg]:text-monitor",
  respond: "[&[data-active=true]>svg]:text-respond",
  communicate: "[&[data-active=true]>svg]:text-communicate",
  ai: "[&[data-active=true]>svg]:text-ai",
  settings: "[&[data-active=true]>svg]:text-settings",
};
