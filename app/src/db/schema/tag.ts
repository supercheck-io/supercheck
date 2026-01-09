/* ================================
   TAG SCHEMA
   -------------------------------
   Tables for tags and tag associations
=================================== */

import {
  pgTable,
  varchar,
  primaryKey,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { organization, projects } from "./organization";
import { user } from "./auth";
import { monitors } from "./monitor";
import { tests } from "./test";
import { requirements } from "./requirement";

/**
 * A table for tags that can be applied to monitors for organization and filtering.
 */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "no action",
    }),
    name: varchar("name", { length: 100 }).notNull(),
    color: varchar("color", { length: 50 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    projectTagNameUnique: uniqueIndex("tags_project_name_idx").on(
      table.projectId,
      table.name
    ),
  })
);

/**
 * A join table linking monitors to tags.
 */
export const monitorTags = pgTable(
  "monitor_tags",
  {
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at").defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.monitorId, table.tagId] }),
  })
);

/**
 * A join table linking tests to tags.
 */
export const testTags = pgTable(
  "test_tags",
  {
    testId: uuid("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at").defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.testId, table.tagId] }),
  })
);

/**
 * A join table linking requirements to tags.
 */
export const requirementTags = pgTable(
  "requirement_tags",
  {
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at").defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.requirementId, table.tagId] }),
  })
);

// Zod schemas for tags
export const tagsInsertSchema = createInsertSchema(tags);
export const tagsSelectSchema = createSelectSchema(tags);

// Zod schemas for tag associations
export const testTagsInsertSchema = createInsertSchema(testTags);
export const testTagsSelectSchema = createSelectSchema(testTags);

// Zod schemas for requirement tag associations
export const requirementTagsInsertSchema = createInsertSchema(requirementTags);
export const requirementTagsSelectSchema = createSelectSchema(requirementTags);
