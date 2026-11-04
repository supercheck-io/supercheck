import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { DbService } from './db.service';

describe('run status updates', () => {
  it('only lets an active run receive a late terminal result', async () => {
    const where = jest.fn(async (_condition: SQL) => undefined);
    const database = { update: () => ({ set: () => ({ where }) }) };
    const service = new DbService(database as never, {} as never);
    await service.updateRunStatus('run-id', 'passed', '1s');
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql).toContain('"runs"."status" in');
    expect(query.params).toEqual(['run-id', 'queued', 'running']);
  });
});

describe('updateJobStatus', () => {
  const capture = async (runId?: string) => {
    const where = jest.fn(async (_condition: SQL) => undefined);
    const database = { update: () => ({ set: () => ({ where }) }) };
    const service = new DbService(database as never, {} as never);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    await service.updateJobStatus('job-id', ['failed'], runId);
    return new PgDialect().sqlToQuery(where.mock.calls[0][0]);
  };

  it('only writes when the finishing run is the job newest run', async () => {
    const query = await capture('run-id');
    expect(query.sql).toContain('order by "runs"."created_at" desc limit 1');
    expect(query.params).toEqual(['job-id', 'run-id', 'job-id']);
  });

  it('writes unconditionally without a finishing run id', async () => {
    const query = await capture();
    expect(query.sql).not.toContain('order by');
  });
});

describe('getJobAlertStreakState', () => {
  it('flags unknown history when the alert history cannot be read', async () => {
    const database = {
      select: () => {
        throw new Error('db down');
      },
    };
    const service = new DbService(database as never, {} as never);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    expect(await service.getJobAlertStreakState('job-id')).toEqual({
      sent: 0,
      lastSentAt: null,
      unknown: true,
    });
  });
});
