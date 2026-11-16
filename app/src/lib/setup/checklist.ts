import type { SetupFeature, SetupFeatures } from "./features";

/** Row counts for the setup project; every tick is derived from these, never stored. */
export interface SetupCounts {
  monitors: number;
  heartbeatMonitors: number;
  notificationProviders: number;
  statusPages: number;
  requirements: number;
  tests: number;
  jobs: number;
  connectorsOrAgents: number;
  services: number;
  /** Org members (incl. the caller) plus pending invitations. */
  membersAndInvites: number;
  cliTokens: number;
  pushDevices: number;
}

export type ChecklistGroup = "watch" | "prove" | "fix" | "team";

export interface ChecklistItem {
  key: string;
  group: ChecklistGroup;
  title: string;
  done: boolean;
  /** Where "Set up" / "View" goes. */
  href: string;
}

export interface NextStep {
  key: string;
  title: string;
  href: string;
}

export interface Checklist {
  items: ChecklistItem[];
  done: number;
  total: number;
  nextSteps: NextStep[];
}

export const CHECKLIST_GROUP_TITLES: Record<ChecklistGroup, string> = {
  watch: "Watch it",
  prove: "Prove it",
  fix: "Fix it fast",
  team: "Team and code",
};

interface ItemDef {
  key: string;
  group: ChecklistGroup;
  title: string;
  flag: SetupFeature;
  href: string;
  done: (c: SetupCounts, statusPageOptOut: boolean) => boolean;
}

const ITEMS: ItemDef[] = [
  { key: "monitors", group: "watch", title: "Uptime and SSL monitors", flag: "setup", href: "/monitors", done: (c) => c.monitors > 0 },
  { key: "alerts", group: "watch", title: "Alert channel", flag: "setup", href: "/notifications", done: (c) => c.notificationProviders > 0 },
  { key: "heartbeat", group: "watch", title: "Heartbeat for a job", flag: "heartbeat", href: "/monitors/create?type=heartbeat", done: (c) => c.heartbeatMonitors > 0 },
  { key: "statusPage", group: "watch", title: "Status page", flag: "setup", href: "/status-pages", done: (c, optOut) => optOut || c.statusPages > 0 },
  { key: "requirements", group: "prove", title: "Requirements", flag: "aiTests", href: "/requirements", done: (c) => c.requirements > 0 },
  { key: "tests", group: "prove", title: "Tests", flag: "setup", href: "/tests", done: (c) => c.tests > 0 },
  { key: "jobs", group: "prove", title: "Scheduled job or CI trigger", flag: "setup", href: "/jobs", done: (c) => c.jobs > 0 },
  { key: "connectors", group: "fix", title: "Connect your stack", flag: "aiSre", href: "/org-admin?tab=integrations", done: (c) => c.connectorsOrAgents > 0 },
  { key: "services", group: "fix", title: "Services", flag: "aiSre", href: "/services", done: (c) => c.services > 0 },
  { key: "team", group: "team", title: "Invite your team", flag: "setup", href: "/org-admin?tab=members", done: (c) => c.membersAndInvites > 1 },
  { key: "cliToken", group: "team", title: "CLI token", flag: "setup", href: "/org-admin?tab=cli-tokens", done: (c) => c.cliTokens > 0 },
  { key: "mobile", group: "team", title: "Get the mobile app", flag: "mobile", href: "/setup", done: (c) => c.pushDevices > 0 },
];

const NEXT_STEPS: Array<NextStep & { flag: SetupFeature }> = [
  { key: "incident", title: "Practice: open a manual incident", href: "/incidents?new=1", flag: "setup" },
  { key: "maintenance", title: "Schedule maintenance", href: "/monitors?tab=maintenance&new=1", flag: "maintenance" },
  { key: "codingRecipe", title: "Use the coding-agent recipe", href: "https://supercheck.io/docs/cli/after-ship-check", flag: "codingRecipe" },
];

/** Spec 4.3: items whose flag is off are neither shown nor counted. */
export function deriveChecklist(
  counts: SetupCounts,
  features: SetupFeatures,
  statusPageOptOut: boolean,
): Checklist {
  const items = ITEMS.filter((item) => features[item.flag]).map(({ key, group, title, href, done }) => ({
    key,
    group,
    title,
    href,
    done: done(counts, statusPageOptOut),
  }));
  return {
    items,
    done: items.filter((item) => item.done).length,
    total: items.length,
    nextSteps: NEXT_STEPS.filter((step) => features[step.flag]).map(({ key, title, href }) => ({ key, title, href })),
  };
}
