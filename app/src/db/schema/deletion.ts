/* ================================
   DELETION SCHEMA
   -------------------------------
   Source of truth for background purges (jobs, monitors, projects, organizations).
=================================== */

import { pgTable, uuid, varchar, text, integer, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const DELETION_SCOPES = ["job", "monitor", "project", "organization"] as const;
export type DeletionScope = (typeof DELETION_SCOPES)[number];
export const DELETION_STATES = ["queued", "running", "completed", "failed"] as const;
export type DeletionState = (typeof DELETION_STATES)[number];

/**
 * One row per purge. BullMQ only triggers; this table decides what is left to do, so a lost queue message,
 * a crashed pod or a restart never loses a deletion. Deliberately no foreign keys: the row must outlive its target.
 */
export const deletionJobs = pgTable(
  "deletion_jobs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => sql`uuidv7()`),
    scope: varchar("scope", { length: 20 }).$type<DeletionScope>().notNull(),
    targetId: uuid("target_id").notNull(),
    organizationId: uuid("organization_id"),
    state: varchar("state", { length: 20 }).$type<DeletionState>().notNull().default("queued"),
    phase: varchar("phase", { length: 40 }),
    // Progress counters for observability; the target rows themselves are the real cursor.
    cursor: jsonb("cursor").$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    lastError: text("last_error"),
    requestedByUserId: uuid("requested_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    // One live purge per target: concurrent delete requests from several pods converge on one row.
    activeTargetIdx: uniqueIndex("deletion_jobs_active_target_idx")
      .on(table.scope, table.targetId)
      .where(sql`state <> 'completed'`),
    // The sweeper only looks at unfinished rows.
    pendingIdx: index("deletion_jobs_pending_idx")
      .on(table.state, table.nextAttemptAt)
      .where(sql`state IN ('queued', 'running')`),
    scopeCheck: check("deletion_jobs_scope_check", sql`${table.scope} IN ('job', 'monitor', 'project', 'organization')`),
    stateCheck: check("deletion_jobs_state_check", sql`${table.state} IN ('queued', 'running', 'completed', 'failed')`),
  })
);
