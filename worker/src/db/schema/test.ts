/* ================================
   TEST SCHEMA
   -------------------------------
   Tables for test definitions and management
=================================== */

import {
  pgTable,
  text,
  varchar,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from 'drizzle-zod';
import { organization } from './organization';
import { projects } from './organization';
import { user } from './auth';
import type { TestPriority, TestType } from './types';

/**
 * Stores test definitions and scripts.
 */
export const tests = pgTable(
  'tests',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    createdByUserId: uuid('created_by_user_id').references(() => user.id, {
      onDelete: 'no action',
    }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    script: text('script').notNull().default(''), // Store Base64-encoded script content
    priority: varchar('priority', { length: 50 })
      .$type<TestPriority>()
      .notNull()
      .default('medium'),
    type: varchar('type', { length: 50 })
      .$type<TestType>()
      .notNull()
      .default('browser'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at'),
  },
  (table) => ({
    // Index on organization_id for listing organization tests
    organizationIdIdx: index('tests_organization_id_idx').on(
      table.organizationId,
    ),
    // Index on project_id for listing project tests
    projectIdIdx: index('tests_project_id_idx').on(table.projectId),
    // Composite index on project_id and type for filtered queries
    projectTypeIdx: index('tests_project_type_idx').on(
      table.projectId,
      table.type,
    ),
    // Index on type for type-based queries
    typeIdx: index('tests_type_idx').on(table.type),
    // Index on created_at for sorting/pagination
    createdAtIdx: index('tests_created_at_idx').on(table.createdAt),
  }),
);

// Zod schemas for tests
export const testsInsertSchema = createInsertSchema(tests);
export const testsUpdateSchema = createUpdateSchema(tests);
export const testsSelectSchema = createSelectSchema(tests);
