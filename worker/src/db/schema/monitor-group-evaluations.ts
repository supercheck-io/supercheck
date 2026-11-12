/* Alert receipt for one legacy (worker-aggregated) check group; mirrors app/src/db/schema/monitor-group-evaluations.ts. */
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { monitors } from './monitor';

export const monitorGroupEvaluations = pgTable(
  'monitor_group_evaluations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    executionGroupId: text('execution_group_id').notNull(),
    evaluation: jsonb('evaluation').$type<Record<string, unknown>>().notNull(),
    notificationProcessedAt: timestamp('notification_processed_at', {
      withTimezone: true,
    }),
    // Lease on sending the group's alerts: set by the claim, cleared on failure, ignored once processed.
    notificationClaimedAt: timestamp('notification_claimed_at', {
      withTimezone: true,
    }),
    notificationClaimToken: uuid('notification_claim_token'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    groupIdx: uniqueIndex('monitor_group_evaluations_group_idx').on(
      table.monitorId,
      table.executionGroupId,
    ),
    createdAtIdx: index('monitor_group_evaluations_created_at_idx').on(
      table.createdAt,
    ),
  }),
);
