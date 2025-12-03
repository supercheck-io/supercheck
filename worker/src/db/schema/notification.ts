/* ================================
   NOTIFICATION SCHEMA
   -------------------------------
   Tables for notification providers, alerts, and notification history
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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { organization, projects } from './organization';
import { user } from './auth';
import { monitors } from './monitor';
import { jobs } from './job';
import type {
  NotificationProviderType,
  NotificationProviderConfig,
  AlertType,
  AlertStatus,
  NotificationType,
  NotificationStatus,
  NotificationContent,
} from './types';

/**
 * Configures different channels for sending alerts (e.g., email, Slack).
 */
export const notificationProviders = pgTable('notification_providers', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  organizationId: uuid('organization_id').references(() => organization.id, {
    onDelete: 'cascade',
  }),
  projectId: uuid('project_id').references(() => projects.id, {
    onDelete: 'cascade',
  }),
  createdByUserId: uuid('created_by_user_id').references(() => user.id, {
    onDelete: 'no action',
  }),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 })
    .$type<NotificationProviderType>()
    .notNull(),
  config: jsonb('config').$type<NotificationProviderConfig>().notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * Logs the history of alerts that have been sent.
 */
export const alertHistory = pgTable('alert_history', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  message: text('message').notNull(),
  type: varchar('type', { length: 50 }).$type<AlertType>().notNull(),
  target: varchar('target', { length: 255 }).notNull(),
  targetType: varchar('target_type', { length: 50 }).notNull(),
  monitorId: uuid('monitor_id').references(() => monitors.id, {
    onDelete: 'cascade',
  }),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 100 }).notNull(),
  status: varchar('status', { length: 50 })
    .$type<AlertStatus>()
    .notNull()
    .default('pending'),
  sentAt: timestamp('sent_at').defaultNow(),
  errorMessage: text('error_message'),
});

/**
 * Join table to link monitors with specific notification providers.
 */
export const monitorNotificationSettings = pgTable(
  'monitor_notification_settings',
  {
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    notificationProviderId: uuid('notification_provider_id')
      .notNull()
      .references(() => notificationProviders.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'monitor_notification_settings_pk',
      columns: [table.monitorId, table.notificationProviderId],
    }),
  }),
);

/**
 * Join table to link jobs with specific notification providers.
 */
export const jobNotificationSettings = pgTable(
  'job_notification_settings',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    notificationProviderId: uuid('notification_provider_id')
      .notNull()
      .references(() => notificationProviders.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.jobId, table.notificationProviderId] }),
  }),
);

/**
 * A generic table for storing user-facing notifications.
 */
export const notifications = pgTable('notifications', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id),
  type: varchar('type', { length: 50 })
    .$type<NotificationType>()
    .notNull()
    .default('email'),
  content: jsonb('content').$type<NotificationContent>().notNull(),
  status: varchar('status', { length: 50 })
    .$type<NotificationStatus>()
    .notNull()
    .default('pending'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

/**
 * Configures alert settings for monitors.
 */
export const alerts = pgTable('alerts', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),
  organizationId: uuid('organization_id').references(() => organization.id, {
    onDelete: 'cascade',
  }),
  monitorId: uuid('monitor_id').references(() => monitors.id, {
    onDelete: 'cascade',
  }),
  enabled: boolean('enabled').default(true).notNull(),
  notificationProviders: jsonb('notification_providers').$type<string[]>(),
  alertOnFailure: boolean('alert_on_failure').default(true).notNull(),
  alertOnRecovery: boolean('alert_on_recovery').default(true),
  alertOnSslExpiration: boolean('alert_on_ssl_expiration').default(false),
  alertOnSuccess: boolean('alert_on_success').default(false),
  alertOnTimeout: boolean('alert_on_timeout').default(false),
  failureThreshold: integer('failure_threshold').default(1).notNull(),
  recoveryThreshold: integer('recovery_threshold').default(1).notNull(),
  customMessage: text('custom_message'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Zod schemas for notification providers
export const notificationProvidersInsertSchema = createInsertSchema(
  notificationProviders,
);
export const notificationProvidersSelectSchema = createSelectSchema(
  notificationProviders,
);

// Zod schemas for alerts
export const alertSchema = createSelectSchema(alerts);
export type Alert = z.infer<typeof alertSchema>;
export const insertAlertSchema = createInsertSchema(alerts);

// Zod schemas for notifications
export const notificationsInsertSchema = createInsertSchema(notifications);
export const notificationsSelectSchema = createSelectSchema(notifications);
