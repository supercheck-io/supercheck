/* ================================
   ORGANIZATION SCHEMA
   -------------------------------
   Tables for organizations, projects, members, and invitations
=================================== */

import {
  pgTable,
  text,
  varchar,
  timestamp,
  uuid,
  boolean,
  integer,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { user } from "./auth";

/**
 * Represents an organization or a company account.
 */
export const organization = pgTable("organization", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull(),
  metadata: text("metadata"),
  
  // Polar subscription fields
  polarCustomerId: text("polar_customer_id"), // External customer ID in Polar
  subscriptionPlan: text("subscription_plan")
    .$type<"plus" | "pro" | "unlimited">(), // Nullable: cloud users start without plan until subscription
  subscriptionStatus: text("subscription_status")
    .$type<"active" | "canceled" | "past_due" | "none">()
    .default("none"),
  subscriptionId: text("subscription_id"), // Polar subscription ID
  
  // Usage tracking fields
  playwrightMinutesUsed: integer("playwright_minutes_used").default(0),
  k6VuHoursUsed: integer("k6_vu_hours_used").default(0), // Changed from integer to numeric in migration
  usagePeriodStart: timestamp("usage_period_start"),
  usagePeriodEnd: timestamp("usage_period_end"),
}, () => ({
  // SECURITY: Prevent unlimited plans in cloud mode
  // Only allows unlimited plan when there's no Polar customer ID (self-hosted mode)
  unlimitedPlanConstraint: sql`
    CHECK (
      subscription_plan != 'unlimited' OR polar_customer_id IS NULL
    )
  `,
}));

/**
 * Maps users to organizations, defining their roles.
 */
export const member = pgTable(
  "member",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("project_viewer").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => ({
    uniqueUserOrg: unique().on(table.userId, table.organizationId),
  })
);

/**
 * Stores pending invitations for users to join an organization.
 */
export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    selectedProjects: text("selected_projects"), // JSON array of project IDs
  },
  (table) => ({
    // Index on organization_id for listing invitations
    organizationIdIdx: index("invitation_organization_id_idx").on(
      table.organizationId
    ),
    // Index on email for checking pending invitations
    emailIdx: index("invitation_email_idx").on(table.email),
    // Composite index on email and status for pending invitation lookups
    emailStatusIdx: index("invitation_email_status_idx").on(
      table.email,
      table.status
    ),
    // Index on expires_at for cleanup queries
    expiresAtIdx: index("invitation_expires_at_idx").on(table.expiresAt),
  })
);

/**
 * Represents a project within an organization.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).unique(),
    description: text("description"),
    isDefault: boolean("is_default").default(false).notNull(),
    status: varchar("status", { length: 50 })
      .$type<"active" | "archived" | "deleted">()
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    // Index on organization_id for listing organization projects
    organizationIdIdx: index("projects_organization_id_idx").on(
      table.organizationId
    ),
    // Composite index on organization_id and status for filtered queries
    orgStatusIdx: index("projects_org_status_idx").on(
      table.organizationId,
      table.status
    ),
    // Index on is_default for finding default projects
    isDefaultIdx: index("projects_is_default_idx").on(table.isDefault),
  })
);

/**
 * Maps users to projects, defining their roles within a project.
 */
export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 50 }).default("project_viewer").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueUserProject: unique().on(table.userId, table.projectId),
  })
);

/**
 * Stores variables and secrets for projects
 */
export const projectVariables = pgTable(
  "project_variables",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 255 }).notNull(),
    value: text("value").notNull(), // Encrypted for secrets
    encryptedValue: text("encrypted_value"), // Base64 encrypted value for secrets
    isSecret: boolean("is_secret").default(false).notNull(),
    description: text("description"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueKeyPerProject: unique().on(table.projectId, table.key),
  })
);

// Zod schemas for projects
export const projectsInsertSchema = createInsertSchema(projects);
export const projectsSelectSchema = createSelectSchema(projects);
export const projectsUpdateSchema = createUpdateSchema(projects);

export const projectVariablesInsertSchema =
  createInsertSchema(projectVariables);
export const projectVariablesSelectSchema =
  createSelectSchema(projectVariables);
export const projectVariablesUpdateSchema =
  createUpdateSchema(projectVariables);
