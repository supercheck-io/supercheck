import {
  CLAIM_LIMIT,
  CLOSE_OUTAGE_SCRIPT,
  HEARTBEAT_INGEST_KEY,
  HEARTBEAT_SWEEP_INTERVAL_MS,
  INGEST_DOWN_SINCE_KEY,
  INGEST_OUTAGE_KEY,
  HeartbeatSweepService,
  decideHeartbeat,
  heartbeatGraceMinutes,
  type IngestStatus,
} from './heartbeat-sweep.service';

jest.mock('../monitor.service', () => ({ MonitorService: class {} }));
jest.mock('../../execution/services/usage-tracker.service', () => ({
  UsageTrackerService: class {},
}));
jest.mock('../../execution/services/redis.service', () => ({
  RedisService: class {},
}));

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.parse('2026-11-14T12:00:00Z');
const UP: IngestStatus = { up: true };

type Monitor = Parameters<typeof decideHeartbeat>[0];
const monitor = (over: Partial<Monitor> = {}): Monitor => ({
  id: 'm1',
  status: 'up',
  frequencyMinutes: 60, // grace 12 min
  config: null,
  createdAt: new Date(T0 - 30 * 24 * 60 * MIN),
  heartbeatState: {},
  ...over,
});
const pinged = (agoMin: number, extra: Record<string, unknown> = {}) =>
  monitor({
    heartbeatState: {
      lastPingAt: new Date(T0 - agoMin * MIN).toISOString(),
      lastPingKind: 'ping',
      pingSeq: 3,
      evaluatedSeq: 3,
      ...extra,
    },
  });

/** In-memory Redis with just what the ingest guard uses. */
function fakeRedis() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const redis = {
    status: 'ready',
    store,
    ttls,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, mode?: string) => {
      if (mode === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    /** CLOSE_OUTAGE_SCRIPT, run atomically like Redis does (no await inside). */
    eval: jest.fn(
      async (
        _script: string,
        _n: number,
        sinceKey: string,
        outageKey: string,
        now: string,
      ) => {
        const since = store.get(sinceKey);
        if (since) {
          const window = `{"id":"${since}","startMs":${since},"endMs":${now}}`;
          store.set(outageKey, window);
          ttls.set(
            outageKey,
            Math.ceil((3 * (Number(now) - Number(since))) / 1000) + 3600,
          );
          store.delete(sinceKey);
          return [1, window];
        }
        return [0, store.get(outageKey) ?? ''];
      },
    ),
  };
  return redis;
}

function service(redis = fakeRedis()) {
  const finishWhere = jest.fn().mockResolvedValue(undefined);
  const renewed = jest
    .fn()
    .mockResolvedValue([{ leaseUntil: 'L2', pingSeq: '3' }]);
  // Renewing the lease ends in .returning(); finishing awaits .where() itself.
  const set = jest.fn(() => ({
    where: (...args: unknown[]) => ({
      returning: renewed,
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        (finishWhere(...args) as Promise<unknown>).then(resolve, reject),
    }),
  }));
  const existingAt = jest.fn().mockResolvedValue([]);
  const db = {
    update: jest.fn(() => ({ set })),
    select: jest.fn(() => ({
      from: () => ({ where: () => ({ limit: existingAt }) }),
    })),
  };
  const usage = {
    shouldBlockExecution: jest.fn().mockResolvedValue({ blocked: false }),
  };
  const monitors = {
    recordExternalResult: jest.fn().mockResolvedValue(undefined),
  };
  const alerts = {
    sendWarning: jest.fn().mockResolvedValue({ delivered: true }),
  };
  const sweep = new HeartbeatSweepService(
    { db } as never,
    { getClient: () => redis } as never,
    usage as never,
    monitors as never,
    alerts as never,
  );
  return {
    sweep,
    redis,
    db,
    set,
    finishWhere,
    renewed,
    existingAt,
    usage,
    monitors,
    alerts,
  };
}

describe('heartbeatGraceMinutes', () => {
  it('defaults to 20% of the interval, at least 5 min, at most a day', () => {
    expect(heartbeatGraceMinutes({ frequencyMinutes: 1, config: null })).toBe(
      5,
    );
    expect(heartbeatGraceMinutes({ frequencyMinutes: 60, config: null })).toBe(
      12,
    );
    expect(
      heartbeatGraceMinutes({ frequencyMinutes: 44640, config: null }),
    ).toBe(1440);
    expect(
      heartbeatGraceMinutes({
        frequencyMinutes: 60,
        config: { heartbeat: { graceMinutes: 3 } },
      }),
    ).toBe(3);
  });
});

describe('decideHeartbeat', () => {
  it('leaves a never-pinged monitor pending', () => {
    expect(decideHeartbeat(monitor({ status: 'pending' }), T0, UP)).toEqual({
      finish: {},
    });
  });

  it('records a new ping as up, with the run duration when /start came within the interval', () => {
    const m = monitor({
      status: 'pending',
      heartbeatState: {
        lastPingAt: new Date(T0 - MIN).toISOString(),
        lastStartAt: new Date(T0 - 4 * MIN).toISOString(),
        lastPingKind: 'ping',
        pingSeq: 1,
      },
    });
    expect(decideHeartbeat(m, T0, UP)).toEqual({
      result: {
        kind: 'ping',
        isUp: true,
        checkedAt: new Date(T0 - MIN),
        responseTimeMs: 3 * MIN,
        reason: 'Ping received',
      },
      finish: { evaluatedSeq: 1, newPing: true },
    });
  });

  it('records a /fail overtaken by a ping in one window as down first, and tracks failSeq', () => {
    const failAt = new Date(T0 - 2 * MIN).toISOString();
    const m = monitor({
      heartbeatState: {
        lastPingAt: new Date(T0 - MIN).toISOString(),
        lastPingKind: 'ping',
        pingSeq: 5,
        evaluatedSeq: 3,
        failSeq: 2,
        evaluatedFailSeq: 1,
        lastFailAt: failAt,
      },
    });
    const d = decideHeartbeat(m, T0, UP);
    expect(d.priorFailAt).toEqual(new Date(failAt));
    expect(d.result?.kind).toBe('ping');
    expect(d.finish).toMatchObject({ evaluatedSeq: 5, evaluatedFailSeq: 2 });
    // Already judged: no prior fail.
    const judged = monitor({
      heartbeatState: { ...m.heartbeatState, evaluatedFailSeq: 2 },
    });
    expect(decideHeartbeat(judged, T0, UP).priorFailAt).toBeUndefined();
    // Old ping route (no failSeq): nothing new written.
    expect(
      decideHeartbeat(pinged(1, { pingSeq: 4 }), T0, UP).finish,
    ).not.toHaveProperty('evaluatedFailSeq');
  });

  it('shows no duration for a stale or later /start', () => {
    for (const startAgo of [200, 0.5]) {
      const m = monitor({
        heartbeatState: {
          lastPingAt: new Date(T0 - MIN).toISOString(),
          lastStartAt: new Date(T0 - startAgo * MIN).toISOString(),
          pingSeq: 2,
          evaluatedSeq: 1,
        },
      });
      expect(decideHeartbeat(m, T0, UP).result?.responseTimeMs).toBeUndefined();
    }
  });

  it('records /fail as down at once, even while ingest is unsure', () => {
    const m = monitor({
      heartbeatState: {
        lastPingAt: new Date(T0).toISOString(),
        lastPingKind: 'fail',
        pingSeq: 5,
        evaluatedSeq: 4,
      },
    });
    expect(decideHeartbeat(m, T0, { up: false })).toMatchObject({
      result: { kind: 'fail', isUp: false, reason: 'Job reported failure' },
      finish: { evaluatedSeq: 5, newPing: true },
    });
  });

  it('does nothing before the interval is up', () => {
    expect(decideHeartbeat(pinged(30), T0, UP)).toEqual({ finish: {} });
  });

  it('warns late once per episode inside grace, only while up', () => {
    const late = decideHeartbeat(pinged(65), T0, UP);
    expect(late.lateEpisodeKey).toBe(
      `heartbeat_late:m1:${new Date(T0 - 65 * MIN + 72 * MIN).toISOString()}`,
    );
    expect(late.finish).toEqual({ lateEpisodeKey: late.lateEpisodeKey });
    expect(
      decideHeartbeat(pinged(65, { lateEpisodeKey: 'x' }), T0, UP),
    ).toEqual({ finish: {} });
    expect(decideHeartbeat({ ...pinged(65), status: 'down' }, T0, UP)).toEqual({
      finish: {},
    });
  });

  it('misses after interval + grace, once per interval', () => {
    const missed = decideHeartbeat(pinged(73), T0, UP);
    expect(missed.result).toMatchObject({
      kind: 'missed',
      isUp: false,
      checkedAt: new Date(T0),
      reason: 'No ping received within 1 h plus 12 min grace',
    });
    expect(missed.finish).toEqual({ lastMissedAt: new Date(T0).toISOString() });
    const recent = new Date(T0 - 30 * MIN).toISOString();
    expect(
      decideHeartbeat(pinged(200, { lastMissedAt: recent }), T0, UP),
    ).toEqual({ finish: {} });
    const old = new Date(T0 - 60 * MIN).toISOString();
    expect(
      decideHeartbeat(pinged(200, { lastMissedAt: old }), T0, UP).result?.kind,
    ).toBe('missed');
  });

  it('records the next miss at once when the last one was held by maintenance that has ended', () => {
    const recent = new Date(T0 - 30 * MIN).toISOString();
    const held = pinged(200, { lastMissedAt: recent, missHeld: true });
    expect(decideHeartbeat(held, T0, UP)).toEqual({ finish: {} });
    expect(decideHeartbeat(held, T0, UP, true).result?.kind).toBe('missed');
  });

  it('counts the deadline from the newer of the last ping and the resume anchor', () => {
    const resumed = pinged(500, {
      anchorAt: new Date(T0 - 10 * MIN).toISOString(),
    });
    expect(decideHeartbeat(resumed, T0, UP)).toEqual({ finish: {} });
  });

  it('formats day intervals in the reason', () => {
    const daily = { ...pinged(3 * 24 * 60), frequencyMinutes: 1440 };
    expect(decideHeartbeat(daily, T0, UP).result?.reason).toBe(
      'No ping received within 1 d plus 288 min grace',
    );
  });
});

describe('ingest guard', () => {
  beforeEach(() => jest.useFakeTimers({ now: T0 }));
  afterEach(() => jest.useRealTimers());

  it('skips miss and late detection while the stamp is missing', async () => {
    const { sweep, redis } = service();
    const ingest = await sweep.readIngest();
    expect(ingest).toEqual({ up: false });
    // Outage start goes back one stamp lifetime; a second worker does not move it.
    expect(redis.store.get(INGEST_DOWN_SINCE_KEY)).toBe(String(T0 - 150_000));
    await sweep.readIngest(T0 + 30_000);
    expect(redis.store.get(INGEST_DOWN_SINCE_KEY)).toBe(String(T0 - 150_000));
    expect(decideHeartbeat(pinged(500), T0, ingest)).toEqual({ finish: {} });
    expect(decideHeartbeat(pinged(65), T0, ingest)).toEqual({ finish: {} });
  });

  it('records the outage once when the stamp returns, then moves only deadlines inside it, once', async () => {
    const { sweep, redis } = service();
    await sweep.readIngest(); // down since T0 - 150 s
    redis.store.set(HEARTBEAT_INGEST_KEY, '1');
    const end = T0 + 20 * MIN;
    const back = await sweep.readIngest(end);
    const outage = {
      id: String(T0 - 150_000),
      startMs: T0 - 150_000,
      endMs: end,
    };
    expect(back).toEqual({ up: true, outage });
    expect(redis.store.has(INGEST_DOWN_SINCE_KEY)).toBe(false);
    expect(JSON.parse(redis.store.get(INGEST_OUTAGE_KEY)!)).toEqual(outage);
    // Another worker (or the next sweep) reads the same outage.
    expect(await sweep.readIngest(end + 30_000)).toEqual({ up: true, outage });

    // Ping due T0 - 7 min (inside the outage), deadline T0 + 5 min: one full interval + grace after the outage end.
    const lastMs = T0 - 67 * MIN;
    const inside = pinged(67, { lateEpisodeKey: 'late-already' });
    const shifted = decideHeartbeat(inside, end + MIN, back);
    expect(shifted.result).toBeUndefined();
    expect(shifted.finish).toEqual({
      deadlineShiftedFor: outage.id,
      deadlineShiftMs: end - lastMs,
    });
    // Once per outage: with the shift stored it is not applied again.
    const stored = pinged(67, {
      lateEpisodeKey: 'late-already',
      deadlineShiftedFor: outage.id,
      deadlineShiftMs: end - lastMs,
    });
    expect(decideHeartbeat(stored, end + MIN, back).finish).toEqual({});
    expect(
      decideHeartbeat(stored, end + 72 * MIN, back).result,
    ).toBeUndefined();
    expect(decideHeartbeat(stored, end + 72 * MIN + 1, back).result?.kind).toBe(
      'missed',
    );
  });

  it('gives a full interval after an outage that swallowed the due ping (60 min, grace 12)', () => {
    const at = (hhmm: string) => Date.parse(`2026-11-14T${hhmm}:00Z`);
    const outage = { id: 'o', startMs: at('10:00'), endMs: at('10:30') };
    const m = monitor({
      heartbeatState: {
        lastPingAt: new Date(at('09:00')).toISOString(),
        pingSeq: 1,
        evaluatedSeq: 1,
      },
    });
    const ingest = { up: true, outage };
    // The old shift-by-length rule would have gone down at 10:42, before the real 11:00 ping.
    const d = decideHeartbeat(m, at('10:43'), ingest);
    expect(d.result).toBeUndefined();
    expect(d.finish).toEqual({
      deadlineShiftedFor: 'o',
      deadlineShiftMs: at('10:30') - at('09:00'),
    });
    // Late from 11:30, down after 11:42.
    expect(
      decideHeartbeat(m, at('11:29'), ingest).lateEpisodeKey,
    ).toBeUndefined();
    expect(decideHeartbeat(m, at('11:31'), ingest).lateEpisodeKey).toBe(
      `heartbeat_late:m1:${new Date(at('11:42')).toISOString()}`,
    );
    expect(decideHeartbeat(m, at('11:43'), ingest).result?.kind).toBe('missed');
    // A deadline that passed before the outage began is not moved.
    const old = monitor({
      heartbeatState: {
        lastPingAt: new Date(at('08:00')).toISOString(),
        pingSeq: 1,
        evaluatedSeq: 1,
      },
    });
    expect(decideHeartbeat(old, at('10:31'), ingest).finish).not.toHaveProperty(
      'deadlineShiftedFor',
    );
  });

  it('closes and publishes the outage in one script, so a concurrent reader always sees it', async () => {
    const redis = fakeRedis();
    const a = service(redis).sweep;
    const b = service(redis).sweep;
    await a.readIngest(); // down since T0 - 150 s
    redis.store.set(HEARTBEAT_INGEST_KEY, '1');
    const end = T0 + 10 * MIN;
    const [ra, rb] = await Promise.all([a.readIngest(end), b.readIngest(end)]);
    const outage = {
      id: String(T0 - 150_000),
      startMs: T0 - 150_000,
      endMs: end,
    };
    expect(ra).toEqual({ up: true, outage });
    expect(rb).toEqual({ up: true, outage });
    // Exactly one closed it (and the other read the published window), never neither key.
    const closes = await Promise.all(
      redis.eval.mock.results.map((r) => r.value as Promise<[number, string]>),
    );
    expect(closes.map(([closed]) => closed).sort()).toEqual([0, 1]);
    expect(redis.store.has(INGEST_DOWN_SINCE_KEY)).toBe(false);
    expect(redis.ttls.get(INGEST_OUTAGE_KEY)).toBe(
      Math.ceil((3 * (end - outage.startMs)) / 1000) + 3600,
    );
    expect(redis.eval).toHaveBeenCalledWith(
      CLOSE_OUTAGE_SCRIPT,
      2,
      INGEST_DOWN_SINCE_KEY,
      INGEST_OUTAGE_KEY,
      String(end),
    );
  });

  it('caps the extra wait after an outage at 24 h for long intervals', () => {
    const outage = { id: 'o', startMs: T0 - 15 * MIN, endMs: T0 };
    // Monthly job due 5 min into a 15-min outage (grace 1 d): 24 h + grace after the outage, not 31 days.
    const monthly = {
      ...pinged(44640 + 10),
      frequencyMinutes: 44640,
      createdAt: new Date(T0 - 90 * DAY),
    };
    const ingest = { up: true, outage };
    const d = decideHeartbeat(monthly, T0 + MIN, ingest);
    expect(d.finish.deadlineShiftedFor).toBe('o');
    expect(d.finish.deadlineShiftMs).toBe(
      T0 + DAY - (T0 - (44640 + 10) * MIN) - 44640 * MIN,
    );
    const late = decideHeartbeat(monthly, T0 + DAY + MIN, ingest);
    expect(late.lateEpisodeKey).toBe(
      `heartbeat_late:m1:${new Date(T0 + 2 * DAY).toISOString()}`,
    );
    expect(
      decideHeartbeat(monthly, T0 + 2 * DAY + 1, ingest).result?.kind,
    ).toBe('missed');
  });

  it('does not shift a deadline counted from a ping after the outage ended', () => {
    const outage = { id: 'o1', startMs: T0 - 30 * MIN, endMs: T0 - 20 * MIN };
    // Interval 1 min, grace 5: pinged 10 min ago (after the outage), deadline inside the window, yet not shifted.
    const fast = { ...pinged(10), frequencyMinutes: 1 };
    expect(decideHeartbeat(fast, T0, { up: true, outage })).toMatchObject({
      result: { kind: 'missed' },
      finish: { lastMissedAt: new Date(T0).toISOString() },
    });
  });

  it('leaves a not-yet-due 31-day heartbeat unchanged', async () => {
    const outage = { id: 'o1', startMs: T0 - 10 * MIN, endMs: T0 };
    const monthly = { ...pinged(2 * 24 * 60), frequencyMinutes: 44640 };
    expect(decideHeartbeat(monthly, T0, { up: true, outage })).toEqual({
      finish: {},
    });
  });

  it('treats Redis that is not ready, failing or hanging as ingest down', async () => {
    const notReady = fakeRedis();
    notReady.status = 'reconnecting';
    expect(await service(notReady).sweep.readIngest()).toEqual({ up: false });
    expect(notReady.get).not.toHaveBeenCalled();

    const failing = fakeRedis();
    failing.get.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await service(failing).sweep.readIngest()).toEqual({ up: false });

    const hanging = fakeRedis();
    hanging.get.mockReturnValueOnce(new Promise(() => {}));
    const pending = service(hanging).sweep.readIngest();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(await pending).toEqual({ up: false });
  });

  it('ignores a malformed stored outage', async () => {
    const redis = fakeRedis();
    redis.store.set(HEARTBEAT_INGEST_KEY, '1');
    redis.store.set(INGEST_OUTAGE_KEY, '{nope');
    expect(await service(redis).sweep.readIngest()).toEqual({
      up: true,
      outage: undefined,
    });
    redis.store.set(INGEST_OUTAGE_KEY, '{"id":1}');
    expect(await service(redis).sweep.readIngest()).toEqual({
      up: true,
      outage: undefined,
    });
  });
});

describe('HeartbeatSweepService.sweep', () => {
  const claimed = (m: ReturnType<typeof pinged>) =>
    ({
      ...m,
      organizationId: 'org',
      name: 'Backup',
      heartbeatState: { ...m.heartbeatState, leaseUntil: 'L' },
    }) as never;

  function withClaim(rows: unknown[]) {
    const ctx = service();
    ctx.redis.store.set(HEARTBEAT_INGEST_KEY, '1');
    jest
      .spyOn(ctx.sweep, 'claim')
      .mockResolvedValue({ rows: rows as never, now: T0 });
    return ctx;
  }

  it('claims again while full batches come back, within the tick budget', async () => {
    const ctx = withClaim([]);
    const full = Array.from({ length: CLAIM_LIMIT }, (_, i) =>
      claimed({ ...pinged(10), id: `m${i}` }),
    );
    (ctx.sweep.claim as jest.Mock)
      .mockResolvedValueOnce({ rows: full, now: T0 })
      .mockResolvedValueOnce({ rows: [], now: T0 });
    await ctx.sweep.sweep();
    expect(ctx.sweep.claim).toHaveBeenCalledTimes(2);
    expect(ctx.finishWhere).toHaveBeenCalledTimes(CLAIM_LIMIT);
  });

  it('records a missed result with heartbeat details, then finishes', async () => {
    const ctx = withClaim([claimed(pinged(80))]);
    await ctx.sweep.sweep();
    expect(ctx.sweep.claim).toHaveBeenCalledWith(true);
    expect(ctx.monitors.recordExternalResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1' }),
      expect.objectContaining({
        location: 'local',
        status: 'down',
        isUp: false,
        details: {
          heartbeat: { kind: 'missed' },
          errorMessage: 'No ping received within 1 h plus 12 min grace',
        },
      }),
    );
    expect(ctx.finishWhere).toHaveBeenCalledTimes(1);
  });

  it('skips the result and does not finish when the lease was lost mid-batch', async () => {
    const ctx = withClaim([claimed(pinged(80))]);
    ctx.renewed.mockResolvedValueOnce([]);
    await ctx.sweep.sweep();
    expect(ctx.monitors.recordExternalResult).not.toHaveBeenCalled();
    expect(ctx.finishWhere).not.toHaveBeenCalled();
  });

  it('drops a stale miss when a ping landed after the claim, and releases the lease', async () => {
    const ctx = withClaim([claimed(pinged(80))]);
    ctx.renewed.mockResolvedValueOnce([{ leaseUntil: 'L2', pingSeq: '4' }]);
    await ctx.sweep.sweep();
    expect(ctx.monitors.recordExternalResult).not.toHaveBeenCalled();
    expect(ctx.finishWhere).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['paused', { status: 'paused' }],
    ['resumed (new anchor)', { anchorAt: '2026-11-14T11:59:00.000Z' }],
  ])(
    'drops a miss when the monitor was %s after the claim',
    async (_l, row) => {
      const ctx = withClaim([claimed(pinged(80))]);
      ctx.renewed.mockResolvedValueOnce([
        { leaseUntil: 'L2', pingSeq: '3', status: 'up', ...row },
      ]);
      await ctx.sweep.sweep();
      expect(ctx.monitors.recordExternalResult).not.toHaveBeenCalled();
      expect(ctx.finishWhere).toHaveBeenCalledTimes(1);
    },
  );

  it('records with the renewed lease so finishing releases it', async () => {
    const ctx = withClaim([claimed(pinged(80))]);
    await ctx.sweep.sweep();
    expect(
      ctx.monitors.recordExternalResult.mock.calls[0][0].heartbeatState
        .leaseUntil,
    ).toBe('L2');
  });

  it('records the overtaken /fail as down before the ping', async () => {
    const m = monitor({
      heartbeatState: {
        lastPingAt: new Date(T0 - MIN).toISOString(),
        lastPingKind: 'ping',
        pingSeq: 2,
        evaluatedSeq: 0,
        failSeq: 1,
        lastFailAt: new Date(T0 - 2 * MIN).toISOString(),
      },
    });
    const ctx = withClaim([claimed(m)]);
    await ctx.sweep.sweep();
    const calls = ctx.monitors.recordExternalResult.mock.calls.map((c) => c[1]);
    expect(calls).toMatchObject([
      {
        isUp: false,
        checkedAt: new Date(T0 - 2 * MIN),
        details: { heartbeat: { kind: 'fail' } },
      },
      { isUp: true, details: { heartbeat: { kind: 'ping' } } },
    ]);
  });

  it('does not store the overtaken /fail twice on a retry', async () => {
    const m = monitor({
      heartbeatState: {
        lastPingAt: new Date(T0 - MIN).toISOString(),
        lastPingKind: 'ping',
        pingSeq: 2,
        evaluatedSeq: 0,
        failSeq: 1,
        lastFailAt: new Date(T0 - 2 * MIN).toISOString(),
      },
    });
    const ctx = withClaim([claimed(m)]);
    ctx.existingAt.mockResolvedValueOnce([{ id: 'r1' }]);
    await ctx.sweep.sweep();
    const calls = ctx.monitors.recordExternalResult.mock.calls;
    expect(calls.map((c) => [c[1].isUp, c[2]])).toEqual([
      [false, { alreadyStored: true }],
      [true, undefined],
    ]);
  });

  it('records a ping with its start time and client', async () => {
    const m = monitor({
      heartbeatState: {
        lastPingAt: new Date(T0 - MIN).toISOString(),
        lastStartAt: new Date(T0 - 2 * MIN).toISOString(),
        lastUserAgent: 'curl/8',
        pingSeq: 2,
        evaluatedSeq: 1,
      },
    });
    const ctx = withClaim([claimed(m)]);
    await ctx.sweep.sweep();
    expect(ctx.monitors.recordExternalResult.mock.calls[0][1]).toMatchObject({
      status: 'up',
      responseTimeMs: MIN,
      details: {
        heartbeat: {
          kind: 'ping',
          startedAt: m.heartbeatState!.lastStartAt,
          userAgent: 'curl/8',
        },
      },
    });
  });

  it('sends the late warning with its episode key', async () => {
    const ctx = withClaim([claimed(pinged(65))]);
    await ctx.sweep.sweep();
    expect(ctx.alerts.sendWarning).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1' }),
      'heartbeat_late',
      expect.stringContaining('12 min grace period'),
      expect.stringMatching(/^heartbeat_late:m1:/),
    );
    expect(ctx.monitors.recordExternalResult).not.toHaveBeenCalled();
  });

  it('skips a usage-blocked monitor without finishing, so its lease runs out', async () => {
    const ctx = withClaim([claimed(pinged(80))]);
    ctx.usage.shouldBlockExecution.mockResolvedValue({
      blocked: true,
      reason: 'plan',
    });
    await ctx.sweep.sweep();
    expect(ctx.monitors.recordExternalResult).not.toHaveBeenCalled();
    expect(ctx.finishWhere).not.toHaveBeenCalled();
  });

  it('does not check billing when there is nothing to record', async () => {
    const ctx = withClaim([claimed(pinged(10))]);
    await ctx.sweep.sweep();
    expect(ctx.usage.shouldBlockExecution).not.toHaveBeenCalled();
    expect(ctx.finishWhere).toHaveBeenCalledTimes(1);
  });

  it('leaves a monitor unfinished when recording fails, and goes on with the others', async () => {
    const ctx = withClaim([
      claimed(pinged(80)),
      claimed({ ...pinged(80), id: 'm2' }),
    ]);
    ctx.monitors.recordExternalResult.mockRejectedValueOnce(
      new Error('db down'),
    );
    await ctx.sweep.sweep();
    expect(ctx.monitors.recordExternalResult).toHaveBeenCalledTimes(2);
    expect(ctx.finishWhere).toHaveBeenCalledTimes(1);
  });

  it('never throws and skips an overlapping tick', async () => {
    const ctx = service();
    let release: (() => void) | undefined;
    jest
      .spyOn(ctx.sweep, 'claim')
      .mockImplementationOnce(
        () => new Promise((r) => (release = () => r({ rows: [], now: T0 }))),
      )
      .mockRejectedValueOnce(new Error('db down'));
    const first = ctx.sweep.sweep();
    await ctx.sweep.sweep(); // overlapping: returns at once
    while (!release) await new Promise((r) => setImmediate(r));
    release();
    await first;
    expect(ctx.sweep.claim).toHaveBeenCalledTimes(1);
    expect(ctx.sweep.claim).toHaveBeenLastCalledWith(false); // stamp missing
    await expect(ctx.sweep.sweep()).resolves.toBeUndefined();
  });

  it('runs every 30 s from init and stops on shutdown', () => {
    jest.useFakeTimers();
    try {
      const ctx = service();
      const spy = jest.spyOn(ctx.sweep, 'sweep').mockResolvedValue();
      ctx.sweep.onModuleInit();
      jest.advanceTimersByTime(HEARTBEAT_SWEEP_INTERVAL_MS * 2);
      expect(spy).toHaveBeenCalledTimes(2);
      ctx.sweep.onModuleDestroy();
      ctx.sweep.onModuleDestroy();
      jest.advanceTimersByTime(HEARTBEAT_SWEEP_INTERVAL_MS * 2);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
