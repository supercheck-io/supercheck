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
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./organization";

export const executionEntitlements = pgTable(
  "execution_entitlements",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    runningCapacity: integer("running_capacity").notNull().default(1),
    queuedCapacity: integer("queued_capacity").notNull().default(5),
    k6MaxVus: integer("k6_max_vus").notNull().default(5),
    playwrightBudgetMs: bigint("playwright_budget_ms", { mode: "number" })
      .notNull()
      .default(1800000),
    playwrightUsedMs: bigint("playwright_used_ms", { mode: "number" })
      .notNull()
      .default(0),
    /** Load-test allowance in virtual-user milliseconds (VUs x run time); 9,000,000 = 150 VU-minutes. */
    k6BudgetVuMs: bigint("k6_budget_vu_ms", { mode: "number" })
      .notNull()
      .default(9000000),
    k6UsedVuMs: bigint("k6_used_vu_ms", { mode: "number" })
      .notNull()
      .default(0),
    maxMonitors: integer("max_monitors").notNull().default(5),
    minCheckIntervalMinutes: integer("min_check_interval_minutes")
      .notNull()
      .default(5),
    maxStatusPages: integer("max_status_pages").notNull().default(2),
    maxStatusPageSubscribers: integer("max_status_page_subscribers")
      .notNull()
      .default(50),
    maxTeamMembers: integer("max_team_members").notNull().default(3),
    maxProjects: integer("max_projects").notNull().default(3),
    sreInvestigationUnits: integer("sre_investigation_units")
      .notNull()
      .default(5),
    aiCredits: integer("ai_credits").notNull().default(100),
    /** Set once the trial-end job has paused and archived the organization's resources. */
    lifecycleEndedAt: timestamp("lifecycle_ended_at", { withTimezone: true }),
    /** Set when the matching reminder email was sent, so each is sent at most once. */
    midwayNotifiedAt: timestamp("midway_notified_at", { withTimezone: true }),
    endingNotifiedAt: timestamp("ending_notified_at", { withTimezone: true }),
    endedNotifiedAt: timestamp("ended_notified_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "execution_entitlements_limits_check",
      sql`${table.runningCapacity} > 0 AND ${table.queuedCapacity} > 0 AND ${table.k6MaxVus} BETWEEN 1 AND 5 AND ${table.playwrightBudgetMs} > 0 AND ${table.playwrightUsedMs} >= 0`,
    ),
    check(
      "execution_entitlements_k6_budget_check",
      sql`${table.k6BudgetVuMs} > 0 AND ${table.k6UsedVuMs} >= 0`,
    ),
  ],
);

export const executionReservations = pgTable(
  "execution_reservations",
  {
    runId: text("run_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"playwright" | "k6">().notNull(),
    tier: text("tier").$type<"paid" | "trial">().notNull(),
    reservedMs: bigint("reserved_ms", { mode: "number" }).notNull(),
    usedMs: bigint("used_ms", { mode: "number" }).notNull().default(0),
    /** Virtual users of a limited load test, set once its workload is parsed; 0 for browser runs. */
    vus: integer("vus").notNull().default(0),
    ownerToken: uuid("owner_token").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    // Crash safety: a row whose lease lapsed no longer holds capacity.
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index("execution_reservations_finished_idx")
      .on(table.finishedAt)
      .where(sql`${table.finishedAt} IS NOT NULL`),
    index("execution_reservations_active_idx")
      .on(table.organizationId)
      .where(sql`${table.finishedAt} IS NULL`),
    check(
      "execution_reservations_values_check",
      sql`${table.kind} IN ('playwright', 'k6') AND ${table.tier} IN ('paid', 'trial') AND ${table.reservedMs} >= 0 AND ${table.usedMs} >= 0`,
    ),
  ],
);

export const executionTargetDomains = pgTable(
  "execution_target_domains",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    verificationToken: text("verification_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedUntil: timestamp("verified_until", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("execution_target_domains_org_host_key").on(
      table.organizationId,
      table.hostname,
    ),
  ],
);

export const trialSuspensions = pgTable(
  "trial_suspensions",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceType: text("resource_type")
      .$type<"monitor" | "status_page">()
      .notNull(),
    resourceId: uuid("resource_id").notNull(),
    previousStatus: text("previous_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("trial_suspensions_resource_key").on(
      table.resourceType,
      table.resourceId,
    ),
    index("trial_suspensions_org_idx").on(table.organizationId),
  ],
);
