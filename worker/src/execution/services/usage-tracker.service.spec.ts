import { Logger } from '@nestjs/common';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
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
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const insertValues = jest.fn().mockReturnValue({
      returning: jest.fn().mockImplementation(async () => {
        if (failInsert) throw new Error('ledger unavailable');
        return [{ id: 'event-1', billingPeriodEnd: periodEnd }];
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
      execute: jest.fn().mockResolvedValue([]),
      transaction: jest.fn(
        async (callback: (value: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
      query: {
        organization: { findFirst: jest.fn().mockResolvedValue(null) },
        executionUsageReceipts: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      },
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

  it.each([
    [-1, -60000],
    [-1, 60000],
    [1, -60000],
    [Number.NaN, 60000],
    [1, Number.POSITIVE_INFINITY],
  ])('rejects invalid K6 inputs (%s VUs, %s ms)', async (vus, duration) => {
    const f = fixture();
    await f.service.trackK6Execution('org-1', vus, duration, {
      runId: 'run-1',
    });
    expect(f.database.transaction).not.toHaveBeenCalled();
  });

  it.each(['true', '1'])(
    'does not create billable events in SELF_HOSTED=%s',
    async (mode) => {
      const f = fixture();
      process.env.SELF_HOSTED = mode;
      await f.service.trackPlaywrightExecution('org-1', 60000, {
        runId: 'run-1',
      });
      expect(f.tx.update).toHaveBeenCalledTimes(1);
      expect(f.tx.insert).not.toHaveBeenCalled();
      expect(f.database.query.organization.findFirst).not.toHaveBeenCalled();
    },
  );

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

  it.each([
    [{ inserted: 1, duplicates: 0 }, true],
    [{ inserted: 0, duplicates: 1 }, true],
    [{ inserted: 1 }, true],
    [null, false],
    ['ok', false],
    [true, false],
    [[], false],
    [Object.assign([], { inserted: 1, duplicates: 0 }), false],
    [{ inserted: 0.5, duplicates: 0.5 }, false],
    [{ inserted: -1, duplicates: 2 }, false],
    [{ inserted: '1' }, false],
    [{ inserted: 0, duplicates: 0 }, false],
    [{ inserted: 1, duplicates: -1 }, false],
  ])(
    'settles Polar acknowledgement %j (accepted: %s) with the pinned header',
    async (acknowledgement, accepted) => {
      const f = fixture();
      f.database.query.organization.findFirst.mockResolvedValue({
        polarCustomerId: 'polar-cust-1',
      });
      const settled = new Promise<string>((resolve) => {
        f.database.execute.mockImplementation(async (query: SQL) => {
          resolve(new PgDialect().sqlToQuery(query).sql);
          return [];
        });
      });

      const originalFetch = global.fetch;
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(''),
        json: jest.fn().mockResolvedValue(acknowledgement),
      });
      global.fetch = fetchMock as never;

      try {
        await f.service.trackPlaywrightExecution('org-1', 60000, {
          runId: 'run-polar-version',
        });
        const settlementSql = await settled;
        if (accepted) {
          expect(settlementSql).toContain('SET synced_to_polar = true');
        } else {
          expect(settlementSql).toContain(
            'SET sync_attempts = sync_attempts + 1',
          );
          expect(settlementSql).not.toContain('synced_to_polar = true');
        }

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
    },
  );
});

describe('UsageTrackerService execution blocking', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSelfHosted = process.env.SELF_HOSTED;
  const originalPolarAccessToken = process.env.POLAR_ACCESS_TOKEN;

  function admissionFixture() {
    process.env.SELF_HOSTED = 'false';
    process.env.POLAR_ACCESS_TOKEN = 'test-token';
    const org = {
      polarCustomerId: 'customer-1',
      subscriptionPlan: 'plus',
      subscriptionStatus: 'active',
      subscriptionEndsAt: new Date(Date.now() + 60_000),
      playwrightMinutesUsed: 3000,
      k6VuMinutesUsed: 20000,
      sreInvestigationUnitsUsed: '27',
    };
    const query = {
      organization: { findFirst: jest.fn().mockResolvedValue(org) },
      billingSettings: {
        findFirst: jest.fn().mockResolvedValue({
          enableSpendingLimit: true,
          hardStopOnLimit: true,
          monthlySpendingLimitCents: 100,
        }),
      },
      planLimits: {
        findFirst: jest.fn().mockResolvedValue({
          playwrightMinutesIncluded: 3000,
          k6VuMinutesIncluded: 20000,
          sreInvestigationUnitsIncluded: '25',
        }),
      },
      overagePricing: {
        findFirst: jest.fn().mockResolvedValue({
          playwrightMinutePriceCents: 3,
          k6VuMinutePriceCents: 1,
          sreInvestigationUnitPriceCents: 50,
        }),
      },
    };
    return { org, query, service: new UsageTrackerService({ query } as never) };
  }

  it('includes SRE investigation overage in the execution spending cap', async () => {
    const f = admissionFixture();
    await expect(
      f.service.shouldBlockExecution('org-1'),
    ).resolves.toMatchObject({
      blocked: true,
      reason: expect.stringContaining('Current spending: $1.00'),
    });
    f.org.sreInvestigationUnitsUsed = '26';
    await expect(f.service.shouldBlockExecution('org-1')).resolves.toEqual({
      blocked: false,
    });
  });

  it.each([
    [null, true],
    [0.25, false],
    [0.5, true],
    [0, false],
  ])(
    'uses K6 override %s consistently for spending admission',
    async (override, blocked) => {
      const f = admissionFixture();
      f.org.k6VuMinutesUsed = 20199;
      f.org.sreInvestigationUnitsUsed = '25';
      f.query.overagePricing.findFirst.mockResolvedValue({
        playwrightMinutePriceCents: 3,
        k6VuMinutePriceCents: 1,
        k6VuMinutePriceCentsOverride: override,
        sreInvestigationUnitPriceCents: 50,
      });
      await expect(
        f.service.shouldBlockExecution('org-1'),
      ).resolves.toMatchObject({ blocked });
    },
  );

  it('does not falsely block a custom rate at an exact-cent boundary', async () => {
    const f = admissionFixture();
    f.org.k6VuMinutesUsed = 20400;
    f.org.sreInvestigationUnitsUsed = '25';
    f.query.billingSettings.findFirst.mockResolvedValue({
      enableSpendingLimit: true,
      hardStopOnLimit: true,
      monthlySpendingLimitCents: 8,
    });
    f.query.overagePricing.findFirst.mockResolvedValue({
      playwrightMinutePriceCents: 3,
      k6VuMinutePriceCents: 1,
      k6VuMinutePriceCentsOverride: 0.0175,
      sreInvestigationUnitPriceCents: 50,
    });
    await expect(f.service.shouldBlockExecution('org-1')).resolves.toEqual({
      blocked: false,
    });
  });

  it('rate-limits migration warnings without caching admission pricing', async () => {
    const f = admissionFixture();
    f.org.sreInvestigationUnitsUsed = '25';
    const missing = Object.assign(
      new Error('column k6_vu_minute_price_cents_override does not exist'),
      { code: '42703' },
    );
    f.query.overagePricing.findFirst.mockImplementation(({ columns }) =>
      columns
        ? Promise.resolve({
            playwrightMinutePriceCents: 3,
            k6VuMinutePriceCents: 1,
            sreInvestigationUnitPriceCents: 50,
          })
        : Promise.reject(missing),
    );
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      await f.service.shouldBlockExecution('org-1');
      await f.service.shouldBlockExecution('org-1');
      expect(warning).toHaveBeenCalledTimes(1);
      expect(f.query.overagePricing.findFirst).toHaveBeenCalledTimes(4);
    } finally {
      warning.mockRestore();
    }
  });

  it.each(['none', 'canceled'])(
    'rejects queued work after a subscription becomes %s',
    async (status) => {
      const f = admissionFixture();
      f.org.subscriptionStatus = status;
      f.org.subscriptionEndsAt = new Date(Date.now() - 1);
      await expect(
        f.service.shouldBlockExecution('org-1'),
      ).resolves.toMatchObject({
        blocked: true,
        reason: 'An active subscription is required',
      });
      expect(f.query.billingSettings.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'uses legacy pricing before migration 0025 (wrapped=%s)',
    async (wrapped) => {
      const f = admissionFixture();
      f.org.sreInvestigationUnitsUsed = '25';
      const missing = Object.assign(
        new Error('column "k6_vu_minute_price_cents_override" does not exist'),
        { code: '42703' },
      );
      const error = wrapped
        ? Object.assign(new Error('Failed query'), { cause: missing })
        : missing;
      f.query.overagePricing.findFirst.mockRejectedValueOnce(error);
      await expect(f.service.shouldBlockExecution('org-1')).resolves.toEqual({
        blocked: false,
      });
      expect(f.query.overagePricing.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          columns: { k6VuMinutePriceCentsOverride: false },
        }),
      );
      // The bridge does not cache the legacy rate after migration finishes.
      f.org.k6VuMinutesUsed = 20199;
      f.query.overagePricing.findFirst.mockResolvedValue({
        playwrightMinutePriceCents: 3,
        k6VuMinutePriceCents: 1,
        k6VuMinutePriceCentsOverride: 0.25,
        sreInvestigationUnitPriceCents: 50,
      });
      await expect(f.service.shouldBlockExecution('org-1')).resolves.toEqual({
        blocked: false,
      });
      expect(f.query.overagePricing.findFirst).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ columns: expect.anything() }),
      );
    },
  );

  it.each([
    Object.assign(new Error('column "other_column" does not exist'), {
      code: '42703',
    }),
    Object.assign(new Error('k6_vu_minute_price_cents_override timeout'), {
      code: '57014',
    }),
  ])('does not bypass admission on unrelated DB errors', async (error) => {
    const f = admissionFixture();
    f.query.overagePricing.findFirst.mockRejectedValue(error);
    await expect(
      f.service.shouldBlockExecution('org-1'),
    ).resolves.toMatchObject({
      blocked: true,
      reason: 'Unable to verify the organization spending limit',
    });
    expect(f.query.overagePricing.findFirst).toHaveBeenCalledTimes(1);
  });

  it.each(['past_due', 'canceled'])(
    'preserves authorized %s grace access',
    async (status) => {
      const f = admissionFixture();
      f.org.subscriptionStatus = status;
      f.org.sreInvestigationUnitsUsed = '25';
      await expect(f.service.shouldBlockExecution('org-1')).resolves.toEqual({
        blocked: false,
      });
    },
  );

  it('keeps non-metered probes running at the cap but enforces their subscription', async () => {
    const f = admissionFixture();
    await expect(
      f.service.shouldBlockExecution('org-1', { checkSpendingLimit: false }),
    ).resolves.toEqual({ blocked: false });
    f.org.subscriptionStatus = 'none';
    await expect(
      f.service.shouldBlockExecution('org-1', { checkSpendingLimit: false }),
    ).resolves.toMatchObject({ blocked: true });
  });

  it('denies execution when an enabled cap cannot be calculated', async () => {
    const f = admissionFixture();
    f.query.overagePricing.findFirst.mockResolvedValue(null);
    await expect(
      f.service.shouldBlockExecution('org-1'),
    ).resolves.toMatchObject({
      blocked: true,
      reason: 'Unable to verify the organization spending limit',
    });
  });

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

  it.each(['true', '1'])(
    'keeps SELF_HOSTED=%s independent of Polar',
    async (mode) => {
      process.env.NODE_ENV = 'production';
      process.env.SELF_HOSTED = mode;
      delete process.env.POLAR_ACCESS_TOKEN;
      const service = new UsageTrackerService({ execute: jest.fn() } as never);

      await expect(service.shouldBlockExecution('org-1')).resolves.toEqual({
        blocked: false,
      });
    },
  );

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
