/* ================================
   OBSERVABILITY SCHEMA
   -------------------------------
   Tables for observability functionality including saved queries,
   dashboards, bookmarks, and alert rules for traces/logs/metrics
=================================== */

import {
  integer,
  pgTable,
  text,
  varchar,
  
  timestamp,
  jsonb,
  uuid,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { organization, projects } from "./organization";
import { user } from "./auth";

/**
 * Saved Queries - User-saved trace/log/metric queries
 */
export const observabilitySavedQueries = pgTable(
  "observability_saved_queries",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),

    // Query type: "traces", "logs", "metrics"
    queryType: varchar("query_type", { length: 50 }).notNull(),

    // Serialized query filters (TraceFilters, LogFilters, or MetricFilters)
    filters: jsonb("filters").notNull(),

    // Whether this query is pinned to the user's dashboard
    isPinned: boolean("is_pinned").default(false),

    // Whether this query is shared with the organization
    isShared: boolean("is_shared").default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    orgProjectIdx: index("obs_saved_queries_org_project_idx").on(
      table.organizationId,
      table.projectId
    ),
    userIdx: index("obs_saved_queries_user_idx").on(table.createdByUserId),
    typeIdx: index("obs_saved_queries_type_idx").on(table.queryType),
  })
);

/**
 * Dashboards - Custom observability dashboards
 */
export const observabilityDashboards = pgTable(
  "observability_dashboards",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),

    // Dashboard layout and widgets configuration
    layout: jsonb("layout").notNull(),

    // Time range settings
    timeRange: jsonb("time_range"),

    // Auto-refresh interval in seconds (null = no auto-refresh)
    refreshInterval: integer("refresh_interval"),

    isDefault: boolean("is_default").default(false),
    isShared: boolean("is_shared").default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    orgProjectIdx: index("obs_dashboards_org_project_idx").on(
      table.organizationId,
      table.projectId
    ),
    userIdx: index("obs_dashboards_user_idx").on(table.createdByUserId),
  })
);

/**
 * Trace Bookmarks - User-bookmarked interesting traces
 */
export const observabilityTraceBookmarks = pgTable(
  "observability_trace_bookmarks",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    traceId: varchar("trace_id", { length: 32 }).notNull(),

    // User notes about this trace
    notes: text("notes"),

    // Tags for categorization
    tags: jsonb("tags").$type<string[]>(),

    // Associated run context
    runId: varchar("run_id", { length: 255 }),
    runType: varchar("run_type", { length: 50 }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userTraceIdx: uniqueIndex("obs_trace_bookmarks_user_trace_idx").on(
      table.userId,
      table.traceId
    ),
    orgProjectIdx: index("obs_trace_bookmarks_org_project_idx").on(
      table.organizationId,
      table.projectId
    ),
  })
);

/**
 * Alert Rules - Define alert conditions on observability data
 */
export const observabilityAlertRules = pgTable(
  "observability_alert_rules",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),

    // Rule type: "error_rate", "latency", "throughput", "log_pattern"
    ruleType: varchar("rule_type", { length: 50 }).notNull(),

    // Alert condition configuration
    condition: jsonb("condition").notNull(),

    // Threshold values
    threshold: jsonb("threshold").notNull(),

    // Evaluation window (e.g., "5m", "1h")
    evaluationWindow: varchar("evaluation_window", { length: 20 }).notNull(),

    // Notification channels (email, slack, webhook)
    notificationChannels: jsonb("notification_channels").$type<string[]>(),

    // Alert severity: "info", "warning", "critical"
    severity: varchar("severity", { length: 20 }).notNull(),

    isEnabled: boolean("is_enabled").default(true),

    // Last time this rule was evaluated
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),

    // Last time this rule triggered an alert
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    orgProjectIdx: index("obs_alert_rules_org_project_idx").on(
      table.organizationId,
      table.projectId
    ),
    enabledIdx: index("obs_alert_rules_enabled_idx").on(table.isEnabled),
  })
);

/**
 * Alert Incidents - Triggered alerts history
 */
export const observabilityAlertIncidents = pgTable(
  "observability_alert_incidents",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    alertRuleId: uuid("alert_rule_id")
      .notNull()
      .references(() => observabilityAlertRules.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Incident status: "firing", "resolved"
    status: varchar("status", { length: 20 }).notNull(),

    // The value that triggered the alert
    triggeredValue: jsonb("triggered_value"),

    // Related traces/logs that caused the alert
    relatedTraceIds: jsonb("related_trace_ids").$type<string[]>(),

    // Incident metadata
    metadata: jsonb("metadata"),

    triggeredAt: timestamp("triggered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    // Notification sent status
    notificationsSent: boolean("notifications_sent").default(false),
  },
  (table) => ({
    ruleIdx: index("obs_alert_incidents_rule_idx").on(table.alertRuleId),
    statusIdx: index("obs_alert_incidents_status_idx").on(table.status),
    triggeredAtIdx: index("obs_alert_incidents_triggered_at_idx").on(
      table.triggeredAt
    ),
  })
);

/**
 * Service Catalog - Registered services for observability
 */
export const observabilityServiceCatalog = pgTable(
  "observability_service_catalog",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),

    // Service name (from OTel service.name)
    serviceName: varchar("service_name", { length: 255 }).notNull(),

    // Human-friendly display name
    displayName: varchar("display_name", { length: 255 }),

    description: text("description"),

    // Service owner/team
    owner: varchar("owner", { length: 255 }),

    // Repository URL
    repositoryUrl: text("repository_url"),

    // Documentation URL
    docsUrl: text("docs_url"),

    // Service metadata
    metadata: jsonb("metadata"),

    // Last seen timestamp (updated automatically)
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    orgServiceIdx: uniqueIndex("obs_service_catalog_org_service_idx").on(
      table.organizationId,
      table.serviceName
    ),
    projectIdx: index("obs_service_catalog_project_idx").on(table.projectId),
  })
);

// ============================================================================
// RELATIONS
// ============================================================================

export const observabilitySavedQueriesRelations = relations(
  observabilitySavedQueries,
  ({ one }) => ({
    organization: one(organization, {
      fields: [observabilitySavedQueries.organizationId],
      references: [organization.id],
    }),
    project: one(projects, {
      fields: [observabilitySavedQueries.projectId],
      references: [projects.id],
    }),
    createdBy: one(user, {
      fields: [observabilitySavedQueries.createdByUserId],
      references: [user.id],
    }),
  })
);

export const observabilityDashboardsRelations = relations(
  observabilityDashboards,
  ({ one }) => ({
    organization: one(organization, {
      fields: [observabilityDashboards.organizationId],
      references: [organization.id],
    }),
    project: one(projects, {
      fields: [observabilityDashboards.projectId],
      references: [projects.id],
    }),
    createdBy: one(user, {
      fields: [observabilityDashboards.createdByUserId],
      references: [user.id],
    }),
  })
);

export const observabilityTraceBookmarksRelations = relations(
  observabilityTraceBookmarks,
  ({ one }) => ({
    organization: one(organization, {
      fields: [observabilityTraceBookmarks.organizationId],
      references: [organization.id],
    }),
    project: one(projects, {
      fields: [observabilityTraceBookmarks.projectId],
      references: [projects.id],
    }),
    user: one(user, {
      fields: [observabilityTraceBookmarks.userId],
      references: [user.id],
    }),
  })
);

export const observabilityAlertRulesRelations = relations(
  observabilityAlertRules,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [observabilityAlertRules.organizationId],
      references: [organization.id],
    }),
    project: one(projects, {
      fields: [observabilityAlertRules.projectId],
      references: [projects.id],
    }),
    createdBy: one(user, {
      fields: [observabilityAlertRules.createdByUserId],
      references: [user.id],
    }),
    incidents: many(observabilityAlertIncidents),
  })
);

export const observabilityAlertIncidentsRelations = relations(
  observabilityAlertIncidents,
  ({ one }) => ({
    alertRule: one(observabilityAlertRules, {
      fields: [observabilityAlertIncidents.alertRuleId],
      references: [observabilityAlertRules.id],
    }),
    organization: one(organization, {
      fields: [observabilityAlertIncidents.organizationId],
      references: [organization.id],
    }),
  })
);

export const observabilityServiceCatalogRelations = relations(
  observabilityServiceCatalog,
  ({ one }) => ({
    organization: one(organization, {
      fields: [observabilityServiceCatalog.organizationId],
      references: [organization.id],
    }),
    project: one(projects, {
      fields: [observabilityServiceCatalog.projectId],
      references: [projects.id],
    }),
  })
);

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

export const insertSavedQuerySchema = createInsertSchema(observabilitySavedQueries);
export const selectSavedQuerySchema = createSelectSchema(observabilitySavedQueries);

export const insertDashboardSchema = createInsertSchema(observabilityDashboards);
export const selectDashboardSchema = createSelectSchema(observabilityDashboards);

export const insertTraceBookmarkSchema = createInsertSchema(observabilityTraceBookmarks);
export const selectTraceBookmarkSchema = createSelectSchema(observabilityTraceBookmarks);

export const insertAlertRuleSchema = createInsertSchema(observabilityAlertRules);
export const selectAlertRuleSchema = createSelectSchema(observabilityAlertRules);

export const insertAlertIncidentSchema = createInsertSchema(observabilityAlertIncidents);
export const selectAlertIncidentSchema = createSelectSchema(observabilityAlertIncidents);

export const insertServiceCatalogSchema = createInsertSchema(observabilityServiceCatalog);
export const selectServiceCatalogSchema = createSelectSchema(observabilityServiceCatalog);

// ============================================================================
// TYPESCRIPT TYPES
// ============================================================================

export type SavedQuery = typeof observabilitySavedQueries.$inferSelect;
export type NewSavedQuery = typeof observabilitySavedQueries.$inferInsert;

export type Dashboard = typeof observabilityDashboards.$inferSelect;
export type NewDashboard = typeof observabilityDashboards.$inferInsert;

export type TraceBookmark = typeof observabilityTraceBookmarks.$inferSelect;
export type NewTraceBookmark = typeof observabilityTraceBookmarks.$inferInsert;

export type AlertRule = typeof observabilityAlertRules.$inferSelect;
export type NewAlertRule = typeof observabilityAlertRules.$inferInsert;

export type AlertIncident = typeof observabilityAlertIncidents.$inferSelect;
export type NewAlertIncident = typeof observabilityAlertIncidents.$inferInsert;

export type ServiceCatalogEntry = typeof observabilityServiceCatalog.$inferSelect;
export type NewServiceCatalogEntry = typeof observabilityServiceCatalog.$inferInsert;
