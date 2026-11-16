/* ================================
   PROJECT SETUP SCHEMA
   -------------------------------
   Per-project setup (onboarding) state and per-user preferences
=================================== */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
  check,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization, projects } from "./organization";
import { user } from "./auth";

export const PROJECT_SETUP_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "dismissed",
] as const;
export type ProjectSetupStatus = (typeof PROJECT_SETUP_STATUSES)[number];

export const USER_PERSONAS = ["sre", "qa", "developer", "leader"] as const;
export type UserPersona = (typeof USER_PERSONAS)[number];

/**
 * One row per project, created on first write. The draft holds non-secret
 * choices only (validated by lib/setup/draft-schema.ts); checklist ticks are
 * derived from real rows, never stored here.
 */
export const projectSetupState = pgTable(
  "project_setup_state",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").$type<ProjectSetupStatus>().notNull().default("not_started"),
    currentStep: text("current_step"),
    draft: jsonb("draft").$type<Record<string, unknown>>().notNull().default({}),
    skipped: text("skipped").array().notNull().default(sql`'{}'::text[]`),
    statusPageOptOut: boolean("status_page_opt_out").notNull().default(false),
    lockedByUserId: uuid("locked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastAiRunAt: timestamp("last_ai_run_at", { withTimezone: true }),
    scanResult: jsonb("scan_result").$type<Record<string, unknown>>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectUnique: uniqueIndex("project_setup_state_project_id_idx").on(table.projectId),
    organizationIdx: index("project_setup_state_organization_id_idx").on(table.organizationId),
    lockedByIdx: index("project_setup_state_locked_by_user_id_idx").on(table.lockedByUserId),
    statusCheck: check(
      "project_setup_state_status_check",
      sql`status IN ('not_started', 'in_progress', 'completed', 'dismissed')`,
    ),
  }),
);

/** Per-person preferences that follow the user across organizations. */
export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    persona: text("persona").$type<UserPersona>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    personaCheck: check(
      "user_preferences_persona_check",
      sql`persona IS NULL OR persona IN ('sre', 'qa', 'developer', 'leader')`,
    ),
  }),
);
