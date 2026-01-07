/* ================================
   REQUIREMENTS SCHEMA
   -------------------------------
   Tables for requirement management and coverage tracking
=================================== */

import {
  pgTable,
  text,
  varchar,
  timestamp,
  uuid,
  index,
  integer,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organization, projects } from './organization';
import { user } from './auth';
import { tests } from './test';
import type {
  RequirementPriority,
  RequirementCreatedBy,
  RequirementCoverageStatus,
  RequirementDocumentType,
} from './types';

/**
 * Requirements table - Stores testable requirements
 */
export const requirements = pgTable(
  'requirements',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, {
        onDelete: 'cascade',
      }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, {
        onDelete: 'cascade',
      }),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    priority: varchar('priority', { length: 10 })
      .$type<RequirementPriority>()
      .default('medium'),
    tags: text('tags'),
    sourceDocumentId: uuid('source_document_id'),
    sourceSection: varchar('source_section', { length: 255 }),
    externalId: varchar('external_id', { length: 255 }),
    externalUrl: text('external_url'),
    externalProvider: varchar('external_provider', { length: 50 }),
    externalSyncedAt: timestamp('external_synced_at'),
    createdBy: varchar('created_by', { length: 10 })
      .$type<RequirementCreatedBy>()
      .notNull()
      .default('user'),
    createdByUserId: uuid('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at'),
  },
  (table) => ({
    organizationIdIdx: index('requirements_organization_id_idx').on(
      table.organizationId,
    ),
    projectIdIdx: index('requirements_project_id_idx').on(table.projectId),
  }),
);

/**
 * Requirement Documents - Source documents uploaded for AI extraction
 */
export const requirementDocuments = pgTable(
  'requirement_documents',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, {
        onDelete: 'cascade',
      }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, {
        onDelete: 'cascade',
      }),
    name: varchar('name', { length: 255 }).notNull(),
    type: varchar('type', { length: 20 }).$type<RequirementDocumentType>().notNull(),
    storagePath: varchar('storage_path', { length: 500 }).notNull(),
    fileSize: integer('file_size'),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    uploadedAt: timestamp('uploaded_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    projectIdIdx: index('requirement_documents_project_id_idx').on(table.projectId),
  }),
);

/**
 * Test Requirements - Join table linking tests to requirements
 */
export const testRequirements = pgTable(
  'test_requirements',
  {
    testId: uuid('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    requirementId: uuid('requirement_id')
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    pk: uniqueIndex('test_requirements_pk').on(table.testId, table.requirementId),
    testIdIdx: index('test_requirements_test_id_idx').on(table.testId),
    requirementIdIdx: index('test_requirements_requirement_id_idx').on(
      table.requirementId,
    ),
  }),
);

/**
 * Requirement Coverage Snapshots - Cached coverage status
 */
export const requirementCoverageSnapshots = pgTable(
  'requirement_coverage_snapshots',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    requirementId: uuid('requirement_id')
      .notNull()
      .unique()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 })
      .$type<RequirementCoverageStatus>()
      .notNull()
      .default('missing'),
    linkedTestCount: integer('linked_test_count').notNull().default(0),
    passedTestCount: integer('passed_test_count').notNull().default(0),
    failedTestCount: integer('failed_test_count').notNull().default(0),
    lastFailedTestId: uuid('last_failed_test_id').references(() => tests.id, {
      onDelete: 'set null',
    }),
    lastFailedAt: timestamp('last_failed_at'),
    lastEvaluatedAt: timestamp('last_evaluated_at').defaultNow(),
    updatedAt: timestamp('updated_at'),
  },
  (table) => ({
    requirementIdIdx: index('requirement_coverage_snapshots_requirement_id_idx').on(
      table.requirementId,
    ),
    statusIdx: index('requirement_coverage_snapshots_status_idx').on(table.status),
  }),
);
