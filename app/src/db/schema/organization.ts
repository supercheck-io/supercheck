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
  numeric,
  unique,
  index,
  jsonb,
  uniqueIndex,
  check,
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata"),
  
  // Polar subscription fields
  polarCustomerId: text("polar_customer_id"), // External customer ID in Polar
  subscriptionPlan: text("subscription_plan")
    .$type<"plus" | "pro" | "unlimited">(), // Nullable: cloud users start without plan until subscription
  subscriptionStatus: text("subscription_status")
    .$type<"active" | "canceled" | "past_due" | "none">()
    .default("none"),
  subscriptionId: text("subscription_id"), // Polar subscription ID
  // Durable ordering state is not subject to webhook-delivery log cleanup.
  polarWebhookTimestamp: timestamp("polar_webhook_timestamp", { withTimezone: true }),
  polarWebhookEventKey: text("polar_webhook_event_key"),
  polarRetiredSubscriptionIds: jsonb("polar_retired_subscription_ids").$type<string[]>().notNull().default([]),
  
  // Subscription period dates (from Polar webhook)
  // These track the actual subscription billing cycle dates
  subscriptionStartedAt: timestamp("subscription_started_at", { withTimezone: true }), // When current subscription period started
  subscriptionEndsAt: timestamp("subscription_ends_at", { withTimezone: true }), // When current subscription period ends
  
  // Usage tracking fields
  playwrightMinutesUsed: numeric("playwright_minutes_used", { precision: 14, scale: 4, mode: "number" }).default(0),
  k6VuMinutesUsed: integer("k6_vu_minutes_used").default(0), // Changed from hours to minutes for consistency with Playwright
  aiCreditsUsed: integer("ai_credits_used").default(0), // AI credits used for AI fix and AI create features
  sreInvestigationUnitsUsed: numeric("sre_investigation_units_used", {
    precision: 10,
    scale: 4,
  })
    .notNull()
    .default("0"),
  usagePeriodStart: timestamp("usage_period_start", { withTimezone: true }),
  usagePeriodEnd: timestamp("usage_period_end", { withTimezone: true }),
},
  (table) => [
    uniqueIndex("organization_polar_customer_id_idx").on(table.polarCustomerId).where(sql`polar_customer_id IS NOT NULL`),
    uniqueIndex("organization_subscription_id_idx").on(table.subscriptionId).where(sql`subscription_id IS NOT NULL`),
    check("organization_playwright_minutes_used_required_check", sql`playwright_minutes_used IS NOT NULL`),
    check("organization_k6_vu_minutes_used_required_check", sql`k6_vu_minutes_used IS NOT NULL`),
    check("organization_ai_credits_used_required_check", sql`ai_credits_used IS NOT NULL`),
    check("organization_subscription_plan_check", sql`${table.subscriptionPlan} IS NULL OR ${table.subscriptionPlan} IN ('plus', 'pro', 'unlimited')`),
    check("organization_subscription_status_check", sql`${table.subscriptionStatus} IS NULL OR ${table.subscriptionStatus} IN ('active', 'canceled', 'past_due', 'none')`),
  ]);
// Cloud/self-hosted entitlement enforcement lives in SubscriptionService.
// A database row cannot infer hosting mode from the presence of a Polar ID.

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    uniqueUserOrg: unique().on(table.userId, table.organizationId),
    // Index for efficient "list members by org" queries
    organizationIdIdx: index("member_organization_id_idx").on(table.organizationId),
    roleCanonicalCheck: check(
      "member_role_canonical_check",
      sql`${table.role} IN ('org_owner', 'org_admin', 'project_admin', 'project_editor', 'project_viewer')`
    ),
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
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Required by Better Auth 1.7's invitation model.
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    selectedProjects: jsonb("selected_projects"), // JSON array of project IDs
  },
  (table) => ({
    // Index on organization_id for listing invitations
    organizationIdIdx: index("invitation_organization_id_idx").on(
      table.organizationId
    ),
    // Composite index on email and status for pending invitation lookups
    emailStatusIdx: index("invitation_email_status_idx").on(
      table.email,
      table.status
    ),
    // Index on expires_at for cleanup queries
    expiresAtIdx: index("invitation_expires_at_idx").on(table.expiresAt),
    invitationInviterIdIdx: index("invitation_inviter_id_idx").on(table.inviterId),
    // One live invitation per organization and address (the invite route expires stale ones first)
    invitationPendingOrgEmailUniqueIdx: uniqueIndex("invitation_pending_org_email_unique_idx")
      .on(table.organizationId, sql`lower(${table.email})`)
      .where(sql`status = 'pending'`),
    invitationStatusCheck: check("invitation_status_check", sql`${table.status} IN ('pending', 'accepted', 'rejected', 'canceled', 'cancelled', 'expired')`),
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
      // NO ACTION on purpose: org delete routes refuse while projects exist so project S3 objects are cleaned first.
      .references(() => organization.id),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).unique(),
    description: text("description"),
    isDefault: boolean("is_default").default(false).notNull(),
    status: varchar("status", { length: 50 })
      .$type<"active" | "archived" | "deleted">()
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    // Composite index on organization_id and status for filtered queries
    orgStatusIdx: index("projects_org_status_idx").on(
      table.organizationId,
      table.status
    ),
    // Index on is_default for finding default projects
    isDefaultIdx: index("projects_is_default_idx").on(table.isDefault),
    // Ensure only one default project per organization
    uniqueDefaultPerOrg: uniqueIndex("projects_unique_default_per_org_idx")
      .on(table.organizationId)
      .where(sql`is_default = true`),
    projectsStatusCheck: check("projects_status_check", sql`${table.status} IN ('active', 'archived', 'deleted')`),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueUserProject: unique().on(table.userId, table.projectId),
    // Index for efficient "list members by project" queries
    projectIdIdx: index("project_members_project_id_idx").on(table.projectId),
    roleCanonicalCheck: check(
      "project_members_role_canonical_check",
      sql`${table.role} IN ('project_admin', 'project_editor', 'project_viewer')`
    ),
  })
);

/**
 * Stores variables, secrets, and file-type variables for projects.
 * Type field follows the GitLab CI/CD pattern: Variable | Secret | File.
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
    value: text("value").notNull(), // Encrypted for secrets, empty string for files
    encryptedValue: text("encrypted_value"), // Base64 encrypted value for secrets
    isSecret: boolean("is_secret").default(false).notNull(),
    type: varchar("type", { length: 20 })
      .$type<"variable" | "secret" | "file">()
      .default("variable")
      .notNull(),
    // File-type variable fields
    fileName: varchar("file_name", { length: 255 }), // Original upload filename
    fileSize: integer("file_size"), // File size in bytes
    mimeType: varchar("mime_type", { length: 255 }), // MIME type of uploaded file
    storagePath: text("storage_path"), // S3 storage path for file content
    description: text("description"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueKeyPerProject: unique().on(table.projectId, table.key),
    projectVariablesCreatedByUserIdIdx: index("project_variables_created_by_user_id_idx").on(table.createdByUserId),
    projectVariablesTypeCheck: check("project_variables_type_check", sql`${table.type} IN ('variable', 'secret', 'file')`),
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
