import {
  ArrowLeftRight, Chrome, ChevronsLeftRightEllipsis, Database, EthernetPort, LaptopMinimal, SquareFunction,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import { K6Logo } from "@/components/logo/k6-logo";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { notificationProviders } from "@/components/alerts/data";
import { AREA_TEXT, NAV } from "@/lib/nav-areas";
import { ADMIN_TYPES, TYPE_TEXT, TYPE_TEXT_FORCE, VARIABLE_TYPES, typeTone, type TypeTone } from "@/lib/type-tones";

/**
 * Every "create" destination, in Quick Create order. The sidebar Create menus and the Cmd+K Create
 * section render from this list, so an action has one icon and one colour everywhere (DESIGN.md).
 * `text` is "" for brand marks (Playwright, k6) that keep their own colours.
 */
type Icon = LucideIcon | ComponentType<{ className?: string }>;

export type CreateCapability = "sreServices" | "sreConnectors" | "projects" | "members" | "cliTokens";
export type CreateCapabilities = {
  canCreateProjects: boolean;
  canInviteMembers: boolean;
  canCreateCliTokens: boolean;
  canCreateSreServices: boolean;
  canConfigureSreConnectors: boolean;
};
export const CAPABILITY_FLAG: Record<CreateCapability, keyof CreateCapabilities> = {
  sreServices: "canCreateSreServices",
  sreConnectors: "canConfigureSreConnectors",
  projects: "canCreateProjects",
  members: "canInviteMembers",
  cliTokens: "canCreateCliTokens",
};

export type CreateGroupId =
  | "tests" | "jobs" | "sre" | "admin" | "monitors" | "statusPages" | "variables" | "notifications";

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
  test("browser", "Browser Test", Chrome),
  test("api", "API Test", ArrowLeftRight),
  test("database", "Database Test", Database),
  test("custom", "Custom Test", SquareFunction),
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

  monitor("http_request", "HTTP Monitor", ArrowLeftRight),
  monitor("website", "Website Monitor", LaptopMinimal),
  monitor("ping_host", "Ping Monitor", ChevronsLeftRightEllipsis),
  monitor("port_check", "Port Monitor", EthernetPort),
  monitor("synthetic_test", "Synthetic Monitor", PlaywrightLogo, true),

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
