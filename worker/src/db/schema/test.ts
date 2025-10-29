/* ================================
   TEST SCHEMA
   -------------------------------
   Tables for test definitions and management
=================================== */

import { pgTable, text, varchar, timestamp, uuid } from 'drizzle-orm/pg-core';
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
export const tests = pgTable('tests', {
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
});

// Zod schemas for tests
export const testsInsertSchema = createInsertSchema(tests);
export const testsUpdateSchema = createUpdateSchema(tests);
export const testsSelectSchema = createSelectSchema(tests);
