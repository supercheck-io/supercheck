import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { apikey, user } from "./auth";
import { projects } from "./organization";

export const DEVICE_GRANT_STATUSES = [
  "pending",
  "approved",
  "denied",
  "consumed",
] as const;
export type DeviceGrantStatus = (typeof DEVICE_GRANT_STATUSES)[number];

/**
 * RFC 8628 device authorization grants for the Supercheck CLI.
 *
 * Approval records consent only. The project API key is minted (and the grant
 * consumed) in a single transaction at token exchange, so plaintext key
 * material is never stored. Device secrets and user codes are stored hashed.
 * "Expired" is derived from `expires_at` rather than stored.
 */
export const deviceAuthorizations = pgTable(
  "device_authorizations",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    /** SHA-256 hex of the device_code (>=256 bits of entropy). */
    deviceCodeHash: varchar("device_code_hash", { length: 64 }).notNull(),
    /** HMAC-SHA-256 hex of the normalised user code (short, so keyed). */
    userCodeHash: varchar("user_code_hash", { length: 64 }).notNull(),
    clientId: varchar("client_id", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 })
      .$type<DeviceGrantStatus>()
      .notNull()
      .default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    /** Current minimum polling interval in seconds (grows on slow_down). */
    pollIntervalSeconds: integer("poll_interval_seconds").notNull().default(5),
    lastPolledAt: timestamp("last_polled_at"),
    /** Failed/blocked browser verification attempts against this grant. */
    verificationAttempts: integer("verification_attempts").notNull().default(0),
    approvedUserId: uuid("approved_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    approvedProjectId: uuid("approved_project_id").references(
      () => projects.id,
      { onDelete: "cascade" },
    ),
    approvedAt: timestamp("approved_at"),
    /** Key minted at exchange; null until consumed. Hash-only, no plaintext. */
    apiKeyId: uuid("api_key_id").references(() => apikey.id, {
      onDelete: "set null",
    }),
    consumedAt: timestamp("consumed_at"),
    /** Untrusted, display-only client metadata (name, version, hostname, ip). */
    clientMetadata: jsonb("client_metadata").$type<Record<string, string>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    deviceCodeHashIdx: uniqueIndex("device_authorizations_device_code_hash_idx").on(
      table.deviceCodeHash,
    ),
    userCodeHashIdx: uniqueIndex("device_authorizations_user_code_hash_idx").on(
      table.userCodeHash,
    ),
    expiresAtIdx: index("device_authorizations_expires_at_idx").on(
      table.expiresAt,
    ),
    statusCheck: check(
      "device_authorizations_status_check",
      sql`${table.status} IN ('pending', 'approved', 'denied', 'consumed')`,
    ),
  }),
);

export type DeviceAuthorization = typeof deviceAuthorizations.$inferSelect;
