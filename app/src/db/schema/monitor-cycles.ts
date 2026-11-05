/* Durable monitor check cycles for missing-region closure (issue #452). */

import {
  pgTable,
  text,
  integer,
  timestamp,
  uuid,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { monitors } from "./monitor";

/** Decision and alert state committed with the closure (also drives notification repair). */
export type MonitorCycleEvaluation = {
  previousStatus: string;
  currentStatus: 'up' | 'down';
  alertState?: {
    consecutiveFailureCount: number;
    consecutiveSuccessCount: number;
    alertsSentForFailure: number;
    alertsSentForRecovery: number;
    recoverySequence?: boolean;
    priorFailureCount?: number;
    executionGroupId?: string;
  };
  reason: string;
  avgResponseTimeMs: number;
};

export type MonitorCycleStatus = "open" | "closed" | "aborted";

/** The cycle id doubles as monitor_results.execution_group_id. */
export const monitorCycles = pgTable(
  "monitor_cycles",
  {
    id: text("id").primaryKey(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    mode: text("mode").$type<"control_plane">().notNull().default("control_plane"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    expectedLocations: jsonb("expected_locations").$type<string[]>().notNull(),
    strategy: text("strategy").$type<"all" | "any" | "majority">().notNull(),
    threshold: integer("threshold").notNull(),
    status: text("status").$type<MonitorCycleStatus>().notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by").$type<"arrival" | "deadline">(),
    resultStatus: text("result_status").$type<"up" | "down">(),
    observedLocations: jsonb("observed_locations").$type<string[]>(),
    missingLocations: jsonb("missing_locations").$type<string[]>(),
    evaluation: jsonb("evaluation").$type<MonitorCycleEvaluation>(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    notifyAttempts: integer("notify_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    monitorIdx: index("monitor_cycles_monitor_idx").on(table.monitorId, table.scheduledFor.desc().nullsFirst()),
    statusCheck: check("monitor_cycles_status_check", sql`${table.status} IN ('open', 'closed', 'aborted')`),
    modeCheck: check("monitor_cycles_mode_check", sql`${table.mode} IN ('control_plane')`),
    closedByCheck: check(
      "monitor_cycles_closed_by_check",
      sql`${table.closedBy} IS NULL OR ${table.closedBy} IN ('arrival', 'deadline')`,
    ),
    resultStatusCheck: check(
      "monitor_cycles_result_status_check",
      sql`${table.resultStatus} IS NULL OR ${table.resultStatus} IN ('up', 'down')`,
    ),
    openDeadlineIdx: index("monitor_cycles_open_deadline_idx")
      .on(table.deadlineAt)
      .where(sql`${table.status} = 'open'`),
    retentionIdx: index("monitor_cycles_retention_idx")
      .on(table.closedAt)
      .where(sql`${table.closedAt} IS NOT NULL`),
    notifyPendingIdx: index("monitor_cycles_notify_pending_idx")
      .on(table.closedAt)
      .where(sql`${table.status} = 'closed' AND ${table.notifiedAt} IS NULL`),
  }),
);

/** Wake-up hint written after a regional result is saved; evaluation reads monitor_results. */
export const monitorCycleArrivals = pgTable(
  "monitor_cycle_arrivals",
  {
    id: uuid("id").primaryKey().$defaultFn(() => sql`uuidv7()`),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => monitorCycles.id, { onDelete: "cascade" }),
    location: text("location").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    cycleLocationIdx: uniqueIndex("monitor_cycle_arrivals_cycle_location_idx").on(table.cycleId, table.location),
    pendingIdx: index("monitor_cycle_arrivals_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.processedAt} IS NULL`),
  }),
);

export type MonitorCycle = typeof monitorCycles.$inferSelect;
export type MonitorCycleInsert = typeof monitorCycles.$inferInsert;
