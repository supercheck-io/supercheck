import {
  ExecutionAdmissionService,
  ExecutionCapacityError,
  ExecutionEntitlementError,
  RESERVATION_LEASE_GRACE_MS,
} from './execution-admission.service';

/** Awaitable stand-in for a drizzle select builder. */
function rows<T>(result: T) {
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'for'])
    builder[method] = jest.fn(() => builder);
  builder.then = (
    resolve: (value: T) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

const FUTURE = () => new Date(Date.now() + 600_000);
const paidOrg = {
  id: 'org',
  customer: 'cus',
  plan: 'pro',
  status: 'active',
  endsAt: null,
};
const trialOrg = {
  id: 'org',
  customer: null,
  plan: null,
  status: null,
  endsAt: null,
};
const trial = (overrides: Record<string, unknown> = {}) => ({
  runningCapacity: 1,
  k6MaxVus: 3,
  playwrightBudgetMs: 100_000,
  playwrightUsedMs: 0,
  expiresAt: FUTURE(),
  ...overrides,
});

interface Scenario {
  org?: typeof paidOrg | typeof trialOrg;
  entitlement?: ReturnType<typeof trial>;
  limits?: { runningCapacity: number };
  active?: { count: number; reserved: number };
  existing?: {
    organizationId: string;
    finishedAt: Date | null;
    leaseExpiresAt: Date;
  };
}

function build(scenario: Scenario) {
  const tx = {
    select: jest
      .fn()
      .mockReturnValueOnce(rows(scenario.org ? [scenario.org] : []))
      .mockReturnValueOnce(
        rows([scenario.active ?? { count: 0, reserved: 0 }]),
      ),
    query: {
      executionEntitlements: {
        findFirst: jest.fn().mockResolvedValue(scenario.entitlement),
      },
      planLimits: { findFirst: jest.fn().mockResolvedValue(scenario.limits) },
      executionReservations: {
        findFirst: jest.fn().mockResolvedValue(scenario.existing),
      },
    },
    insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })),
    })),
  };
  const db = {
    transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };
  return { tx, service: new ExecutionAdmissionService(db as never) };
}

const original = process.env.SELF_HOSTED;
beforeEach(() => {
  process.env.SELF_HOSTED = 'false';
});
afterAll(() => {
  if (original === undefined)
    Reflect.deleteProperty(process.env, 'SELF_HOSTED');
  else process.env.SELF_HOSTED = original;
});

describe('reserve', () => {
  it('does not meter self-hosted deployments', async () => {
    process.env.SELF_HOSTED = 'true';
    const { service, tx } = build({});
    await expect(
      service.reserve('org', 'run', 'playwright', 5000),
    ).resolves.toBeUndefined();
    expect(tx.select).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 5000],
    ['org', 999],
    ['org', Number.NaN],
    ['org', 1.5],
  ])('refuses an invalid request (org=%s, ms=%s)', async (org, ms) => {
    const { service } = build({ org: paidOrg });
    await expect(service.reserve(org, 'run', 'playwright', ms)).rejects.toThrow(
      'entitlement is required',
    );
  });

  it('refuses an unknown organization', async () => {
    const { service } = build({});
    await expect(
      service.reserve('org', 'run', 'playwright', 5000),
    ).rejects.toThrow('entitlement is required');
  });

  it('admits a paid plan against plan capacity without a time allowance', async () => {
    const { service, tx } = build({
      org: paidOrg,
      limits: { runningCapacity: 2 },
      active: { count: 1, reserved: 0 },
    });
    const reservation = await service.reserve('org', 'run', 'playwright', 5000);
    expect(reservation).toMatchObject({
      organizationId: 'org',
      runId: 'run',
      reservedMs: 0,
      limited: false,
    });
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.query.executionEntitlements.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a paid plan whose limits cannot be loaded', async () => {
    const { service } = build({ org: paidOrg });
    await expect(
      service.reserve('org', 'run', 'playwright', 5000),
    ).rejects.toThrow('limits are unavailable');
  });

  it.each([
    ['missing', undefined],
    ['expired', trial({ expiresAt: new Date(Date.now() - 1) })],
  ])('refuses a %s trial entitlement', async (_label, entitlement) => {
    const { service, tx } = build({ org: trialOrg, entitlement });
    await expect(
      service.reserve('org', 'run', 'playwright', 5000),
    ).rejects.toThrow('expired or is unavailable');
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('rejects an invalid stored capacity', async () => {
    const { service } = build({
      org: trialOrg,
      entitlement: trial({ runningCapacity: 0 }),
    });
    await expect(
      service.reserve('org', 'run', 'playwright', 5000),
    ).rejects.toThrow('limits are unavailable');
  });

  it('signals a retryable capacity error while the organization slot is occupied', async () => {
    const { service, tx } = build({
      org: trialOrg,
      entitlement: trial(),
      active: { count: 1, reserved: 0 },
    });
    await expect(
      service.reserve('org', 'run', 'playwright', 5000),
    ).rejects.toBeInstanceOf(ExecutionCapacityError);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('caps a trial Playwright reservation to the remaining budget in whole seconds', async () => {
    const { service } = build({
      org: trialOrg,
      entitlement: trial({
        playwrightBudgetMs: 100_000,
        playwrightUsedMs: 20_500,
      }),
      active: { count: 0, reserved: 10_000 },
    });
    await expect(
      service.reserve('org', 'run', 'playwright', 300_000),
    ).resolves.toMatchObject({
      reservedMs: 69_000,
      limited: true,
      k6MaxVus: 3,
    });
  });

  it('caps a reservation to the remaining entitlement lifetime', async () => {
    const { service } = build({
      org: trialOrg,
      entitlement: trial({ expiresAt: new Date(Date.now() + 10_500) }),
    });
    const reservation = await service.reserve(
      'org',
      'run',
      'playwright',
      60_000,
    );
    expect(reservation?.reservedMs).toBeLessThanOrEqual(10_000);
    expect(reservation?.reservedMs).toBeGreaterThanOrEqual(9_000);
  });

  it('does not charge the Playwright budget for a k6 reservation', async () => {
    const { service } = build({
      org: trialOrg,
      entitlement: trial({ playwrightBudgetMs: 1, playwrightUsedMs: 0 }),
    });
    await expect(
      service.reserve('org', 'run', 'k6', 30_000),
    ).resolves.toMatchObject({ reservedMs: 30_000 });
  });

  it.each([1_000, 4_999])(
    'reports a remaining allowance of %sms as exhausted instead of an unrunnable reservation',
    async (remainingMs) => {
      const { service, tx } = build({
        org: trialOrg,
        entitlement: trial({
          playwrightBudgetMs: 100_000,
          playwrightUsedMs: 100_000 - remainingMs,
        }),
      });
      await expect(
        service.reserve('org', 'run', 'playwright', 60_000),
      ).rejects.toBeInstanceOf(ExecutionEntitlementError);
      expect(tx.insert).not.toHaveBeenCalled();
    },
  );

  it('still admits a run of exactly the executor minimum', async () => {
    const { service } = build({
      org: trialOrg,
      entitlement: trial({
        playwrightBudgetMs: 100_000,
        playwrightUsedMs: 95_000,
      }),
    });
    await expect(
      service.reserve('org', 'run', 'playwright', 60_000),
    ).resolves.toMatchObject({ reservedMs: 5_000 });
  });

  it('refuses when the allowance is exhausted', async () => {
    const { service, tx } = build({
      org: trialOrg,
      entitlement: trial({
        playwrightBudgetMs: 100_000,
        playwrightUsedMs: 99_500,
      }),
    });
    await expect(
      service.reserve('org', 'run', 'playwright', 5000),
    ).rejects.toThrow('allowance is exhausted');
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it.each([
    [
      'still owns a reservation',
      {
        organizationId: 'org',
        finishedAt: null,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    ],
    [
      'was finished by another organization',
      {
        organizationId: 'other',
        finishedAt: new Date(),
        leaseExpiresAt: new Date(0),
      },
    ],
  ])('refuses a run id that %s', async (_label, existing) => {
    const { service } = build({
      org: paidOrg,
      limits: { runningCapacity: 2 },
      existing,
    });
    await expect(
      service.reserve('org', 'run', 'playwright', 5000),
    ).rejects.toBeInstanceOf(ExecutionCapacityError);
  });

  it('lets a retry take over a reservation whose worker died and whose lease lapsed', async () => {
    const { service, tx } = build({
      org: paidOrg,
      limits: { runningCapacity: 2 },
      existing: {
        organizationId: 'org',
        finishedAt: null,
        leaseExpiresAt: new Date(Date.now() - 1),
      },
    });
    await expect(
      service.reserve('org', 'run', 'playwright', 5000),
    ).resolves.toMatchObject({ runId: 'run' });
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('leases each reservation for its timeout plus a crash-recovery grace period', async () => {
    const insertValues = jest.fn().mockResolvedValue(undefined);
    const { service, tx } = build({
      org: paidOrg,
      limits: { runningCapacity: 2 },
    });
    tx.insert.mockReturnValue({ values: insertValues });
    const before = Date.now();
    await service.reserve('org', 'run', 'playwright', 60_000);
    const { leaseExpiresAt } = insertValues.mock.calls[0][0] as {
      leaseExpiresAt: Date;
    };
    expect(leaseExpiresAt.getTime() - before).toBeGreaterThanOrEqual(
      60_000 + RESERVATION_LEASE_GRACE_MS,
    );
    expect(leaseExpiresAt.getTime() - before).toBeLessThan(
      60_000 + RESERVATION_LEASE_GRACE_MS + 5_000,
    );
  });

  it.each([
    ['unknown organization', {}],
    [
      'expired trial',
      { org: trialOrg, entitlement: trial({ expiresAt: new Date(0) }) },
    ],
    [
      'exhausted allowance',
      { org: trialOrg, entitlement: trial({ playwrightUsedMs: 100_000 }) },
    ],
    ['unavailable plan limits', { org: paidOrg }],
  ] as Array<[string, Scenario]>)(
    'raises a non-retryable entitlement error for %s',
    async (_label, scenario) => {
      const { service } = build(scenario);
      await expect(
        service.reserve('org', 'run', 'playwright', 5000),
      ).rejects.toBeInstanceOf(ExecutionEntitlementError);
    },
  );

  it('does not treat a capacity wait as an entitlement problem', async () => {
    const { service } = build({
      org: trialOrg,
      entitlement: trial(),
      active: { count: 1, reserved: 0 },
    });
    await expect(
      service.reserve('org', 'run', 'playwright', 5000),
    ).rejects.not.toBeInstanceOf(ExecutionEntitlementError);
  });

  it('reuses a finished reservation row for a retry of the same run', async () => {
    const { service, tx } = build({
      org: paidOrg,
      limits: { runningCapacity: 2 },
      existing: {
        organizationId: 'org',
        finishedAt: new Date(),
        leaseExpiresAt: new Date(0),
      },
    });
    await service.reserve('org', 'run', 'playwright', 5000);
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
  });
});

describe('finish', () => {
  function buildFinish(
    current: { reservedMs: number; kind: 'playwright' | 'k6' } | undefined,
  ) {
    const sets: unknown[] = [];
    const tx = {
      select: jest
        .fn()
        .mockReturnValueOnce(rows([{ id: 'org' }]))
        .mockReturnValueOnce(rows(current ? [current] : [])),
      update: jest.fn(() => ({
        set: jest.fn((values: unknown) => {
          sets.push(values);
          return { where: jest.fn().mockResolvedValue(undefined) };
        }),
      })),
    };
    const service = new ExecutionAdmissionService({
      transaction: async (callback: (tx: unknown) => unknown) => callback(tx),
    } as never);
    return { service, tx, sets };
  }
  const limited = {
    runId: 'run',
    organizationId: 'org',
    ownerToken: 'owner',
    reservedMs: 10_000,
    limited: true,
  };

  it('ignores a reservation that is gone or owned by another worker', async () => {
    const { service, tx } = buildFinish(undefined);
    await service.finish(limited, 5000);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('never charges a limited run more than it reserved and bills the Playwright budget', async () => {
    const { service, sets } = buildFinish({
      reservedMs: 10_000,
      kind: 'playwright',
    });
    await service.finish(limited, 50_000);
    expect(sets).toHaveLength(2);
    expect(sets[1]).toMatchObject({ usedMs: 10_000 });
  });

  it('does not touch the Playwright budget for k6 runs', async () => {
    const { service, sets } = buildFinish({ reservedMs: 10_000, kind: 'k6' });
    await service.finish(limited, 4_200.4);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ usedMs: 4_201 });
  });

  it('records full usage for unlimited paid runs without touching entitlements', async () => {
    const { service, sets } = buildFinish({
      reservedMs: 0,
      kind: 'playwright',
    });
    await service.finish({ ...limited, limited: false, reservedMs: 0 }, 75_000);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ usedMs: 75_000 });
  });

  it.each([Number.NaN, -5, Number.POSITIVE_INFINITY])(
    'treats unusable observed usage %s as zero',
    async (observed) => {
      const { service, sets } = buildFinish({ reservedMs: 10_000, kind: 'k6' });
      await service.finish(limited, observed);
      expect(sets[0]).toMatchObject({ usedMs: 0 });
    },
  );
});

describe('run', () => {
  it('keeps the completed result when releasing the reservation fails', async () => {
    const { service } = build({});
    const reservation = {
      runId: 'run',
      organizationId: 'org',
      ownerToken: 'owner',
      reservedMs: 0,
      limited: false,
    };
    jest.spyOn(service, 'reserve').mockResolvedValue(reservation);
    jest
      .spyOn(service, 'finish')
      .mockRejectedValue(new Error('database unavailable'));
    const logged = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    await expect(
      service.run('org', 'run', 'playwright', 5000, async () => ({
        billableMs: 1,
        ok: true,
      })),
    ).resolves.toMatchObject({ ok: true });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('run'));
  });

  it('surfaces the original failure when releasing the reservation also fails', async () => {
    const { service } = build({});
    const reservation = {
      runId: 'run',
      organizationId: 'org',
      ownerToken: 'owner',
      reservedMs: 0,
      limited: false,
    };
    jest.spyOn(service, 'reserve').mockResolvedValue(reservation);
    jest
      .spyOn(service, 'finish')
      .mockRejectedValue(new Error('database unavailable'));
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    await expect(
      service.run('org', 'run', 'playwright', 5000, async () => {
        throw new Error('execution failed');
      }),
    ).rejects.toThrow('execution failed');
  });

  it('skips bookkeeping when no reservation applies', async () => {
    process.env.SELF_HOSTED = 'true';
    const { service } = build({});
    const finish = jest.spyOn(service, 'finish');
    await expect(
      service.run('org', 'run', 'k6', 5000, async (reservation) => ({
        billableMs: 1,
        reservation,
      })),
    ).resolves.toMatchObject({ reservation: undefined });
    expect(finish).not.toHaveBeenCalled();
  });
});
