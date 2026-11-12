// Guard for the worker half of the deletion-visibility rule (twin of app/src/lib/deletion/visibility.spec.ts): a
// source file that queries monitors, jobs, runs or their link/child tables must import the helper, or sit in the
// allowlist with a reason. Limits: per-file granularity (one helper import satisfies the whole file), textual
// matching only (dynamic table names and raw SQL not written as `from|join <table>` are invisible), specs excluded.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';
import { jobs, monitors, runs } from './schema';
import { liveJob, liveMonitor, liveRunOfLiveJob } from './deletion-visibility';

describe('deletion visibility helpers', () => {
  const dialect = new PgDialect();
  const text = (query: Parameters<PgDialect['sqlToQuery']>[0]) =>
    dialect.sqlToQuery(query).sql;

  it('hide targets being deleted', () => {
    expect(text(liveMonitor())).toBe(text(isNull(monitors.deletingAt)));
    expect(text(liveJob())).toBe(text(isNull(jobs.deletingAt)));
    expect(text(liveRunOfLiveJob(runs.jobId))).toContain(
      'NOT IN (SELECT id FROM jobs WHERE deleting_at IS NOT NULL)',
    );
  });
});

const SRC = path.resolve(__dirname, '..');
const HELPER = 'db/deletion-visibility';
const ROOT_TABLES = 'monitors|jobs|runs|k6PerformanceRuns';
const CHILD_TABLES =
  'monitorTags|monitorNotificationSettings|jobNotificationSettings|jobTests|monitorResults|alertHistory';
const ALL_TABLES = `${ROOT_TABLES}|${CHILD_TABLES}`;
const SQL_TABLES =
  'monitors|jobs|runs|k6_performance_runs|monitor_tags|monitor_notification_settings|job_notification_settings|job_tests|monitor_results|alert_history';
const QUERIES = new RegExp(
  [
    `\\b(?:${ALL_TABLES})\\s+as\\s+\\w+\\b`,
    `(?:from|join)\\s*\\(\\s*(?:schema\\.)?(?:${ALL_TABLES})\\b`,
    `\\.(?:${ALL_TABLES})\\.find(?:First|Many)\\b`,
    `\\b(?:update|delete|insert)\\(\\s*(?:schema\\.)?(?:${ALL_TABLES})\\b`,
    `\\b(?:from|join)\\s+"?(?:${SQL_TABLES})\\b`,
  ].join('|'),
  'i',
);
// Relation keys of a relational `with: { ... }` load that reach monitors, jobs or runs.
const WITH_RELATION =
  /\bwith:\s*\{[^]{0,400}?\b(?:monitors?|jobs?|runs?|k6Runs?)\s*:/;
const DIRECT =
  /(?:isNull|isNotNull)\(\s*[\w.]+\.deletingAt\s*\)|\bdeleting_at\b/;

// Files that may query those tables without the helper, with why.
const UNFILTERED_OK: Record<string, string> = {
  'db/deletion-visibility.ts': 'defines the helpers',
  'execution/processors/playwright-execution.processor.ts':
    'run lifecycle writes by run and job id; a job being deleted is detected with isJobDeleting and its runs end as cancelled',
  'k6/processors/k6-execution.processor.ts':
    'run lifecycle writes by run and job id; a job being deleted is detected with isJobDeleting and its runs end as cancelled',
  'execution/services/run-callback.ts':
    'FOR KEY SHARE existence locks that order a result save against the purge deleting the row',
  'execution/services/stalled-job-handler.service.ts':
    'recovers stalled runs by run id; the cancellation marker written by the delete request is honoured',
  'monitor/dto/monitor-job.dto.ts': 'mentions the tables in comments only',
  'monitor/monitor.service.ts':
    'decides on the loaded row (monitor.deletingAt) before executing; status writes are by monitor id',
  'monitor/processors/monitor-dynamic-worker.service.ts':
    'reads saved results by monitor id for a cycle the control path already vetted',
  'monitor-control/monitor-cycle.service.ts':
    'decides on loaded rows (monitor.deletingAt) before closing or publishing a cycle',
};
// Files that may name the deleting_at column directly (everything else uses the helper).
const DIRECT_COLUMN_OK: Record<string, string> = {
  'db/deletion-visibility.ts': 'defines the helpers',
};

function sources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'schema' && entry.name !== 'migrations') walk(full);
      } else if (
        /\.ts$/.test(entry.name) &&
        !/\.(spec|test)\./.test(entry.name) &&
        !/pg-test-database/.test(entry.name)
      ) {
        out.push({
          rel: path.relative(SRC, full).split(path.sep).join('/'),
          text: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(SRC);
  return out;
}

describe('worker deletion visibility rule', () => {
  const files = sources();
  const bare = (f: { rel: string; text: string }) =>
    !f.text.includes(HELPER) && !(f.rel in UNFILTERED_OK);

  it('every query on monitors, jobs, runs or their child tables goes through the helpers', () => {
    expect(
      files.filter((f) => QUERIES.test(f.text) && bare(f)).map((f) => f.rel),
    ).toEqual([]);
  });

  it('no relational with: load reaches monitors, jobs or runs without the helper', () => {
    expect(
      files
        .filter((f) => WITH_RELATION.test(f.text) && bare(f))
        .map((f) => f.rel),
    ).toEqual([]);
  });

  it('nobody hand-rolls a deleting_at filter outside the helper', () => {
    expect(
      files
        .filter((f) => DIRECT.test(f.text) && !(f.rel in DIRECT_COLUMN_OK))
        .map((f) => f.rel),
    ).toEqual([]);
  });

  it('the scans recognise the patterns they guard', () => {
    expect(WITH_RELATION.test('x.findMany({ with: { job: true } })')).toBe(
      true,
    );
    expect(WITH_RELATION.test('x.findMany({ with: { user: true } })')).toBe(
      false,
    );
    expect(QUERIES.test('this.db.query.runs.findFirst({})')).toBe(true);
    expect(QUERIES.test('.from(schema.jobTests)')).toBe(true);
    expect(QUERIES.test('.from(schema.projects)')).toBe(false);
  });

  it('the allowlists have no stale entries', () => {
    const rels = new Set(files.map((f) => f.rel));
    expect(
      [...Object.keys(UNFILTERED_OK), ...Object.keys(DIRECT_COLUMN_OK)].filter(
        (rel) => !rels.has(rel),
      ),
    ).toEqual([]);
  });
});
