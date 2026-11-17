import { USER_PERSONAS, type UserPersona } from "@/db/schema/project-setup";

export { USER_PERSONAS, type UserPersona };

export const PERSONA_OPTIONS: ReadonlyArray<{
  id: UserPersona;
  title: string;
  description: string;
}> = [
  {
    id: "sre",
    title: "Keep production up",
    description: "Monitors, alerts, incidents and AI SRE first.",
  },
  {
    id: "qa",
    title: "Test my app",
    description: "Requirements, tests and scheduled runs first.",
  },
  {
    id: "developer",
    title: "Build with code and agents",
    description: "CLI, monitors-as-code and the coding-agent recipe first.",
  },
  {
    id: "leader",
    title: "Lead a team",
    description: "Invite your team, then set up the basics.",
  },
];

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
