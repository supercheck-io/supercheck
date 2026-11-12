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
      'IS NULL OR NOT EXISTS',
    );
  });
});
