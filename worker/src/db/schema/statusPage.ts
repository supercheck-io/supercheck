/* ================================
   STATUS PAGE SCHEMA
   -------------------------------
   Tables for status page functionality including pages, components,
   incidents, subscribers, and metrics
=================================== */

import {
  integer,
  pgTable,
  text,
  varchar,
  primaryKey,
  timestamp,
  jsonb,
  uuid,
  boolean,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from 'drizzle-zod';
import { organization, projects } from './organization';
import { user } from './auth';
import { monitors } from './monitor';
import type {
  StatusPageStatus,
  ComponentStatus,
  IncidentStatus,
  IncidentImpact,
  SubscriberMode,
} from './types';

/**
 * Stores status page configurations with UUID-based subdomains
 */
export const statusPages = pgTable('status_pages', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, {
    onDelete: 'cascade',
  }),
  createdByUserId: uuid('created_by_user_id').references(() => user.id, {
    onDelete: 'no action',
  }),
  name: varchar('name', { length: 255 }).notNull(),
  subdomain: varchar('subdomain', { length: 36 }).unique().notNull(),
  status: varchar('status', { length: 50 })
    .$type<StatusPageStatus>()
    .notNull()
    .default('draft'),
  pageDescription: text('page_description'),
  headline: varchar('headline', { length: 255 }),
  supportUrl: varchar('support_url', { length: 500 }),
  allowPageSubscribers: boolean('allow_page_subscribers').default(true),
  allowIncidentSubscribers: boolean('allow_incident_subscribers').default(true),
  allowEmailSubscribers: boolean('allow_email_subscribers').default(true),
  allowWebhookSubscribers: boolean('allow_webhook_subscribers').default(true),
  allowSlackSubscribers: boolean('allow_slack_subscribers').default(true),
  allowRssFeed: boolean('allow_rss_feed').default(true),
  notificationsFromEmail: varchar('notifications_from_email', { length: 255 }),
  notificationsEmailFooter: text('notifications_email_footer'),
  timezone: varchar('timezone', { length: 50 }).default('UTC'),
  // Branding
  cssBodyBackgroundColor: varchar('css_body_background_color', {
    length: 7,
  }).default('#ffffff'),
  cssFontColor: varchar('css_font_color', { length: 7 }).default('#333333'),
  cssLightFontColor: varchar('css_light_font_color', { length: 7 }).default(
    '#666666',
  ),
  cssGreens: varchar('css_greens', { length: 7 }).default('#2ecc71'),
  cssYellows: varchar('css_yellows', { length: 7 }).default('#f1c40f'),
  cssOranges: varchar('css_oranges', { length: 7 }).default('#e67e22'),
  cssBlues: varchar('css_blues', { length: 7 }).default('#3498db'),
  cssReds: varchar('css_reds', { length: 7 }).default('#e74c3c'),
  cssBorderColor: varchar('css_border_color', { length: 7 }).default('#ecf0f1'),
  cssGraphColor: varchar('css_graph_color', { length: 7 }).default('#3498db'),
  cssLinkColor: varchar('css_link_color', { length: 7 }).default('#3498db'),
  cssNoData: varchar('css_no_data', { length: 7 }).default('#bdc3c7'),
  faviconLogo: varchar('favicon_logo', { length: 500 }),
  transactionalLogo: varchar('transactional_logo', { length: 500 }),
  heroCover: varchar('hero_cover', { length: 500 }),
  customDomain: varchar('custom_domain', { length: 255 }),
  customDomainVerified: boolean('custom_domain_verified').default(false),
  theme: jsonb('theme').default({}),
  brandingSettings: jsonb('branding_settings').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * Status page components linked to monitors
 */
export const statusPageComponents = pgTable('status_page_components', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  statusPageId: uuid('status_page_id')
    .notNull()
    .references(() => statusPages.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 })
    .$type<ComponentStatus>()
    .notNull()
    .default('operational'),
  showcase: boolean('showcase').default(true),
  onlyShowIfDegraded: boolean('only_show_if_degraded').default(false),
  automationEmail: varchar('automation_email', { length: 255 }),
  startDate: timestamp('start_date'),
  position: integer('position').default(0),
  // Aggregation settings for multiple monitors
  aggregationMethod: varchar('aggregation_method', { length: 50 })
    .default('worst_case')
    .notNull(),
  failureThreshold: integer('failure_threshold').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * Join table to link status page components with multiple monitors
 */
export const statusPageComponentMonitors = pgTable(
  'status_page_component_monitors',
  {
    componentId: uuid('component_id')
      .notNull()
      .references(() => statusPageComponents.id, { onDelete: 'cascade' }),
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    weight: integer('weight').default(1).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.componentId, table.monitorId] }),
  }),
);

/**
 * Incidents with workflow support
 */
export const incidents = pgTable('incidents', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  statusPageId: uuid('status_page_id')
    .notNull()
    .references(() => statusPages.id, { onDelete: 'cascade' }),
  createdByUserId: uuid('created_by_user_id').references(() => user.id, {
    onDelete: 'no action',
  }),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 })
    .$type<IncidentStatus>()
    .notNull()
    .default('investigating'),
  impact: varchar('impact', { length: 50 })
    .$type<IncidentImpact>()
    .notNull()
    .default('minor'),
  impactOverride: varchar('impact_override', { length: 50 }),
  body: text('body'),
  scheduledFor: timestamp('scheduled_for'),
  scheduledUntil: timestamp('scheduled_until'),
  scheduledRemindPrior: boolean('scheduled_remind_prior').default(true),
  autoTransitionToMaintenanceState: boolean(
    'auto_transition_to_maintenance_state',
  ).default(true),
  autoTransitionToOperationalState: boolean(
    'auto_transition_to_operational_state',
  ).default(true),
  scheduledAutoInProgress: boolean('scheduled_auto_in_progress').default(true),
  scheduledAutoCompleted: boolean('scheduled_auto_completed').default(true),
  autoTransitionDeliverNotificationsAtStart: boolean(
    'auto_transition_deliver_notifications_at_start',
  ).default(true),
  autoTransitionDeliverNotificationsAtEnd: boolean(
    'auto_transition_deliver_notifications_at_end',
  ).default(true),
  reminderIntervals: varchar('reminder_intervals', { length: 100 }).default(
    '[3,6,12,24]',
  ),
  metadata: jsonb('metadata').default({}),
  deliverNotifications: boolean('deliver_notifications').default(true),
  backfillDate: timestamp('backfill_date'),
  backfilled: boolean('backfilled').default(false),
  monitoringAt: timestamp('monitoring_at'),
  resolvedAt: timestamp('resolved_at'),
  shortlink: varchar('shortlink', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * Incident updates with notification controls
 */
export const incidentUpdates = pgTable('incident_updates', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  incidentId: uuid('incident_id')
    .notNull()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  createdByUserId: uuid('created_by_user_id').references(() => user.id, {
    onDelete: 'no action',
  }),
  body: text('body').notNull(),
  status: varchar('status', { length: 50 })
    .$type<IncidentStatus>()
    .notNull()
    .default('investigating'),
  deliverNotifications: boolean('deliver_notifications').default(true),
  displayAt: timestamp('display_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * Affected components for incidents
 */
export const incidentComponents = pgTable('incident_components', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  incidentId: uuid('incident_id')
    .notNull()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  componentId: uuid('component_id')
    .notNull()
    .references(() => statusPageComponents.id, { onDelete: 'cascade' }),
  oldStatus: varchar('old_status', { length: 50 }),
  newStatus: varchar('new_status', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow(),
});

/**
 * Incident templates for common issues
 */
export const incidentTemplates = pgTable('incident_templates', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  statusPageId: uuid('status_page_id')
    .notNull()
    .references(() => statusPages.id, { onDelete: 'cascade' }),
  createdByUserId: uuid('created_by_user_id').references(() => user.id, {
    onDelete: 'no action',
  }),
  name: varchar('name', { length: 255 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body').notNull(),
  updateStatus: varchar('update_status', { length: 50 }).default(
    'investigating',
  ),
  shouldSendNotifications: boolean('should_send_notifications').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * Template component associations
 */
export const incidentTemplateComponents = pgTable(
  'incident_template_components',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    templateId: uuid('template_id')
      .notNull()
      .references(() => incidentTemplates.id, { onDelete: 'cascade' }),
    componentId: uuid('component_id')
      .notNull()
      .references(() => statusPageComponents.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
  },
);

/**
 * Subscribers with enhanced preferences
 */
export const statusPageSubscribers = pgTable('status_page_subscribers', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  statusPageId: uuid('status_page_id')
    .notNull()
    .references(() => statusPages.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }),
  endpoint: varchar('endpoint', { length: 500 }),
  mode: varchar('mode', { length: 50 }).$type<SubscriberMode>().notNull(),
  skipConfirmationNotification: boolean(
    'skip_confirmation_notification',
  ).default(false),
  quarantinedAt: timestamp('quarantined_at'),
  purgeAt: timestamp('purge_at'),
  verifiedAt: timestamp('verified_at'),
  verificationToken: varchar('verification_token', { length: 255 }),
  unsubscribeToken: varchar('unsubscribe_token', { length: 255 }),
  // Webhook security and delivery tracking
  webhookSecret: varchar('webhook_secret', { length: 255 }),
  webhookFailures: integer('webhook_failures').default(0),
  webhookLastAttemptAt: timestamp('webhook_last_attempt_at'),
  webhookLastError: text('webhook_last_error'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * Component-specific subscriptions
 */
export const statusPageComponentSubscriptions = pgTable(
  'status_page_component_subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    subscriberId: uuid('subscriber_id')
      .notNull()
      .references(() => statusPageSubscribers.id, { onDelete: 'cascade' }),
    componentId: uuid('component_id')
      .notNull()
      .references(() => statusPageComponents.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
  },
);

/**
 * Incident-specific subscriptions
 */
export const statusPageIncidentSubscriptions = pgTable(
  'status_page_incident_subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    subscriberId: uuid('subscriber_id')
      .notNull()
      .references(() => statusPageSubscribers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
  },
);

/**
 * Status page metrics with detailed tracking
 */
export const statusPageMetrics = pgTable(
  'status_page_metrics',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    statusPageId: uuid('status_page_id')
      .notNull()
      .references(() => statusPages.id, { onDelete: 'cascade' }),
    componentId: uuid('component_id').references(
      () => statusPageComponents.id,
      { onDelete: 'cascade' },
    ),
    date: timestamp('date').notNull(),
    uptimePercentage: varchar('uptime_percentage', { length: 10 }),
    totalChecks: integer('total_checks').default(0),
    successfulChecks: integer('successful_checks').default(0),
    failedChecks: integer('failed_checks').default(0),
    averageResponseTimeMs: integer('average_response_time_ms'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    dateIdx: uniqueIndex('status_page_metrics_date_component_idx').on(
      table.statusPageId,
      table.componentId,
      table.date,
    ),
  }),
);

/**
 * Postmortems for incident analysis
 */
export const postmortems = pgTable(
  'postmortems',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => user.id, {
      onDelete: 'no action',
    }),
    body: text('body').notNull(),
    bodyLastUpdatedAt: timestamp('body_last_updated_at').defaultNow(),
    ignored: boolean('ignored').default(false),
    notifiedSubscribers: boolean('notified_subscribers').default(false),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    incidentIdx: uniqueIndex('postmortems_incident_idx').on(table.incidentId),
  }),
);

/* ================================
   STATUS PAGE RELATIONS
   -------------------------------
   Define Drizzle ORM relations for status pages
=================================== */

// Incidents relations
export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  statusPage: one(statusPages, {
    fields: [incidents.statusPageId],
    references: [statusPages.id],
  }),
  updates: many(incidentUpdates),
  affectedComponents: many(incidentComponents),
  postmortem: one(postmortems),
}));

// Incident Updates relations
export const incidentUpdatesRelations = relations(
  incidentUpdates,
  ({ one }) => ({
    incident: one(incidents, {
      fields: [incidentUpdates.incidentId],
      references: [incidents.id],
    }),
  }),
);

// Incident Components relations
export const incidentComponentsRelations = relations(
  incidentComponents,
  ({ one }) => ({
    incident: one(incidents, {
      fields: [incidentComponents.incidentId],
      references: [incidents.id],
    }),
    component: one(statusPageComponents, {
      fields: [incidentComponents.componentId],
      references: [statusPageComponents.id],
    }),
  }),
);

// Status Page Components relations
export const statusPageComponentsRelations = relations(
  statusPageComponents,
  ({ one, many }) => ({
    statusPage: one(statusPages, {
      fields: [statusPageComponents.statusPageId],
      references: [statusPages.id],
    }),
    monitors: many(statusPageComponentMonitors),
    incidents: many(incidentComponents),
  }),
);

// Status Page Component Monitors relations
export const statusPageComponentMonitorsRelations = relations(
  statusPageComponentMonitors,
  ({ one }) => ({
    component: one(statusPageComponents, {
      fields: [statusPageComponentMonitors.componentId],
      references: [statusPageComponents.id],
    }),
    monitor: one(monitors, {
      fields: [statusPageComponentMonitors.monitorId],
      references: [monitors.id],
    }),
  }),
);

// Status Page Subscribers relations
export const statusPageSubscribersRelations = relations(
  statusPageSubscribers,
  ({ one }) => ({
    statusPage: one(statusPages, {
      fields: [statusPageSubscribers.statusPageId],
      references: [statusPages.id],
    }),
  }),
);

// Zod Schemas for Status Pages
export const statusPagesInsertSchema = createInsertSchema(statusPages);
export const statusPagesSelectSchema = createSelectSchema(statusPages);
export const statusPagesUpdateSchema = createUpdateSchema(statusPages);

export const statusPageComponentsInsertSchema =
  createInsertSchema(statusPageComponents);
export const statusPageComponentsSelectSchema =
  createSelectSchema(statusPageComponents);

export const statusPageComponentMonitorsInsertSchema = createInsertSchema(
  statusPageComponentMonitors,
);
export const statusPageComponentMonitorsSelectSchema = createSelectSchema(
  statusPageComponentMonitors,
);

export const incidentsInsertSchema = createInsertSchema(incidents);
export const incidentsSelectSchema = createSelectSchema(incidents);
export const incidentsUpdateSchema = createUpdateSchema(incidents);

export const incidentUpdatesInsertSchema = createInsertSchema(incidentUpdates);
export const incidentUpdatesSelectSchema = createSelectSchema(incidentUpdates);

export const incidentTemplatesInsertSchema =
  createInsertSchema(incidentTemplates);
export const incidentTemplatesSelectSchema =
  createSelectSchema(incidentTemplates);

export const statusPageSubscribersInsertSchema = createInsertSchema(
  statusPageSubscribers,
);
export const statusPageSubscribersSelectSchema = createSelectSchema(
  statusPageSubscribers,
);

export const statusPageMetricsInsertSchema =
  createInsertSchema(statusPageMetrics);
export const statusPageMetricsSelectSchema =
  createSelectSchema(statusPageMetrics);

export const postmortemsInsertSchema = createInsertSchema(postmortems);
export const postmortemsSelectSchema = createSelectSchema(postmortems);
