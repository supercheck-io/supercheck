import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { DbService, isTransientDbError } from './db.service';

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

describe('storeReportMetadata', () => {
  const metadata = {
    entityId: 'test-id',
    entityType: 'test',
    reportPath: 'test-id/report',
    status: 'passed',
    s3Url: 's3://bucket/test-id',
  } as const;
  const transient = () =>
    Object.assign(new Error('Failed query'), {
      cause: Object.assign(new Error('could not serialize access'), {
        code: '40001',
      }),
    });

  function setup(failures: Error[]) {
    const values = jest.fn(() => ({
      onConflictDoUpdate: async () => undefined,
    }));
    const tx = { insert: () => ({ values }) };
    const transaction = jest.fn(async (fn: (t: typeof tx) => Promise<void>) => {
      const failure = failures.shift();
      if (failure) throw failure;
      await fn(tx);
    });
    const service = new DbService({ transaction } as never, {} as never);
    const error = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    return { service, transaction, values, error };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retries a transient failure and persists the passed status once', async () => {
    const { service, transaction, values, error } = setup([transient()]);
    const done = service.storeReportMetadata(metadata);
    await jest.advanceTimersByTimeAsync(200);
    await expect(done).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'test-id', status: 'passed' }),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('stops after 3 attempts, logs an error and does not throw', async () => {
    const { service, transaction, values, error } = setup([
      transient(),
      transient(),
      transient(),
    ]);
    const done = service.storeReportMetadata(metadata);
    await jest.advanceTimersByTimeAsync(200 + 400);
    await expect(done).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(values).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('test/test-id after 3 attempt(s)'),
      expect.anything(),
    );
  });

  it('does not retry a non-transient error', async () => {
    const { service, transaction, error } = setup([
      Object.assign(new Error('null value'), { code: '23502' }),
    ]);
    await expect(
      service.storeReportMetadata(metadata),
    ).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('after 1 attempt(s)'),
      expect.anything(),
    );
  });

  it('classifies connection errors as transient', () => {
    expect(isTransientDbError({ code: 'CONNECTION_CLOSED' })).toBe(true);
    expect(isTransientDbError({ code: '08006' })).toBe(true);
    expect(isTransientDbError(new Error('boom'))).toBe(false);
  });
});
