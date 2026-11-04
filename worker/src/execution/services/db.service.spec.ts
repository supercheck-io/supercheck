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
