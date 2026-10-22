import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organization } from './organization';

export const executionEntitlements = pgTable(
  'execution_entitlements',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    runningCapacity: integer('running_capacity').notNull().default(1),
    queuedCapacity: integer('queued_capacity').notNull().default(10),
    k6MaxVus: integer('k6_max_vus').notNull().default(5),
    playwrightBudgetMs: bigint('playwright_budget_ms', { mode: 'number' })
      .notNull()
      .default(1800000),
    playwrightUsedMs: bigint('playwright_used_ms', { mode: 'number' })
      .notNull()
      .default(0),
  },
  (table) => [
    check(
      'execution_entitlements_limits_check',
      sql`${table.runningCapacity} > 0 AND ${table.queuedCapacity} > 0 AND ${table.k6MaxVus} BETWEEN 1 AND 5 AND ${table.playwrightBudgetMs} > 0 AND ${table.playwrightUsedMs} >= 0`,
    ),
  ],
);

export const executionReservations = pgTable(
  'execution_reservations',
  {
    runId: text('run_id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'playwright' | 'k6'>().notNull(),
    tier: text('tier').$type<'paid' | 'trial'>().notNull(),
    reservedMs: bigint('reserved_ms', { mode: 'number' }).notNull(),
    usedMs: bigint('used_ms', { mode: 'number' }).notNull().default(0),
    ownerToken: uuid('owner_token').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    // Crash safety: a row whose lease lapsed no longer holds capacity.
    leaseExpiresAt: timestamp('lease_expires_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index('execution_reservations_active_idx')
      .on(table.organizationId)
      .where(sql`${table.finishedAt} IS NULL`),
    check(
      'execution_reservations_values_check',
      sql`${table.kind} IN ('playwright', 'k6') AND ${table.tier} IN ('paid', 'trial') AND ${table.reservedMs} >= 0 AND ${table.usedMs} >= 0`,
    ),
  ],
);

export const executionTargetDomains = pgTable(
  'execution_target_domains',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    verificationToken: text('verification_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedUntil: timestamp('verified_until', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('execution_target_domains_org_host_key').on(
      table.organizationId,
      table.hostname,
    ),
  ],
);
