/** @jest-environment node */
// Guard for the single deletion-visibility rule (see visibility.ts): a query on monitors, jobs or runs must go through
// the helpers, so a target being deleted reads as missing everywhere. Fails when a new file queries those tables, or
// their link/child tables (tags, notification settings, job tests, results, alert history), or loads them through a
// relational `with:`, without importing the helper, or hand-rolls a deleting_at filter. Add to the allowlist only with
// a reason. The worker has its own twin of this guard (worker/src/db/deletion-visibility.spec.ts).
//
// Limits (a source scan, not a proof):
//  - Granularity is per file: importing the helper once satisfies the file, even if another query in it forgets it.
//    Review new queries in an already-importing file by hand; the DB specs (read-paths.db.spec.ts) cover the routes.
//  - It is textual: a table reached through a variable, a dynamic table name, or raw SQL not written as
//    `from|join <table>` is invisible to it. Only app/, actions/, lib/ and sre/ are scanned, never specs.
//  - A child-table query may be legitimately unfiltered (it is scoped by an already-resolved parent id); those files
//    sit in the allowlist with the reason.
import fs from "node:fs";
import path from "node:path";
import { and, isNull } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { jobs, monitors, runs } from "@/db/schema";
import { liveJob, liveMonitor, liveRunOfLiveJob, notFoundIfDeleting } from "./visibility";

const SRC = path.resolve(__dirname, "../..");
const ROOTS = ["app", "actions", "lib", "sre"];
const HELPER = "lib/deletion/visibility";

// Files that may query the tables without the helper, with why.
const UNFILTERED_OK: Record<string, string> = {
  "lib/deletion/visibility.ts": "defines the helpers",
  "lib/deletion/purge.ts": "purge must see deleting rows",
  "lib/deletion/request.ts": "sets and reads the flag itself",
  "lib/deletion/jobs.ts": "sweeper finds deleting rows by design",
  "lib/admin.ts": "super-admin diagnostics read every row",
  "lib/organization-teardown.ts": "removes whole organizations",
  "lib/resource-deletion/linked-records.ts": "deletion cleanup of rows that point at a target",
  "lib/resource-deletion/run.ts": "deletes runs",
  "lib/data-lifecycle-service.ts": "retention cleanup and system-wide storage stats",
  "lib/security/disable-trigger-keys.ts": "organization-level key shutdown",
  "lib/job-status-sync.ts": "recomputes a job's own status from its runs",
  "lib/monitor-write.ts": "locks and mirrors rows of a monitor its caller already resolved through the helper",
  "lib/capacity-manager.ts": "run lifecycle writes by run id; the purge cancels runs of a deleting job",
  "lib/monitor-schedule-reconcile.ts": "decides on loaded rows (row.deletingAt) and only clears stale scheduler ids",
  "lib/scheduler/job-scheduler.ts": "worker-side check of the loaded record (deletingAt) before scheduling",
  "lib/scheduler/monitor-scheduler.ts": "worker-side check of the loaded record (deletingAt) before scheduling",
  "sre/agents/investigator.ts": "mentions the word in a comment only",
  "app/api/admin/users/[id]/route.ts": "clears createdByUserId of a deleted user on every row",
  "app/api/test/route.ts": "playground runs have no job",
  "app/api/tests/[id]/execute/route.ts": "playground runs have no job",
  "actions/create-job.ts": "inserts and updates the job it is creating",
  "app/api/notification-providers/route.ts": "last-used date of a channel from alert_history; reads no monitor or job",
  "lib/job-execution-utils.ts": "loads the tests of a job its caller already resolved through the helper",
  "lib/monitor-cycles.ts": "cycle bookkeeping by cycle id; reads no monitor",
  "lib/monitor-result-filters.ts": "SQL predicate over monitor_results columns; runs no query",
  "lib/sre/incident-lifecycle.ts": "alert_history lookup by an open incident's own source id",
  "lib/sre/incident-notifier.ts": "alert_history and channel links by an incident's own source id; the deletion request removes the links",
};
// Files that may name the deleting_at column directly (everything else uses the helpers).
const DIRECT_COLUMN_OK = new Set([
  "lib/deletion/visibility.ts",
  "lib/deletion/request.ts",
  "lib/deletion/jobs.ts",
  "lib/deletion/purge.ts",
  "lib/monitor-scheduler.ts", // isNotNull(): looks for a flagged monitor to refuse scheduling
  "lib/job-scheduler.ts",
  "lib/monitor-schedule-reconcile.ts",
  "lib/scheduler/job-scheduler.ts",
  "lib/scheduler/monitor-scheduler.ts",
]);

// Roots (monitors, jobs, runs) plus the link and child tables that hang off them: a query on those must also hide a
// deleting parent, or use the helper, or sit in the allowlist with a reason.
const ROOT_TABLES = "monitors|jobs|runs|k6PerformanceRuns";
const CHILD_TABLES = "monitorTags|monitorNotificationSettings|jobNotificationSettings|jobTests|monitorResults|alertHistory";
const ALL_TABLES = `${ROOT_TABLES}|${CHILD_TABLES}`;
const SQL_TABLES = "monitors|jobs|runs|k6_performance_runs|monitor_tags|monitor_notification_settings|job_notification_settings|job_tests|monitor_results|alert_history";
const QUERIES = new RegExp(
  [
    `\\b(?:${ALL_TABLES})\\s+as\\s+\\w+\\b`,
    `(?:from|join)\\s*\\(\\s*(?:schema\\.)?(?:${ALL_TABLES})\\b`,
    `\\.(?:${ALL_TABLES})\\.find(?:First|Many)\\b`,
    `\\b(?:update|delete|insert)\\(\\s*(?:schema\\.)?(?:${ROOT_TABLES}|${CHILD_TABLES})\\b`,
    `\\b(?:from|join)\\s+"?(?:${SQL_TABLES})\\b`,
  ].join("|"),
  "i",
);
// Names a relation that reaches monitors, jobs or runs, in a relational `with: { ... }` load from any table.
const WITH_RELATION = /^\s*(?:monitors?|jobs?|runs?|k6Runs?|k6PerformanceRuns?)\s*:/;
const DIRECT = /isNull\(\w+\.deletingAt\)|isNotNull\(\w+\.deletingAt\)|\bdeleting_at\b/;

/** Bodies of every `with: { ... }` block (balanced braces), so a nested relation key can be checked. */
export function withBlocks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bwith:\s*\{/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i++) depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0;
    out.push(text.slice(start, i - 1));
  }
  return out;
}
/** True when a `with:` block (or one nested in it) names a monitor, job or run relation. */
export function loadsDeletableRelation(text: string): boolean {
  return withBlocks(text).some((body) => {
    // top-level keys of this block, then recurse into nested `with:` blocks
    let depth = 0;
    let key = "";
    for (const ch of body) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (depth === 0) key += ch;
      if (depth === 0 && ch === ",") {
        if (WITH_RELATION.test(key)) return true;
        key = "";
      }
    }
    return WITH_RELATION.test(key);
  });
}

function sources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name)) {
        out.push({ rel: path.relative(SRC, full).split(path.sep).join("/"), text: fs.readFileSync(full, "utf8") });
      }
    }
  };
  for (const root of ROOTS) walk(path.join(SRC, root));
  return out;
}

describe("deletion visibility rule", () => {
  const files = sources();

  it("every query on monitors, jobs or runs goes through the visibility helpers", () => {
    const offenders = files.filter((f) => QUERIES.test(f.text) && !f.text.includes(HELPER) && !(f.rel in UNFILTERED_OK)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("no relational `with:` load reaches monitors, jobs or runs without the helper", () => {
    const offenders = files.filter((f) => loadsDeletableRelation(f.text) && !f.text.includes(HELPER) && !(f.rel in UNFILTERED_OK)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the nested-load scan sees relation keys at any depth and ignores unrelated ones", () => {
    expect(loadsDeletableRelation("db.query.runs.findMany({ with: { job: true } })")).toBe(true);
    expect(loadsDeletableRelation("x.findMany({ with: { tags: { with: { monitors: { columns: { id: true } } } } } })")).toBe(true);
    expect(loadsDeletableRelation("x.findMany({ with: { tags: true, user: { columns: { id: true } } } })")).toBe(false);
    expect(loadsDeletableRelation("x.findMany({ columns: { job: true } })")).toBe(false);
  });

  it("nobody hand-rolls a deleting_at filter outside the helper and the deletion code", () => {
    const offenders = files.filter((f) => DIRECT.test(f.text) && !DIRECT_COLUMN_OK.has(f.rel)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const rels = new Set(files.map((f) => f.rel));
    expect(Object.keys(UNFILTERED_OK).filter((rel) => !rels.has(rel))).toEqual([]);
  });
});

describe("visibility helpers", () => {
  const dialect = new PgDialect();
  const sqlOf = (query: Parameters<typeof dialect.sqlToQuery>[0]) => dialect.sqlToQuery(query).sql;

  it("render index-friendly predicates", () => {
    expect(sqlOf(liveMonitor())).toBe(sqlOf(isNull(monitors.deletingAt)));
    expect(sqlOf(liveJob())).toBe(sqlOf(isNull(jobs.deletingAt)));
    expect(sqlOf(and(liveRunOfLiveJob(runs.jobId))!)).toContain("NOT IN (SELECT id FROM jobs WHERE deleting_at IS NOT NULL)");
  });

  it("accept a raw SQL alias and reject anything that is not an identifier", () => {
    expect(sqlOf(liveJob("j"))).toBe("j.deleting_at IS NULL");
    expect(sqlOf(liveMonitor("m"))).toBe("m.deleting_at IS NULL");
    expect(() => liveJob("j; drop table jobs")).toThrow("Invalid table alias");
  });

  it("notFoundIfDeleting hides a flagged row and keeps the rest", () => {
    const live = { id: "a", deletingAt: null };
    expect(notFoundIfDeleting(live)).toBe(live);
    expect(notFoundIfDeleting({ id: "b", deletingAt: new Date() })).toBeNull();
    expect(notFoundIfDeleting(undefined)).toBeNull();
  });
});
