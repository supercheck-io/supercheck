/* ================================
   REQUIREMENTS SCHEMA
   -------------------------------
   Tables for requirement management and traceability
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
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { organization, projects } from "./organization";
import { user } from "./auth";
import { tests } from "./test";
import type {
  RequirementPriority,
  RequirementCreatedBy,
  RequirementCoverageStatus,
  RequirementDocumentType,
} from "./types";

/**
 * Requirements table - Stores testable requirements extracted from documents
 * or manually created by users. Uses many-to-many linking with tests.
 */
export const requirements = pgTable(
  "requirements",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "cascade",
      }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    priority: varchar("priority", { length: 10 })
      .$type<RequirementPriority>()
      .default("medium"),
    // Store tags as comma-separated string for simplicity (can query with LIKE)
    tags: text("tags"),
    // Source document reference
    sourceDocumentId: uuid("source_document_id").references(
      () => requirementDocuments.id,
      { onDelete: "set null" }
    ),
    sourceSection: varchar("source_section", { length: 255 }),
    // External integration links (Jira, GitHub, etc.)
    externalId: varchar("external_id", { length: 255 }),
    externalUrl: text("external_url"),
    externalProvider: varchar("external_provider", { length: 50 }), // 'jira', 'github', 'gitlab', 'linear'
    externalSyncedAt: timestamp("external_synced_at", { withTimezone: true }),
    // Creator tracking
    createdBy: varchar("created_by", { length: 10 })
      .$type<RequirementCreatedBy>()
      .notNull()
      .default("user"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => ({
    // Index on organization_id for org-level queries
    organizationIdIdx: index("requirements_organization_id_idx").on(
      table.organizationId
    ),
    // Composite index for project + priority filtering
    projectPriorityIdx: index("requirements_project_priority_idx").on(
      table.projectId,
      table.priority
    ),
    // Index on external_id for integration lookups
    externalIdIdx: index("requirements_external_id_idx").on(table.externalId),
    // Index on created_at for sorting/pagination
    createdAtIdx: index("requirements_created_at_idx").on(table.createdAt),
    requirementsCreatedByUserIdIdx: index("requirements_created_by_user_id_idx").on(table.createdByUserId),
    requirementsSourceDocumentIdIdx: index("requirements_source_document_id_idx").on(table.sourceDocumentId),
  })
);

/**
 * Requirement Documents - Source documents uploaded for AI extraction
 */
export const requirementDocuments = pgTable(
  "requirement_documents",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "cascade",
      }),
    name: varchar("name", { length: 255 }).notNull(),
    type: varchar("type", { length: 20 })
      .$type<RequirementDocumentType>()
      .notNull(),
    storagePath: varchar("storage_path", { length: 500 }).notNull(),
    fileSize: integer("file_size"), // bytes
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uploadedAtIdx: index("requirement_documents_uploaded_at_idx").on(
      table.uploadedAt
    ),
    projectUploadedAtIdx: index("requirement_documents_project_uploaded_at_idx").on(
      table.projectId,
      table.uploadedAt
    ),
    requirementDocumentsOrganizationIdIdx: index("requirement_documents_organization_id_idx").on(table.organizationId),
    requirementDocumentsUploadedByUserIdIdx: index("requirement_documents_uploaded_by_user_id_idx").on(table.uploadedByUserId),
  })
);

/**
 * Test Requirements - Many-to-many join table linking tests to requirements
 */
export const testRequirements = pgTable(
  "test_requirements",
  {
    testId: uuid("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    // Composite primary key via unique index
    pk: uniqueIndex("test_requirements_pk").on(
      table.testId,
      table.requirementId
    ),
    // Index for finding tests by requirement
    requirementIdIdx: index("test_requirements_requirement_id_idx").on(
      table.requirementId
    ),
  })
);

/**
 * Requirement Coverage Snapshots - Cached coverage status computed from executions
 * Updated by coverage worker after job completion
 */
export const requirementCoverageSnapshots = pgTable(
  "requirement_coverage_snapshots",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    requirementId: uuid("requirement_id")
      .notNull()
      .unique()
      .references(() => requirements.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 })
      .$type<RequirementCoverageStatus>()
      .notNull()
      .default("missing"),
    linkedTestCount: integer("linked_test_count").notNull().default(0),
    passedTestCount: integer("passed_test_count").notNull().default(0),
    failedTestCount: integer("failed_test_count").notNull().default(0),
    lastFailedTestId: uuid("last_failed_test_id").references(() => tests.id, {
      onDelete: "set null",
    }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => ({
    // Index for filtering by status
    statusIdx: index("requirement_coverage_snapshots_status_idx").on(
      table.status
    ),
    requirementCoverageSnapshotsLastFailedTestIdIdx: index("requirement_coverage_snapshots_last_failed_test_id_idx").on(table.lastFailedTestId),
  })
);

// Zod schemas for requirements
export const requirementsInsertSchema = createInsertSchema(requirements);
export const requirementsUpdateSchema = createUpdateSchema(requirements);
export const requirementsSelectSchema = createSelectSchema(requirements);

// Zod schemas for requirement documents
export const requirementDocumentsInsertSchema =
  createInsertSchema(requirementDocuments);
export const requirementDocumentsSelectSchema =
  createSelectSchema(requirementDocuments);

// Zod schemas for test requirements join
export const testRequirementsInsertSchema =
  createInsertSchema(testRequirements);
export const testRequirementsSelectSchema =
  createSelectSchema(testRequirements);

// Zod schemas for coverage snapshots
export const requirementCoverageSnapshotsInsertSchema = createInsertSchema(
  requirementCoverageSnapshots
);
export const requirementCoverageSnapshotsUpdateSchema = createUpdateSchema(
  requirementCoverageSnapshots
);
export const requirementCoverageSnapshotsSelectSchema = createSelectSchema(
  requirementCoverageSnapshots
);
