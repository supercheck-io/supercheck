import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Addresses the email provider reported as hard bounces. Mailers never send to them again,
 * because repeated hard bounces get the sending account blocked. Keyed by the lowercased address.
 */
export const emailSuppressions = pgTable("email_suppressions", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  source: text("source").notNull(),
  diagnostic: text("diagnostic"),
  bounceCount: integer("bounce_count").notNull().default(1),
  firstBouncedAt: timestamp("first_bounced_at", { withTimezone: true }).notNull().defaultNow(),
  lastBouncedAt: timestamp("last_bounced_at", { withTimezone: true }).notNull().defaultNow(),
});
