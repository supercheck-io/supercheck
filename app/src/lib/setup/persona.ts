import { USER_PERSONAS, type UserPersona } from "@/db/schema/project-setup-values";

export { USER_PERSONAS, type UserPersona };

/** Titles match the "By role" solutions on the website (site-nav.ts), in the same order; the line says what the choice changes. */
export const PERSONA_OPTIONS: ReadonlyArray<{
  id: UserPersona;
  title: string;
  description: string;
}> = [
  {
    id: "developer",
    title: "Developers",
    description: "Ship tests and monitors with your code. Starts with the CLI and the coding-agent recipe.",
  },
  {
    id: "sre",
    title: "SRE and platform",
    description: "Catch outages, find the cause, update users. Starts with monitors, alerts and incidents.",
  },
  {
    id: "qa",
    title: "QA engineers",
    description: "Playwright and k6 suites that run on a schedule. Starts with requirements and tests.",
  },
  {
    id: "leader",
    title: "Engineering leaders",
    description: "Coverage, access and audit trail in one view. Starts by inviting your team.",
  },
]

export function isUserPersona(value: unknown): value is UserPersona {
  return typeof value === "string" && (USER_PERSONAS as readonly string[]).includes(value);
}

export const SETUP_STEP_KEYS = [
  "developer",
  "invite",
  "app",
  "alerts",
  "monitors",
  "statusPage",
  "tests",
  "aiSre",
  "review",
] as const;
export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

export function isSetupStepKey(value: unknown): value is SetupStepKey {
  return typeof value === "string" && (SETUP_STEP_KEYS as readonly string[]).includes(value);
}

const DEFAULT_STEPS: SetupStepKey[] = ["app", "alerts", "monitors", "statusPage", "tests", "aiSre"];

const PERSONA_STEPS: Record<UserPersona, SetupStepKey[]> = {
  sre: ["app", "alerts", "monitors", "aiSre", "statusPage", "tests"],
  qa: ["app", "tests", "alerts", "monitors", "statusPage", "aiSre"],
  developer: ["developer", "app", "monitors", "alerts", "tests", "statusPage", "aiSre"],
  leader: ["invite", "app", "alerts", "monitors", "statusPage", "tests", "aiSre"],
};

/**
 * Step order for a persona (spec 4.2). Review is always last. `available` drops steps
 * whose flag is off; the persona only orders steps, it never hides one.
 */
export function stepOrder(
  persona: UserPersona | null | undefined,
  available: (step: SetupStepKey) => boolean = () => true,
): SetupStepKey[] {
  const steps = persona ? PERSONA_STEPS[persona] : DEFAULT_STEPS;
  return [...steps.filter(available), "review"];
}

export const SIDEBAR_GROUPS = ["Respond", "Communicate", "Automate", "Monitor"] as const;
export type SidebarGroup = (typeof SIDEBAR_GROUPS)[number];

export interface SidebarLayout {
  order: SidebarGroup[];
  /** Group that starts expanded; null means every group is expanded (today's sidebar). */
  expanded: SidebarGroup | null;
}

const PERSONA_SIDEBAR: Record<UserPersona, SidebarLayout> = {
  sre: { order: ["Respond", "Monitor", "Communicate", "Automate"], expanded: "Respond" },
  qa: { order: ["Automate", "Communicate", "Respond", "Monitor"], expanded: "Automate" },
  developer: { order: ["Automate", "Monitor", "Respond", "Communicate"], expanded: "Automate" },
  leader: { order: [...SIDEBAR_GROUPS], expanded: null },
};

/** Sidebar group order and expansion. No persona = today's order, all expanded. */
export function sidebarLayout(persona: UserPersona | null | undefined): SidebarLayout {
  return persona ? PERSONA_SIDEBAR[persona] : { order: [...SIDEBAR_GROUPS], expanded: null };
}

/** Short step names for the persona previews (the wizard shows its own longer titles). */
export const SETUP_STEP_SHORT_LABEL: Record<SetupStepKey, string> = {
  developer: "Terminal",
  invite: "Invite team",
  app: "Your app",
  alerts: "Alerts",
  monitors: "Monitors",
  statusPage: "Status page",
  tests: "Requirements",
  aiSre: "AI SRE",
  review: "Review",
};
