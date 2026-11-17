import {
  ArrowLeftRight, CalendarClock, Chrome, Database, SquareFunction, Bot,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import { K6Logo } from "@/components/logo/k6-logo";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { notificationProviders } from "@/components/alerts/data";
import { AREA_TEXT, NAV } from "@/lib/nav-areas";
import { ADMIN_TYPES, MONITOR_ICON, TYPE_TEXT, TYPE_TEXT_FORCE, VARIABLE_TYPES, typeTone, type TypeTone } from "@/lib/type-tones";

/**
 * Every "create" destination, in Quick Create order. The sidebar Create menus and the Cmd+K Create
 * section render from this list, so an action has one icon and one colour everywhere (DESIGN.md).
 * `text` is "" for brand marks (Playwright, k6) that keep their own colours.
 */
type Icon = LucideIcon | ComponentType<{ className?: string }>;

export type CreateCapability = "incidents" | "maintenance" | "sreServices" | "sreConnectors" | "projects" | "members" | "cliTokens";
export type CreateCapabilities = {
  canDeclareIncidents: boolean;
  canScheduleMaintenance: boolean;
  canCreateProjects: boolean;
  canInviteMembers: boolean;
  canCreateCliTokens: boolean;
  canCreateSreServices: boolean;
  canConfigureSreConnectors: boolean;
};
export const CAPABILITY_FLAG: Record<CreateCapability, keyof CreateCapabilities> = {
  incidents: "canDeclareIncidents",
  maintenance: "canScheduleMaintenance",
  sreServices: "canCreateSreServices",
  sreConnectors: "canConfigureSreConnectors",
  projects: "canCreateProjects",
  members: "canInviteMembers",
  cliTokens: "canCreateCliTokens",
};

export type CreateGroupId =
  | "respond" | "tests" | "jobs" | "sre" | "admin" | "monitors" | "statusPages" | "variables" | "notifications";

export type CreateAction = {
  id: string;
  group: CreateGroupId;
  title: string;
  url: string;
  icon: Icon;
  /** Plain text colour class ("" keeps the icon's own brand colour). */
  text: string;
  /** Same colour with `!`, for the sidebar. */
  force: string;
  gate?: CreateCapability;
};

/** Group headings, in Quick Create order. */
export const CREATE_GROUPS: Array<{ id: CreateGroupId; heading: string }> = [
  { id: "respond", heading: "Respond to an incident" },
  { id: "tests", heading: "Create test" },
  { id: "jobs", heading: "Create job" },
  { id: "sre", heading: "Configure AI SRE" },
  { id: "admin", heading: "Admin setup" },
  { id: "monitors", heading: "Create monitor" },
  { id: "statusPages", heading: "Create status page" },
  { id: "variables", heading: "Create variable" },
  { id: "notifications", heading: "Create notification provider" },
];

const typed = (tone: TypeTone) => ({ text: TYPE_TEXT[tone], force: TYPE_TEXT_FORCE[tone] });
const test = (key: keyof typeof import("@/lib/type-tones").TYPE_TONE.test, title: string, icon: Icon): CreateAction => ({
  id: `test-${key}`, group: "tests", title, url: `/playground?scriptType=${key}`, icon, ...typed(typeTone("test", key)),
});
const monitor = (
  key: keyof typeof import("@/lib/type-tones").TYPE_TONE.monitor, title: string, icon: Icon, brand = false,
): CreateAction => ({
  id: `monitor-${key}`, group: "monitors", title, url: `/monitors/create?type=${key}`, icon,
  ...(brand ? { text: "", force: "" } : typed(typeTone("monitor", key))),
});

export const CREATE_ACTIONS: CreateAction[] = [
  {
    id: "respond-incident", group: "respond", title: "Declare incident", url: "/incidents?new=1", icon: NAV.incidents.icon,
    text: AREA_TEXT[NAV.incidents.tone], force: "", gate: "incidents",
  },
  {
    id: "respond-maintenance", group: "respond", title: "Schedule maintenance", url: "/monitors?tab=maintenance&new=1", icon: CalendarClock,
    text: AREA_TEXT[NAV.monitors.tone], force: "", gate: "maintenance",
  },

  test("browser", "Browser Test", Chrome),
  test("api", "API Test", ArrowLeftRight),
  test("database", "Database Test", Database),
  test("custom", "Custom Test", SquareFunction),
  test("agent", "Agent Test", Bot),
  // The k6 mark keeps its brand purple.
  { ...test("performance", "Performance Test", K6Logo), text: "", force: "" },

  { id: "job-playwright", group: "jobs", title: "Playwright Job", url: "/jobs/create/playwright", icon: PlaywrightLogo, text: "", force: "" },
  { id: "job-k6", group: "jobs", title: "k6 Performance Job", url: "/jobs/create/k6", icon: K6Logo, text: "", force: "" },

  { id: "sre-service", group: "sre", title: "Service", url: "/services", icon: NAV.services.icon, ...typed(typeTone("sre", "service")), gate: "sreServices" },
  { id: "sre-integration", group: "sre", title: "Integration", url: "/org-admin?tab=integrations", icon: NAV.integrations.icon, ...typed(typeTone("sre", "integration")), gate: "sreConnectors" },
  { id: "sre-private-agent", group: "sre", title: "Private Agent", url: "/org-admin?tab=private-agents", icon: NAV.privateAgents.icon, ...typed(typeTone("sre", "privateAgent")), gate: "sreConnectors" },

  { id: "admin-project", group: "admin", title: "Project", url: "/org-admin?tab=projects", icon: ADMIN_TYPES.project.icon, ...typed(typeTone("admin", "project")), gate: "projects" },
  { id: "admin-member", group: "admin", title: "Member", url: "/org-admin?tab=members", icon: ADMIN_TYPES.member.icon, ...typed(typeTone("admin", "member")), gate: "members" },
  { id: "admin-cli-token", group: "admin", title: "CLI Token", url: "/org-admin?tab=cli-tokens", icon: ADMIN_TYPES.cliToken.icon, ...typed(typeTone("admin", "cliToken")), gate: "cliTokens" },

  monitor("http_request", "HTTP Monitor", MONITOR_ICON.http_request),
  monitor("website", "Website Monitor", MONITOR_ICON.website),
  monitor("ping_host", "Ping Monitor", MONITOR_ICON.ping_host),
  monitor("port_check", "Port Monitor", MONITOR_ICON.port_check),
  monitor("synthetic_test", "Synthetic Monitor", PlaywrightLogo, true),
  monitor("mcp_server", "MCP Monitor", MONITOR_ICON.mcp_server),
  monitor("ai_endpoint", "AI Endpoint Monitor", MONITOR_ICON.ai_endpoint),
  monitor("heartbeat", "Heartbeat Monitor", MONITOR_ICON.heartbeat),

  {
    id: "status-page", group: "statusPages", title: "Status Page", url: "/status-pages?create=true", icon: NAV.statusPages.icon,
    text: AREA_TEXT[NAV.statusPages.tone], force: "",
  },

  ...(["variable", "secret", "file"] as const).map((key): CreateAction => ({
    id: `variable-${key}`, group: "variables", title: VARIABLE_TYPES[key].label,
    url: key === "variable" ? "/variables?create=true" : `/variables?create=true&type=${key}`,
    icon: VARIABLE_TYPES[key].icon, ...typed(VARIABLE_TYPES[key].tone),
  })),

  // Provider colours are a per-feature brand map (alerts/data.tsx).
  ...notificationProviders.map((p): CreateAction => ({
    id: `notification-${p.type}`, group: "notifications", title: p.label,
    url: `/notifications?create=true&type=${p.type}`, icon: p.icon, text: p.color, force: p.color,
  })),
];

export const createActionsFor = (group: CreateGroupId) => CREATE_ACTIONS.filter((a) => a.group === group);
export const createAction = (id: string) => CREATE_ACTIONS.find((a) => a.id === id)!;
