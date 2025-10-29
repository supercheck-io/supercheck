/* ================================
   AUTH SCHEMA
   -------------------------------
   Tables required by better-auth, modified to use UUIDs.
   Using UUIDv7 for time-ordered IDs with better indexing performance (PostgreSQL 18+).
=================================== */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Import tables for foreign key references
// Note: These circular imports are safe because Drizzle uses lazy evaluation
import { organization, projects } from "./organization";
import { jobs } from "./job";

/**
 * Stores user information for authentication and identification.
 */
export const user = pgTable("user", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  role: text("role"),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
});

/**
 * Manages user sessions for authentication.
 */
export const session = pgTable("session", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: uuid("active_organization_id").references(
    () => organization.id
  ),
  activeProjectId: uuid("active_project_id").references(() => projects.id),
  impersonatedBy: text("impersonated_by"),
});

/**
 * Stores provider-specific account information for OAuth.
 */
export const account = pgTable("account", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  accountId: text("account_id"),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/**
 * Stores tokens for email verification or password resets.
 */
export const verification = pgTable("verification", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * Manages API keys for programmatic access.
 */
export const apikey = pgTable("apikey", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  name: text("name"),
  start: text("start"),
  prefix: text("prefix"),
  key: text("key").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "no action" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  refillInterval: text("refill_interval"),
  refillAmount: text("refill_amount"),
  lastRefillAt: timestamp("last_refill_at"),
  enabled: boolean("enabled").default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").default(true),
  rateLimitTimeWindow: text("rate_limit_time_window").default("60"),
  rateLimitMax: text("rate_limit_max").default("100"),
  requestCount: text("request_count"),
  remaining: text("remaining"),
  lastRequest: timestamp("last_request"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  permissions: text("permissions"),
  metadata: text("metadata"),
});

/**
 * Auth schema export for better-auth drizzle adapter
 */
export const authSchema = {
  user,
  session,
  account,
  verification,
  apikey,
};
