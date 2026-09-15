import { organization } from '../../db/schema/organization';
import { UsageTrackerService } from './usage-tracker.service';

describe('UsageTrackerService ledger settlement', () => {
  const originalSelfHosted = process.env.SELF_HOSTED;
  const originalToken = process.env.POLAR_ACCESS_TOKEN;
  afterEach(() => {
    if (originalSelfHosted === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = originalSelfHosted;
    if (originalToken === undefined) delete process.env.POLAR_ACCESS_TOKEN;
    else process.env.POLAR_ACCESS_TOKEN = originalToken;
  });

  function fixture(existing = false, failInsert = false) {
    process.env.SELF_HOSTED = 'false';
    process.env.POLAR_ACCESS_TOKEN = 'test-token';
    const periodStart = new Date('2026-09-01T00:00:00Z');
    const periodEnd = new Date('2026-10-01T00:00:00Z');
    const insertValues = jest.fn().mockReturnValue({
      returning: jest.fn().mockImplementation(async () => {
        if (failInsert) throw new Error('ledger unavailable');
        return [{ id: 'event-1' }];
      }),
    });
    const updateSet = jest
      .fn()
      .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    const tx = {
      select: jest.fn(() => ({
        from: () => ({
          where: () => ({
            for: async () => [
              {
                id: 'org-1',
                usagePeriodStart: periodStart,
                usagePeriodEnd: periodEnd,
              },
            ],
          }),
        }),
      })),
      query: {
        usageEvents: {
          findFirst: jest
            .fn()
            .mockResolvedValue(existing ? { id: 'event-1' } : null),
        },
      },
      update: jest.fn(() => ({ set: updateSet })),
      insert: jest.fn(() => ({ values: insertValues })),
    };
    const database = {
      transaction: jest.fn(
        async (callback: (value: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
      query: { organization: { findFirst: jest.fn().mockResolvedValue(null) } },
    };
    return {
      database,
      tx,
      insertValues,
      periodStart,
      periodEnd,
      service: new UsageTrackerService(database as never),
    };
  }

  it('reads fractional database counters as numbers without truncation', () => {
    expect(
      organization.playwrightMinutesUsed.mapFromDriverValue('3598.5600'),
    ).toBe(3598.56);
  });

  it('commits rounded usage and the matching billing-period ledger in one transaction', async () => {
    const f = fixture();
    await f.service.trackPlaywrightExecution('org-1', 61000, {
      runId: 'run-1',
    });
    expect(f.database.transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.update).toHaveBeenCalledTimes(1);
    expect(f.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        units: '1.0167',
        billingPeriodStart: f.periodStart,
        billingPeriodEnd: f.periodEnd,
        metadata: { runId: 'run-1' },
      }),
    );
  });

  it.each([
    [5000, '0.0833'],
    [60000, '1'],
    [0, '0'],
  ])(
    'records %i milliseconds without a whole-minute minimum',
    async (duration, units) => {
      const f = fixture();
      await f.service.trackMonitorExecution('org-1', duration, {
        runId: 'run-1',
      });
      expect(f.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ units }),
      );
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not record invalid duration %s',
    async (duration) => {
      const f = fixture();
      await f.service.trackPlaywrightExecution('org-1', duration);
      expect(f.database.transaction).not.toHaveBeenCalled();
    },
  );

  it('does not increment or insert again for an already recorded run', async () => {
    const f = fixture(true);
    await f.service.trackK6Execution('org-1', 10, 60000, { runId: 'run-1' });
    expect(f.tx.update).not.toHaveBeenCalled();
    expect(f.tx.insert).not.toHaveBeenCalled();
    expect(f.database.query.organization.findFirst).not.toHaveBeenCalled();
  });

  it('rejects the transaction on ledger failure without attempting Polar sync', async () => {
    const f = fixture(false, true);
    await f.service.trackPlaywrightExecution('org-1', 60000, {
      runId: 'run-1',
    });
    await expect(f.database.transaction.mock.results[0].value).rejects.toThrow(
      'ledger unavailable',
    );
    expect(f.database.query.organization.findFirst).not.toHaveBeenCalled();
  });

  it('syncs usage events to Polar with the pinned Polar-Version header', async () => {
    const f = fixture();
    f.database.query.organization.findFirst.mockResolvedValue({
      polarCustomerId: 'polar-cust-1',
    });
    const executeMock = jest.fn().mockResolvedValue([]);
    (f.database as any).execute = executeMock;

    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(''),
    });
    global.fetch = fetchMock as never;

    try {
      await f.service.trackPlaywrightExecution('org-1', 60000, {
        runId: 'run-polar-version',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/events/ingest'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Polar-Version': '2026-04',
          }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('UsageTrackerService execution blocking', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSelfHosted = process.env.SELF_HOSTED;
  const originalPolarAccessToken = process.env.POLAR_ACCESS_TOKEN;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSelfHosted === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = originalSelfHosted;
    if (originalPolarAccessToken === undefined) {
      delete process.env.POLAR_ACCESS_TOKEN;
    } else {
      process.env.POLAR_ACCESS_TOKEN = originalPolarAccessToken;
    }
  });

  it('fails closed when cloud production billing is not configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SELF_HOSTED;
    delete process.env.POLAR_ACCESS_TOKEN;
    const db = { execute: jest.fn() };
    const service = new UsageTrackerService(db as never);

    await expect(service.shouldBlockExecution('org-1')).resolves.toEqual({
      blocked: true,
      reason: 'Cloud billing enforcement is not configured',
    });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('keeps explicitly self-hosted deployments independent of Polar', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SELF_HOSTED = 'true';
    delete process.env.POLAR_ACCESS_TOKEN;
    const service = new UsageTrackerService({ execute: jest.fn() } as never);

    await expect(service.shouldBlockExecution('org-1')).resolves.toEqual({
      blocked: false,
    });
  });

  it('fails closed when a configured cloud billing check errors', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SELF_HOSTED;
    process.env.POLAR_ACCESS_TOKEN = 'configured-for-test';
    const service = new UsageTrackerService({
      execute: jest.fn().mockRejectedValue(new Error('database unavailable')),
    } as never);

    await expect(service.shouldBlockExecution('org-1')).resolves.toEqual({
      blocked: true,
      reason: 'Unable to verify the organization spending limit',
    });
  });
});
