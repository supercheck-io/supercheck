/* ================================
   LOCATIONS SCHEMA
   -------------------------------
   Instance-wide execution locations and per-project restrictions.
   Locations represent physical infrastructure where worker processes run.
=================================== */

import {
  pgTable,
  text,
  varchar,
  timestamp,
  uuid,
  boolean,
  integer,
  jsonb,
  unique,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { projects } from "./organization";

/**
 * Instance-wide execution locations.
 * Managed by Super Admin. No organization_id — locations are shared across the entire instance.
 * Each location corresponds to a WORKER_LOCATION value and determines queue routing.
 */
export const locations = pgTable(
  "locations",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`gen_random_uuid()`),
    code: varchar("code", { length: 63 }).notNull().unique(),
    name: varchar("name", { length: 100 }).notNull(),
    region: varchar("region", { length: 100 }),
    flag: varchar("flag", { length: 10 }),
    coordinates: jsonb("coordinates").$type<{
      lat: number;
      lon: number;
    }>(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_locations_enabled").on(table.isEnabled),
    index("idx_locations_sort_order").on(table.sortOrder),
    uniqueIndex("locations_single_default_idx")
      .on(table.isDefault)
      .where(sql`is_default = true`),
  ]
);

/**
 * Per-project location restrictions.
 * If a project has zero rows, it inherits ALL enabled instance locations.
 * If it has one or more rows, only those locations are available.
 */
export const projectLocations = pgTable(
  "project_locations",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("project_locations_unique").on(table.projectId, table.locationId),
    index("idx_project_locations_project").on(table.projectId),
    index("idx_project_locations_location").on(table.locationId),
  ]
);

// Zod schemas for validation
export const insertLocationSchema = createInsertSchema(locations);
export const selectLocationSchema = createSelectSchema(locations);
export const insertProjectLocationSchema = createInsertSchema(projectLocations);
