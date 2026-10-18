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
