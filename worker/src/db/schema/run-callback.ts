import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

// No run FK: deletion must preserve the pointer to possibly late remote writes.
export const runCallbacks = pgTable(
  'run_callbacks',
  {
    runId: uuid('run_id').primaryKey(),
    owner: uuid('owner').notNull(),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    bucket: text('bucket'),
    cleanupAt: timestamp('cleanup_at', { withTimezone: true }),
  },
  (table) => [index('run_callbacks_cleanup_idx').on(table.cleanupAt)],
);
