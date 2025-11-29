/* ================================
   BILLING SCHEMA
   -------------------------------
   Tables for usage-based billing, spending limits, and notifications
=================================== */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { organization } from "./organization";

/**
 * Organization billing settings
 * Stores spending limits and notification preferences per organization
 */
export const billingSettings = pgTable(
  "billing_settings",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Spending limits (in cents to avoid floating point issues)
    monthlySpendingLimitCents: integer("monthly_spending_limit_cents"), // null = no limit
    enableSpendingLimit: boolean("enable_spending_limit").default(false).notNull(),

    // Hard stop when limit reached (vs soft warning)
    hardStopOnLimit: boolean("hard_stop_on_limit").default(false).notNull(),

    // Usage notification thresholds (percentages)
    notifyAt50Percent: boolean("notify_at_50_percent").default(false).notNull(),
    notifyAt80Percent: boolean("notify_at_80_percent").default(true).notNull(),
    notifyAt90Percent: boolean("notify_at_90_percent").default(true).notNull(),
    notifyAt100Percent: boolean("notify_at_100_percent").default(true).notNull(),

    // Notification recipients (JSON array of emails, null = org admins only)
    notificationEmails: text("notification_emails"), // JSON array

    // Track which notifications have been sent this period
    lastNotificationSentAt: timestamp("last_notification_sent_at"),
    notificationsSentThisPeriod: text("notifications_sent_this_period"), // JSON array of thresholds

    // Metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    organizationIdIdx: index("billing_settings_org_id_idx").on(table.organizationId),
  })
);

/**
 * Usage events log
 * Tracks all usage events for audit and billing reconciliation
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Event details
    eventType: text("event_type")
      .$type<"playwright_execution" | "k6_execution" | "monitor_execution">()
      .notNull(),
    eventName: text("event_name").notNull(), // e.g., "playwright_minutes", "k6_vu_minutes"

    // Usage amount
    units: numeric("units", { precision: 10, scale: 4 }).notNull(),
    unitType: text("unit_type").notNull(), // "minutes", "vu_minutes"

    // Metadata for the event
    metadata: text("metadata"), // JSON - runId, jobId, testId, etc.

    // Polar sync status
    syncedToPolar: boolean("synced_to_polar").default(false).notNull(),
    polarEventId: text("polar_event_id"), // ID returned from Polar after sync
    syncError: text("sync_error"),
    syncAttempts: integer("sync_attempts").default(0).notNull(),
    lastSyncAttempt: timestamp("last_sync_attempt"),

    // Billing period this event belongs to
    billingPeriodStart: timestamp("billing_period_start").notNull(),
    billingPeriodEnd: timestamp("billing_period_end").notNull(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    organizationIdIdx: index("usage_events_org_id_idx").on(table.organizationId),
    eventTypeIdx: index("usage_events_event_type_idx").on(table.eventType),
    syncedToPolarIdx: index("usage_events_synced_idx").on(table.syncedToPolar),
    billingPeriodIdx: index("usage_events_billing_period_idx").on(
      table.billingPeriodStart,
      table.billingPeriodEnd
    ),
    createdAtIdx: index("usage_events_created_at_idx").on(table.createdAt),
  })
);

/**
 * Usage notifications history
 * Tracks all usage-related notifications sent to organizations
 */
export const usageNotifications = pgTable(
  "usage_notifications",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Notification type
    notificationType: text("notification_type")
      .$type<
        | "usage_50_percent"
        | "usage_80_percent"
        | "usage_90_percent"
        | "usage_100_percent"
        | "spending_limit_warning"
        | "spending_limit_reached"
        | "billing_period_reset"
      >()
      .notNull(),

    // Resource type (playwright, k6, or combined)
    resourceType: text("resource_type")
      .$type<"playwright" | "k6" | "combined" | "spending">()
      .notNull(),

    // Usage details at time of notification
    usageAmount: numeric("usage_amount", { precision: 10, scale: 4 }).notNull(),
    usageLimit: numeric("usage_limit", { precision: 10, scale: 4 }).notNull(),
    usagePercentage: integer("usage_percentage").notNull(),

    // Spending details (for spending limit notifications)
    currentSpendingCents: integer("current_spending_cents"),
    spendingLimitCents: integer("spending_limit_cents"),

    // Recipients
    sentTo: text("sent_to").notNull(), // JSON array of emails

    // Delivery status
    deliveryStatus: text("delivery_status")
      .$type<"pending" | "sent" | "failed">()
      .default("pending")
      .notNull(),
    deliveryError: text("delivery_error"),

    // Billing period
    billingPeriodStart: timestamp("billing_period_start").notNull(),
    billingPeriodEnd: timestamp("billing_period_end").notNull(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    sentAt: timestamp("sent_at"),
  },
  (table) => ({
    organizationIdIdx: index("usage_notifications_org_id_idx").on(table.organizationId),
    notificationTypeIdx: index("usage_notifications_type_idx").on(table.notificationType),
    billingPeriodIdx: index("usage_notifications_billing_period_idx").on(
      table.billingPeriodStart,
      table.billingPeriodEnd
    ),
  })
);

/**
 * Overage pricing configuration
 * Stores per-unit overage pricing for each plan
 */
export const overagePricing = pgTable("overage_pricing", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`),

  // Plan identifier
  plan: text("plan")
    .$type<"plus" | "pro">()
    .notNull()
    .unique(),

  // Overage pricing (in cents per unit)
  playwrightMinutePriceCents: integer("playwright_minute_price_cents").notNull(), // e.g., 10 = $0.10
  k6VuMinutePriceCents: integer("k6_vu_minute_price_cents").notNull(), // e.g., 1 = $0.01 per VU minute

  // Metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Zod schemas for validation
export const billingSettingsInsertSchema = createInsertSchema(billingSettings);
export const billingSettingsSelectSchema = createSelectSchema(billingSettings);

export const usageEventsInsertSchema = createInsertSchema(usageEvents);
export const usageEventsSelectSchema = createSelectSchema(usageEvents);

export const usageNotificationsInsertSchema = createInsertSchema(usageNotifications);
export const usageNotificationsSelectSchema = createSelectSchema(usageNotifications);

export const overagePricingInsertSchema = createInsertSchema(overagePricing);
export const overagePricingSelectSchema = createSelectSchema(overagePricing);

// Type exports
export type BillingSettings = typeof billingSettings.$inferSelect;
export type BillingSettingsInsert = typeof billingSettings.$inferInsert;

export type UsageEvent = typeof usageEvents.$inferSelect;
export type UsageEventInsert = typeof usageEvents.$inferInsert;

export type UsageNotification = typeof usageNotifications.$inferSelect;
export type UsageNotificationInsert = typeof usageNotifications.$inferInsert;

export type OveragePricing = typeof overagePricing.$inferSelect;
export type OveragePricingInsert = typeof overagePricing.$inferInsert;
