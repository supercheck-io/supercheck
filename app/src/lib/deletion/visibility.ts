/**
 * Single source of truth for hiding targets that are being deleted (jobs.deleting_at / monitors.deleting_at).
 *
 * Every read, count, aggregate, list and by-id load of monitors, jobs or runs goes through these predicates, so a
 * deleting target reads exactly like one that does not exist (404, not counted, not acted on). Only the purge and
 * admin code that must see deleting rows may query the columns directly (see visibility.spec.ts allowlist).
 * Organizations pending deletion and soft-deleted projects are read-only, not hidden: reads stay allowed, writes are
 * refused in the permission layer (rbac/permissions.ts) and by the org-state helpers; the SQL predicate below keeps
 * schedulers and sweeps from admitting new work for a pending organization.
 * Run predicates use an uncorrelated `NOT IN` over the few deleting jobs, so Postgres hashes it once (jobs_deleting_idx, migration 0076).
 */
import { isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { jobs, monitors } from "@/db/schema";

// Raw SQL aliases (e.g. "j" in a hand-written join) must be plain identifiers.
const aliased = (alias: string): SQL => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Invalid table alias: ${alias}`);
  return sql.raw(`${alias}.deleting_at IS NULL`);
};

/** The monitor is not being deleted. Pass an aliased table, or the alias name used in raw SQL, when the query does not use `monitors` itself. */
export const liveMonitor = (table: { deletingAt: AnyColumn } | string = monitors): SQL =>
  typeof table === "string" ? aliased(table) : isNull(table.deletingAt);

/** The job is not being deleted. Same alias rules as liveMonitor. */
export const liveJob = (table: { deletingAt: AnyColumn } | string = jobs): SQL =>
  typeof table === "string" ? aliased(table) : isNull(table.deletingAt);

/**
 * The run's parent job is not being deleted. A run without a job (playground, single-test) stays visible, so this
 * works on `runs.jobId` and `k6PerformanceRuns.jobId` without joining jobs.
 */
export const liveRunOfLiveJob = (jobId: AnyColumn): SQL =>
  sql`(${jobId} IS NULL OR ${jobId} NOT IN (SELECT id FROM jobs WHERE deleting_at IS NOT NULL))`;

/** SQL predicate for scheduler and sweep queries: the organization behind this column is not pending deletion. */
export const notInPendingOrganization = (organizationIdColumn: unknown): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM organization pend WHERE pend.id = ${organizationIdColumn} AND pend.deletion_requested_at IS NOT NULL)`;

/** By-id guard for a row already loaded: the row, or null when it is being deleted (callers answer not found). */
export function notFoundIfDeleting<T extends { deletingAt?: Date | null }>(row: T | null | undefined): T | null {
  return row && !row.deletingAt ? row : null;
}

