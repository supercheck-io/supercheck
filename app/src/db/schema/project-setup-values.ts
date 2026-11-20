// Plain values with no imports, so client code (the sidebar) can use them without bundling Drizzle tables and zod.
export const PROJECT_SETUP_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "dismissed",
] as const;
export type ProjectSetupStatus = (typeof PROJECT_SETUP_STATUSES)[number];

export const USER_PERSONAS = ["sre", "qa", "developer", "leader"] as const;
export type UserPersona = (typeof USER_PERSONAS)[number];
