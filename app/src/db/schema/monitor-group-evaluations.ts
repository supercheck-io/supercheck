/*
 * Alert receipt for one legacy (worker-aggregated) monitor check group.
 *
 * The worker commits the group's decision here in the same transaction that advances the monitor's
 * counters, and stamps notification_processed_at once alerts were handled. Keeping the receipt out of
 * monitor_results lets result rows stay insert-only. Purged by age (telemetry-retention.ts).
 */
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { monitors } from "./monitor";

export const monitorGroupEvaluations = pgTable(
  "monitor_group_evaluations",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    executionGroupId: text("execution_group_id").notNull(),
    evaluation: jsonb("evaluation").$type<Record<string, unknown>>().notNull(),
    notificationProcessedAt: timestamp("notification_processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // One receipt per group; also serves the monitor FK cascade.
    groupIdx: uniqueIndex("monitor_group_evaluations_group_idx").on(table.monitorId, table.executionGroupId),
    createdAtIdx: index("monitor_group_evaluations_created_at_idx").on(table.createdAt),
  }),
);
