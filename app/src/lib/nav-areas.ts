import {
  Bot, BellRing, Boxes, Cable, CalendarClock, ChartColumn, ClipboardList, Code, Globe, History,
  RadioTower, ShieldCheck, Siren, SquareLibrary, Tally4, Target, UserCog, Variable,
  type LucideIcon,
} from "lucide-react";

import type { AreaTone, NavTone } from "@/components/ui/icon-chip";
import { TYPE_ACTIVE_ICON, TYPE_TEXT, TYPE_TONE } from "@/lib/type-tones";

/**
 * Single source of truth for each destination's icon and area colour (DESIGN.md).
 * The sidebar, command palette, Quick Create and page headers all read from here.
 */
type NavEntry = { title: string; icon: LucideIcon; tone: NavTone };

export const NAV = {
  dashboard: { title: "Dashboard", icon: ChartColumn, tone: "respond" },
  incidents: { title: "Incidents", icon: Siren, tone: "respond" },
  services: { title: "Services", icon: Boxes, tone: TYPE_TONE.sre.service },
  integrations: { title: "Integrations", icon: Cable, tone: TYPE_TONE.sre.integration },
  savedQueries: { title: "Saved queries", icon: SquareLibrary, tone: "respond" },
  privateAgents: { title: "Private Agents", icon: RadioTower, tone: TYPE_TONE.sre.privateAgent },
  copilot: { title: "Copilot", icon: Bot, tone: "ai" },
  statusPages: { title: "Status Pages", icon: Tally4, tone: "statuspage" },
  notifications: { title: "Notifications", icon: BellRing, tone: "communicate" },
  deliveryHistory: { title: "Delivery history", icon: History, tone: "communicate" },
  requirements: { title: "Requirements", icon: Target, tone: "automate" },
  tests: { title: "Tests", icon: Code, tone: "automate" },
  jobs: { title: "Jobs", icon: CalendarClock, tone: "automate" },
  runs: { title: "Runs", icon: ClipboardList, tone: "automate" },
  variables: { title: "Variables", icon: Variable, tone: "automate" },
  monitors: { title: "Monitors", icon: Globe, tone: "monitor" },
  organization: { title: "Organization", icon: UserCog, tone: "organization" },
  superAdmin: { title: "Super Admin", icon: ShieldCheck, tone: "superadmin" },
} satisfies Record<string, NavEntry>;

// Static class strings so Tailwind can see them.
/** Text colour of a destination: its area token, or the type token it takes from type-tones.ts. */
export const AREA_TEXT: Record<NavTone, string> = {
  ...TYPE_TEXT,
  automate: "text-automate",
  monitor: "text-monitor",
  respond: "text-respond",
  communicate: "text-communicate",
  ai: "text-ai",
  organization: "text-organization",
  superadmin: "text-superadmin",
  statuspage: "text-statuspage",
};

/** Active sidebar icon takes the item's area colour. */
export const AREA_ACTIVE_ICON: Record<NavTone, string> = {
  ...TYPE_ACTIVE_ICON,
  automate: "[&[data-active=true]>svg]:text-automate",
  monitor: "[&[data-active=true]>svg]:text-monitor",
  respond: "[&[data-active=true]>svg]:text-respond",
  communicate: "[&[data-active=true]>svg]:text-communicate",
  ai: "[&[data-active=true]>svg]:text-ai",
  organization: "[&[data-active=true]>svg]:text-organization",
  superadmin: "[&[data-active=true]>svg]:text-superadmin",
  statuspage: "[&[data-active=true]>svg]:text-statuspage",
};
