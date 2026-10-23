import {
  ExecutionAdmissionService,
  ExecutionCapacityError,
  ExecutionEntitlementError,
  RESERVATION_LEASE_TTL_MS,
  RESERVATION_RENEW_INTERVAL_MS,
  RESERVATION_RETENTION_MS,
} from './execution-admission.service';

/** Awaitable stand-in for a drizzle select builder. */
function rows<T>(result: T) {
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'for', 'limit'])
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
  lapsed?: Array<Record<string, unknown>>;
  stale?: Array<{ runId: string }>;
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
      // Reservations whose owner stopped renewing are settled before capacity is counted.
      .mockReturnValueOnce(rows(scenario.lapsed ?? []))
      .mockReturnValueOnce(rows([scenario.active ?? { count: 0, reserved: 0 }]))
      // Pruning of finished reservations runs after a successful admission.
      .mockReturnValue(rows(scenario.stale ?? [])),
    delete: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })),
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

  it('leases each reservation for one renewable TTL, independent of the run timeout', async () => {
    const insertValues = jest.fn().mockResolvedValue(undefined);
    const { service, tx } = build({
      org: paidOrg,
      limits: { runningCapacity: 2 },
    });
    tx.insert.mockReturnValue({ values: insertValues });
    const before = Date.now();
    await service.reserve('org', 'run', 'playwright', 60 * 60_000);
    const { leaseExpiresAt } = insertValues.mock.calls[0][0] as {
      leaseExpiresAt: Date;
    };
    expect(leaseExpiresAt.getTime() - before).toBeGreaterThanOrEqual(
      RESERVATION_LEASE_TTL_MS,
    );
    expect(leaseExpiresAt.getTime() - before).toBeLessThan(
      RESERVATION_LEASE_TTL_MS + 5_000,
    );
  });

  it('prunes finished reservations past retention in a bounded batch', async () => {
    const { service, tx } = build({
      org: paidOrg,
      limits: { runningCapacity: 2 },
      stale: [{ runId: 'old-1' }, { runId: 'old-2' }],
    });
    await service.reserve('org', 'run', 'playwright', 5000);
    expect(tx.delete).toHaveBeenCalledTimes(1);
  });

  it('does not delete anything when no finished reservation is past retention', async () => {
    const { service, tx } = build({
      org: paidOrg,
      limits: { runningCapacity: 2 },
    });
    await service.reserve('org', 'run', 'playwright', 5000);
    expect(tx.delete).not.toHaveBeenCalled();
    expect(RESERVATION_RETENTION_MS).toBeGreaterThan(24 * 60 * 60_000);
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

describe('lease renewal', () => {
  const reservation = {
    runId: 'run',
    organizationId: 'org',
    ownerToken: 'owner',
    reservedMs: 0,
    limited: false,
  };

  function buildRenewal(rowsReturned: Array<{ runId: string }>) {
    const returning = jest.fn().mockResolvedValue(rowsReturned);
    const set = jest.fn(() => ({ where: jest.fn(() => ({ returning })) }));
    const db = { update: jest.fn(() => ({ set })) };
    return { service: new ExecutionAdmissionService(db as never), set };
  }

  it("extends only the owner token's live reservation by one TTL", async () => {
    const { service, set } = buildRenewal([{ runId: 'run' }]);
    const before = Date.now();
    await expect(service.renew(reservation)).resolves.toBe(true);
    const { leaseExpiresAt } = (set.mock.calls[0] as unknown[])[0] as {
      leaseExpiresAt: Date;
    };
    expect(leaseExpiresAt.getTime() - before).toBeGreaterThanOrEqual(
      RESERVATION_LEASE_TTL_MS,
    );
  });

  it('reports that ownership was lost when the reservation was taken over', async () => {
    const { service } = buildRenewal([]);
    await expect(service.renew(reservation)).resolves.toBe(false);
  });

  describe('while a run executes', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('renews on an interval and stops when the run ends', async () => {
      const { service } = buildRenewal([{ runId: 'run' }]);
      jest.spyOn(service, 'reserve').mockResolvedValue(reservation);
      jest.spyOn(service, 'finish').mockResolvedValue(undefined);
      const renew = jest.spyOn(service, 'renew').mockResolvedValue(true);
      let finishRun!: (value: { billableMs: number }) => void;
      const execution = service.run(
        'org',
        'run',
        'playwright',
        60_000,
        () =>
          new Promise<{ billableMs: number }>(
            (resolve) => (finishRun = resolve),
          ),
      );
      await jest.advanceTimersByTimeAsync(RESERVATION_RENEW_INTERVAL_MS * 3);
      expect(renew).toHaveBeenCalledTimes(3);
      finishRun({ billableMs: 1 });
      await execution;
      await jest.advanceTimersByTimeAsync(RESERVATION_RENEW_INTERVAL_MS * 3);
      expect(renew).toHaveBeenCalledTimes(3);
    });

    it('keeps the run going and logs when a renewal fails or ownership was lost', async () => {
      const { service } = buildRenewal([]);
      jest.spyOn(service, 'reserve').mockResolvedValue(reservation);
      jest.spyOn(service, 'finish').mockResolvedValue(undefined);
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      jest
        .spyOn(service, 'renew')
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error('database unavailable'));
      let finishRun!: (value: { billableMs: number }) => void;
      const execution = service.run(
        'org',
        'run',
        'playwright',
        60_000,
        () =>
          new Promise<{ billableMs: number }>(
            (resolve) => (finishRun = resolve),
          ),
      );
      await jest.advanceTimersByTimeAsync(RESERVATION_RENEW_INTERVAL_MS * 2);
      finishRun({ billableMs: 1 });
      await expect(execution).resolves.toMatchObject({ billableMs: 1 });
      // The takeover is now logged as an error (the run is cancelled); only the failed renewal warns.
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('cancels the run when its reservation was taken over', async () => {
      const abortRun = jest.fn();
      const service = new ExecutionAdmissionService(
        { update: jest.fn() } as never,
        { abortRun } as never,
      );
      jest.spyOn(service, 'reserve').mockResolvedValue(reservation);
      jest.spyOn(service, 'finish').mockResolvedValue(undefined);
      jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);
      jest.spyOn(service, 'renew').mockResolvedValue(false);
      let finishRun!: (value: { billableMs: number }) => void;
      const execution = service.run(
        'org',
        'run',
        'playwright',
        60_000,
        () =>
          new Promise<{ billableMs: number }>(
            (resolve) => (finishRun = resolve),
          ),
      );
      await jest.advanceTimersByTimeAsync(RESERVATION_RENEW_INTERVAL_MS * 3);
      expect(abortRun).toHaveBeenCalledTimes(1); // once, not per tick
      expect(abortRun).toHaveBeenCalledWith('run');
      finishRun({ billableMs: 1 });
      await execution;
    });

    it('cancels the run when the database cannot be reached for a whole lease', async () => {
      const abortRun = jest.fn();
      const service = new ExecutionAdmissionService(
        { update: jest.fn() } as never,
        { abortRun } as never,
      );
      jest.spyOn(service, 'reserve').mockResolvedValue(reservation);
      jest.spyOn(service, 'finish').mockResolvedValue(undefined);
      jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
      jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);
      jest
        .spyOn(service, 'renew')
        .mockRejectedValue(new Error('database unavailable'));
      let finishRun!: (value: { billableMs: number }) => void;
      const execution = service.run(
        'org',
        'run',
        'playwright',
        60_000,
        () =>
          new Promise<{ billableMs: number }>(
            (resolve) => (finishRun = resolve),
          ),
      );
      await jest.advanceTimersByTimeAsync(
        RESERVATION_LEASE_TTL_MS - RESERVATION_RENEW_INTERVAL_MS,
      );
      expect(abortRun).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(RESERVATION_RENEW_INTERVAL_MS * 2);
      expect(abortRun).toHaveBeenCalledWith('run');
      finishRun({ billableMs: 1 });
      await execution;
    });

    it('does not renew when no reservation applies', async () => {
      process.env.SELF_HOSTED = 'true';
      const { service } = buildRenewal([]);
      const renew = jest.spyOn(service, 'renew');
      const execution = service.run('org', 'run', 'k6', 5000, async () => ({
        billableMs: 1,
      }));
      await jest.advanceTimersByTimeAsync(RESERVATION_RENEW_INTERVAL_MS * 2);
      await execution;
      expect(renew).not.toHaveBeenCalled();
      process.env.SELF_HOSTED = 'false';
    });
  });
});
