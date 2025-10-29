/* ================================
   AUDIT SCHEMA
   -------------------------------
   Tables for audit logging and tracking user actions
=================================== */

import { pgTable, varchar, timestamp, jsonb, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { user } from './auth';
import { organization } from './organization';
import type { AuditDetails } from './types';

/**
 * Records a log of all significant actions performed by users.
 */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  userId: uuid('user_id').references(() => user.id),
  organizationId: uuid('organization_id').references(() => organization.id),
  action: varchar('action', { length: 255 }).notNull(),
  details: jsonb('details').$type<AuditDetails>(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Zod schemas for audit logs
export const auditLogsInsertSchema = createInsertSchema(auditLogs);
export const auditLogsSelectSchema = createSelectSchema(auditLogs);
