/* ================================
   MAINTENANCE WINDOWS
   -------------------------------
   Scheduled windows that mute alerts, incidents and paging for covered monitors and leave them out
   of uptime. Checks keep running. The app keeps occurrence_* on the current or next occurrence; the
   worker only compares those timestamps.
=================================== */

import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, smallint, time, timestamp, uniqueIndex, uuid, varchar, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { organization, projects } from "./organization";

export type MaintenanceWindowScope = "project" | "services" | "monitors";
export type MaintenanceWindowRecurrence = "once" | "daily" | "weekly" | "monthly";

export const maintenanceWindows = pgTable(
  "maintenance_windows",
  {
    id: uuid("id").primaryKey().$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    scope: varchar("scope", { length: 10 }).$type<MaintenanceWindowScope>().notNull(),
    recurrence: varchar("recurrence", { length: 10 }).$type<MaintenanceWindowRecurrence>().notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    localStartTime: time("local_start_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    weekdays: smallint("weekdays").array(),
    monthDay: smallint("month_day"),
    occurrenceStartsAt: timestamp("occurrence_starts_at", { withTimezone: true }),
    occurrenceEndsAt: timestamp("occurrence_ends_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // The predicate's cheap EXISTS: live windows of a project by occurrence start.
    projectOccurrenceIdx: index("maintenance_windows_project_occurrence_idx")
      .on(table.projectId, table.occurrenceStartsAt)
      .where(sql`${table.cancelledAt} IS NULL AND ${table.completedAt} IS NULL`),
    organizationIdx: index("maintenance_windows_organization_id_idx").on(table.organizationId),
    createdByIdx: index("maintenance_windows_created_by_user_id_idx").on(table.createdByUserId),
    scopeCheck: check("maintenance_windows_scope_check", sql`${table.scope} IN ('project', 'services', 'monitors')`),
    recurrenceCheck: check("maintenance_windows_recurrence_check", sql`${table.recurrence} IN ('once', 'daily', 'weekly', 'monthly')`),
    durationCheck: check("maintenance_windows_duration_check", sql`${table.durationMinutes} BETWEEN 5 AND 10080`),
    monthDayCheck: check("maintenance_windows_month_day_check", sql`${table.monthDay} IS NULL OR ${table.monthDay} BETWEEN 1 AND 28 OR ${table.monthDay} = -1`),
  }),
);

export const maintenanceWindowTargets = pgTable(
  "maintenance_window_targets",
  {
    id: uuid("id").primaryKey().$defaultFn(() => sql`uuidv7()`),
    windowId: uuid("window_id").notNull().references(() => maintenanceWindows.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 10 }).$type<"service" | "monitor">().notNull(),
    targetId: uuid("target_id").notNull(),
  },
  (table) => ({
    windowTargetUniqueIdx: uniqueIndex("maintenance_window_targets_window_target_unique_idx").on(table.windowId, table.targetType, table.targetId),
    targetIdx: index("maintenance_window_targets_target_idx").on(table.targetType, table.targetId),
    targetTypeCheck: check("maintenance_window_targets_target_type_check", sql`${table.targetType} IN ('service', 'monitor')`),
  }),
);
