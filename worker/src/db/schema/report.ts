/* ================================
   REPORT SCHEMA
   -------------------------------
   Tables for report generation and storage
=================================== */

import {
  pgTable,
  text,
  varchar,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organization } from './organization';
import { user } from './auth';
import type { ReportType } from './types';

/**
 * Stores information about generated reports for tests or jobs.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    createdByUserId: uuid('created_by_user_id').references(() => user.id, {
      onDelete: 'no action',
    }),
    entityType: varchar('entity_type', { length: 50 })
      .$type<ReportType>()
      .notNull(),
    entityId: text('entity_id').notNull(), // Changed from uuid to support extended execution IDs
    reportPath: varchar('report_path', { length: 255 }).notNull(),
    status: varchar('status', { length: 50 }).notNull().default('running'),
    s3Url: varchar('s3_url', { length: 1024 }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    typeIdUnique: uniqueIndex('reports_entity_type_id_idx').on(
      table.entityType,
      table.entityId,
    ),
  }),
);
