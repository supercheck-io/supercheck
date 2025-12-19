/* ================================
   AUDIT SCHEMA
   -------------------------------
   Tables for audit logging and tracking user actions
=================================== */

import {
  pgTable,
  varchar,
  timestamp,
  jsonb,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";
import { organization } from "./organization";
import type { AuditDetails } from "./types";

/**
 * Records a log of all significant actions performed by users.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    userId: uuid("user_id").references(() => user.id),
    organizationId: uuid("organization_id").references(() => organization.id),
    action: varchar("action", { length: 255 }).notNull(),
    details: jsonb("details").$type<AuditDetails>(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    // PERFORMANCE: Indexes for dashboard queries
    actionIdx: index("audit_logs_action_idx").on(table.action),
    organizationIdIdx: index("audit_logs_organization_id_idx").on(table.organizationId),
    createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt),
    // Composite index for dashboard playground queries
    actionOrgCreatedIdx: index("audit_logs_action_org_created_idx").on(
      table.action,
      table.organizationId,
      table.createdAt
    ),
  })
);

// Zod schemas for audit logs
export const auditLogsInsertSchema = createInsertSchema(auditLogs);
export const auditLogsSelectSchema = createSelectSchema(auditLogs);
