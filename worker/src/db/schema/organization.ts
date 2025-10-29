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
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from 'drizzle-zod';
import { user } from './auth';

/**
 * Represents an organization or a company account.
 */
export const organization = pgTable('organization', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  logo: text('logo'),
  createdAt: timestamp('created_at').notNull(),
  metadata: text('metadata'),
});

/**
 * Maps users to organizations, defining their roles.
 */
export const member = pgTable(
  'member',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').default('project_viewer').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => ({
    uniqueUserOrg: unique().on(table.userId, table.organizationId),
  }),
);

/**
 * Stores pending invitations for users to join an organization.
 */
export const invitation = pgTable('invitation', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role'),
  status: text('status').default('pending').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  inviterId: uuid('inviter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  selectedProjects: text('selected_projects'), // JSON array of project IDs
});

/**
 * Represents a project within an organization.
 */
export const projects = pgTable('projects', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).unique(),
  description: text('description'),
  isDefault: boolean('is_default').default(false).notNull(),
  status: varchar('status', { length: 50 })
    .$type<'active' | 'archived' | 'deleted'>()
    .notNull()
    .default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * Maps users to projects, defining their roles within a project.
 */
export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).default('project_viewer').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    uniqueUserProject: unique().on(table.userId, table.projectId),
  }),
);

/**
 * Stores variables and secrets for projects
 */
export const projectVariables = pgTable(
  'project_variables',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 255 }).notNull(),
    value: text('value').notNull(), // Encrypted for secrets
    encryptedValue: text('encrypted_value'), // Base64 encrypted value for secrets
    isSecret: boolean('is_secret').default(false).notNull(),
    description: text('description'),
    createdByUserId: uuid('created_by_user_id').references(() => user.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    uniqueKeyPerProject: unique().on(table.projectId, table.key),
  }),
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
