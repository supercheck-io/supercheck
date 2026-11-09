import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  MonitorEvaluator,
  isIncidentOnly,
  tracksAlertState,
} from './monitor-evaluator';

/** Drives evaluateAndSendAlert through consecutive failures and returns the counts that alerted. */
async function alertCounts(
  failureThreshold: number,
  startAt: number,
  upTo: number,
  multiLocation: boolean,
  delivered = true,
  attempted: number[] = [],
) {
  let sent = 0;
  const latest = {
    id: 'r1',
    consecutiveFailureCount: 0,
    alertsSentForFailure: 0,
  };
  const dbService = {
    db: {
      query: { monitorResults: { findFirst: jest.fn(async () => latest) } },
      update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn() })) })),
    },
  };
  const alertService = {
    sendNotification: jest.fn(async () => {
      attempted.push(latest.consecutiveFailureCount);
      return { delivered };
    }),
    signalRecovery: jest.fn(async () => true),
  };
  const evaluator = new MonitorEvaluator(
    dbService as never,
    alertService as never,
  );
  jest
    .spyOn(evaluator as never, 'persistAggregatedAlertState')
    .mockResolvedValue(undefined as never);

  const fired: number[] = [];
  for (let count = startAt; count <= upTo; count++) {
    latest.consecutiveFailureCount = count;
    latest.alertsSentForFailure = sent;
    const res = await evaluator.evaluateAndSendAlert({
      monitorId: 'm1',
      monitor: {
        alertConfig: { enabled: true, alertOnFailure: true, failureThreshold },
        config: {},
      } as never,
      previousStatus: 'down',
      currentStatus: 'down',
      reason: 'down',
      metadata: multiLocation ? { locationResults: [{}, {}] } : {},
      preparedAlertState: multiLocation
        ? {
            consecutiveFailureCount: count,
            consecutiveSuccessCount: 0,
            alertsSentForFailure: sent,
            alertsSentForRecovery: 0,
          }
        : undefined,
    });
    if (res.alertSent) {
      sent++;
      fired.push(count);
    }
  }
  return fired;
}

describe('MonitorEvaluator failure alert cadence', () => {
  it('stops retrying an undeliverable first alert after one reminder interval', async () => {
    // delivered:false never increments the sent counter, so every attempt is a first alert.
    const attempted: number[] = [];
    await alertCounts(1, 1, 30, false, false, attempted);
    // Each alert window is bounded; an unsent first alert may use the later windows too.
    // The first-alert window (1-5), then the reminder windows (6-10, 16-20) while still unsent.
    expect(attempted).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20,
    ]);
  });

  it.each([false, true])(
    'threshold 1: alerts at 1, then reminders, capped at 3 (multi=%s)',
    async (multi) => {
      expect(await alertCounts(1, 1, 30, multi)).toEqual([1, 6, 16]);
    },
  );

  it.each([false, true])(
    'threshold 3: alerts at 3, then reminders, capped at 3 (multi=%s)',
    async (multi) => {
      expect(await alertCounts(3, 1, 40, multi)).toEqual([3, 9, 21]);
    },
  );

  it.each([false, true])(
    'threshold 1: first observation skipped (pending->down) still alerts at the next failure (multi=%s)',
    async (multi) => {
      const fired = await alertCounts(1, 2, 30, multi);
      expect(fired[0]).toBe(2);
      expect(fired.length).toBeLessThanOrEqual(3);
    },
  );
});

describe('MonitorEvaluator recovery alert after a short blip', () => {
  async function recoverySent(
    multiLocation: boolean,
    priorFailureCount: number | undefined,
    alertOnFailure = true,
    alertsSentForFailure = 0,
  ) {
    const details =
      priorFailureCount === undefined || alertsSentForFailure > 0
        ? { recoverySequence: true }
        : { recoverySequence: true, priorFailureCount };
    const dbService = {
      db: {
        query: {
          monitorResults: {
            findFirst: jest.fn(async () => ({
              id: 'r1',
              consecutiveSuccessCount: 1,
              alertsSentForRecovery: 0,
              details,
            })),
          },
        },
        update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn() })) })),
      },
    };
    const alertService = {
      sendNotification: jest.fn(async () => ({ delivered: true })),
      signalRecovery: jest.fn(async () => true),
    };
    const evaluator = new MonitorEvaluator(
      dbService as never,
      alertService as never,
    );
    jest
      .spyOn(evaluator as never, 'persistAggregatedAlertState')
      .mockResolvedValue(undefined as never);
    const res = await evaluator.evaluateAndSendAlert({
      monitorId: 'm1',
      monitor: {
        alertConfig: {
          enabled: true,
          alertOnFailure,
          alertOnRecovery: true,
          failureThreshold: 3,
          recoveryThreshold: 1,
        },
        config: {},
      } as never,
      previousStatus: 'down',
      currentStatus: 'up',
      reason: 'up',
      metadata: multiLocation ? { locationResults: [{}, {}] } : {},
      preparedAlertState: multiLocation
        ? evaluator.getNextAggregatedAlertState(
            {
              consecutiveFailureCount: priorFailureCount ?? 0,
              consecutiveSuccessCount: 0,
              alertsSentForFailure,
              alertsSentForRecovery: 0,
            },
            'down',
            'up',
          )
        : undefined,
    });
    return res.alertSent;
  }

  it.each([false, true])(
    'skips recovery when the outage stayed below the failure threshold (multi=%s)',
    async (multi) => {
      expect(await recoverySent(multi, 1)).toBe(false);
      expect(await recoverySent(multi, 2)).toBe(false);
    },
  );

  it.each([false, true])(
    'sends recovery once the outage reached the threshold, even with failure alerts off (multi=%s)',
    async (multi) => {
      expect(await recoverySent(multi, 3)).toBe(true);
      expect(await recoverySent(multi, 3, false)).toBe(true);
    },
  );

  it.each([false, true])(
    'sends recovery after an alerted outage even if the threshold was raised since (multi=%s)',
    async (multi) => {
      expect(await recoverySent(multi, 2, true, 1)).toBe(true);
    },
  );

  it('reads the outage length back from persisted state', () => {
    const evaluator = new MonitorEvaluator({} as never, {} as never);
    expect(
      evaluator.readAggregatedAlertState({
        aggregatedAlertState: { priorFailureCount: 2 },
      }).priorFailureCount,
    ).toBe(2);
    expect(
      evaluator.readAggregatedAlertState({}).priorFailureCount,
    ).toBeUndefined();
  });

  it.each([false, true])(
    'sends recovery when the outage length is unknown (multi=%s)',
    async (multi) => {
      expect(await recoverySent(multi, undefined)).toBe(true);
    },
  );

  it('carries the outage length through the up streak', () => {
    const evaluator = new MonitorEvaluator({} as never, {} as never);
    const first = evaluator.getNextAggregatedAlertState(
      {
        consecutiveFailureCount: 2,
        consecutiveSuccessCount: 0,
        alertsSentForFailure: 0,
        alertsSentForRecovery: 0,
      },
      'down',
      'up',
    );
    expect(first.priorFailureCount).toBe(2);
    expect(
      evaluator.getNextAggregatedAlertState(first, 'up', 'up')
        .priorFailureCount,
    ).toBe(2);
    expect(
      evaluator.getNextAggregatedAlertState(first, 'up', 'down')
        .priorFailureCount,
    ).toBeUndefined();
  });

  it('does not gate recovery on a failure count frozen while alerts were off', () => {
    const evaluator = new MonitorEvaluator({} as never, {} as never);
    const frozen = evaluator.advanceAggregatedAlertState(
      false,
      {
        aggregatedAlertState: {
          consecutiveFailureCount: 1,
          consecutiveSuccessCount: 0,
          alertsSentForFailure: 0,
          alertsSentForRecovery: 0,
        },
      },
      'down',
      'down',
    );
    const recovered = evaluator.getNextAggregatedAlertState(
      frozen,
      'down',
      'up',
    );
    expect(frozen.consecutiveFailureCount).toBe(1);
    // Counting resumes but the outage length stays unknown, so recovery is not suppressed.
    const resumed = evaluator.getNextAggregatedAlertState(
      frozen,
      'down',
      'down',
    );
    expect(
      evaluator.getNextAggregatedAlertState(recovered, 'up', 'up')
        .priorFailureCount,
    ).toBeUndefined();
    expect(recovered.priorFailureCount).toBeUndefined();
    expect(
      evaluator.getNextAggregatedAlertState(resumed, 'down', 'up')
        .priorFailureCount,
    ).toBeUndefined();
  });
});

describe('MonitorEvaluator recovery alert retries', () => {
  /** Runs consecutive up-checks after an outage; returns the success counts that attempted a recovery alert. */
  async function recoveryAttempts(
    multiLocation: boolean,
    recoveryThreshold: number,
    outcome: { delivered: boolean; suppressed?: boolean; reason?: string },
    upTo = 40,
  ) {
    let recoveriesRecorded = 0;
    const latest = {
      id: 'r1',
      consecutiveSuccessCount: 0,
      alertsSentForRecovery: 0,
      details: { recoverySequence: true },
    };
    const set = jest.fn((values: { alertsSentForRecovery?: number }) => {
      if (values.alertsSentForRecovery !== undefined) recoveriesRecorded++;
      return { where: jest.fn() };
    });
    const dbService = {
      db: {
        query: { monitorResults: { findFirst: jest.fn(async () => latest) } },
        update: jest.fn(() => ({ set })),
      },
    };
    const attempted: number[] = [];
    const alertService = {
      sendNotification: jest.fn(async () => {
        attempted.push(latest.consecutiveSuccessCount);
        return outcome;
      }),
      signalRecovery: jest.fn(async () => true),
    };
    const evaluator = new MonitorEvaluator(
      dbService as never,
      alertService as never,
    );
    const persist = jest
      .spyOn(evaluator as never, 'persistAggregatedAlertState')
      .mockImplementation((async (
        _id: string,
        state: { alertsSentForRecovery: number },
      ) => {
        if (state.alertsSentForRecovery > 0) recoveriesRecorded++;
      }) as never);

    for (let count = 1; count <= upTo; count++) {
      latest.consecutiveSuccessCount = count;
      latest.alertsSentForRecovery = recoveriesRecorded;
      await evaluator.evaluateAndSendAlert({
        monitorId: 'm1',
        monitor: {
          alertConfig: {
            enabled: true,
            alertOnRecovery: true,
            failureThreshold: 1,
            recoveryThreshold,
          },
          config: {},
        } as never,
        previousStatus: 'up',
        currentStatus: 'up',
        reason: 'up',
        metadata: multiLocation ? { locationResults: [{}, {}] } : {},
        preparedAlertState: multiLocation
          ? {
              consecutiveFailureCount: 0,
              consecutiveSuccessCount: count,
              alertsSentForFailure: 0,
              alertsSentForRecovery: recoveriesRecorded,
              recoverySequence: true,
            }
          : undefined,
      });
    }
    persist.mockRestore();
    return { attempted, recoveriesRecorded };
  }

  it.each([
    [false, 1, [1, 2, 3, 4, 5]],
    [true, 1, [1, 2, 3, 4, 5]],
    [false, 3, [3, 4, 5, 6, 7, 8]],
    [true, 3, [3, 4, 5, 6, 7, 8]],
  ])(
    'stops retrying an undeliverable recovery (multi=%s, threshold %s)',
    async (multi, threshold, expected) => {
      const { attempted, recoveriesRecorded } = await recoveryAttempts(
        multi,
        threshold,
        { delivered: false },
      );
      expect(attempted).toEqual(expected);
      expect(recoveriesRecorded).toBe(0);
    },
  );

  it.each([
    [false, 1],
    [true, 1],
    [false, 3],
    [true, 3],
  ])(
    'treats a suppressed recovery as consumed (multi=%s, threshold %s)',
    async (multi, threshold) => {
      const { attempted, recoveriesRecorded } = await recoveryAttempts(
        multi,
        threshold,
        { delivered: false, suppressed: true, reason: 'maintenance' },
      );
      expect(attempted).toEqual([threshold]);
      expect(recoveriesRecorded).toBeGreaterThan(0);
    },
  );

  it.each([
    [false, 1],
    [true, 3],
  ])(
    'keeps retrying a recovery suppressed for lack of providers within the bound (multi=%s, threshold %s)',
    async (multi, threshold) => {
      const { attempted, recoveriesRecorded } = await recoveryAttempts(
        multi,
        threshold,
        { delivered: false, suppressed: true, reason: 'no_providers' },
      );
      expect(attempted.length).toBeGreaterThan(1);
      expect(attempted.length).toBeLessThanOrEqual(Math.max(5, threshold * 2));
      expect(recoveriesRecorded).toBe(0);
    },
  );
});

describe('MonitorEvaluator.updateMonitorStatus paused guard', () => {
  it('guards the write so a paused monitor is never overwritten', async () => {
    const where = jest.fn();
    const dbService = {
      db: {
        query: {
          monitors: { findFirst: jest.fn(async () => ({ status: 'up' })) },
        },
        update: jest.fn(() => ({ set: jest.fn(() => ({ where })) })),
      },
    };
    const evaluator = new MonitorEvaluator(dbService as never, {} as never);
    await evaluator.updateMonitorStatus('m1', 'down', new Date());
    expect(where).toHaveBeenCalledTimes(1);
    const { sql, params } = new PgDialect().sqlToQuery(
      where.mock.calls[0][0] as SQL,
    );
    expect(sql).toContain("<> 'paused'");
    expect(params).toEqual(['m1']);
  });
});

describe('incident-only monitors (alerts off or no channel)', () => {
  it('classifies alert settings', () => {
    expect(isIncidentOnly({ enabled: false, incidentEnabled: true })).toBe(
      true,
    );
    expect(isIncidentOnly({ enabled: false })).toBe(false);
    expect(isIncidentOnly({ enabled: true, incidentEnabled: true })).toBe(
      false,
    );
    expect(tracksAlertState({ enabled: false, incidentEnabled: true })).toBe(
      true,
    );
    expect(tracksAlertState({ enabled: false })).toBe(false);
    expect(tracksAlertState(null)).toBe(false);
  });

  async function run(alertConfig: object, observedAt?: Date) {
    const latest = {
      id: 'r1',
      consecutiveFailureCount: 1,
      alertsSentForFailure: 0,
    };
    const dbService = {
      db: {
        query: { monitorResults: { findFirst: jest.fn(async () => latest) } },
        update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn() })) })),
      },
    };
    const alertService = {
      sendNotification: jest.fn(async () => ({ delivered: true })),
      signalFailure: jest.fn(async () => ({
        delivered: false,
        suppressed: true,
        reason: 'incident_only',
      })),
      signalRecovery: jest.fn(async () => true),
    };
    const evaluator = new MonitorEvaluator(
      dbService as never,
      alertService as never,
    );
    const res = await evaluator.evaluateAndSendAlert({
      monitorId: 'm1',
      monitor: { alertConfig, config: {} } as never,
      previousStatus: 'down',
      currentStatus: 'down',
      reason: 'down',
      metadata: {},
      observedAt,
    });
    return { res, alertService };
  }

  it('signals the incident without notifying when alerts are off', async () => {
    const { res, alertService } = await run({
      enabled: false,
      incidentEnabled: true,
    });
    expect(alertService.signalFailure).toHaveBeenCalledWith(
      'm1',
      'down',
      undefined,
    );
    expect(alertService.sendNotification).not.toHaveBeenCalled();
    expect(res).toMatchObject({ alertSent: true });
  });

  it('passes the failing cycle time to the incident signal and to notifications', async () => {
    const observedAt = new Date('2026-06-22T00:00:00Z');
    const incidentOnly = await run(
      { enabled: false, incidentEnabled: true },
      observedAt,
    );
    expect(incidentOnly.alertService.signalFailure).toHaveBeenCalledWith(
      'm1',
      'down',
      observedAt,
    );
    const alerting = await run(
      { enabled: true, alertOnFailure: true },
      observedAt,
    );
    expect(alerting.alertService.sendNotification).toHaveBeenCalledWith(
      'm1',
      'failure',
      'down',
      expect.objectContaining({ observedAt: observedAt.toISOString() }),
      undefined, // no outage key on the stored result: sent unclaimed
    );
  });

  it('still does nothing when alerts and incidents are both off', async () => {
    const { res, alertService } = await run({ enabled: false });
    expect(alertService.signalFailure).not.toHaveBeenCalled();
    expect(res).toEqual({ alertSent: false });
  });

  it('notifies as before when alerts are on', async () => {
    const { alertService } = await run({ enabled: true, alertOnFailure: true });
    expect(alertService.sendNotification).toHaveBeenCalled();
    expect(alertService.signalFailure).not.toHaveBeenCalled();
  });

  it('sends no failure signal on recovery for an incident-only monitor', async () => {
    const latest = {
      id: 'r1',
      consecutiveSuccessCount: 1,
      alertsSentForRecovery: 0,
      details: { recoverySequence: true },
    };
    const alertService = {
      sendNotification: jest.fn(),
      signalFailure: jest.fn(),
      signalRecovery: jest.fn(async () => true),
    };
    const evaluator = new MonitorEvaluator(
      {
        db: {
          query: { monitorResults: { findFirst: jest.fn(async () => latest) } },
          update: jest.fn(),
        },
      } as never,
      alertService as never,
    );
    const res = await evaluator.evaluateAndSendAlert({
      monitorId: 'm1',
      monitor: {
        alertConfig: {
          enabled: false,
          incidentEnabled: true,
          alertOnRecovery: true,
        },
        config: {},
      } as never,
      previousStatus: 'down',
      currentStatus: 'up',
      reason: 'up',
      metadata: {},
    });
    expect(res).toEqual({ alertSent: false });
    expect(alertService.signalFailure).not.toHaveBeenCalled();
    expect(alertService.sendNotification).not.toHaveBeenCalled();
    expect(alertService.signalRecovery).toHaveBeenCalled();
  });

  it('does not hold back the recovery alert when the recovery signal could not be queued', async () => {
    const latest = {
      id: 'r1',
      consecutiveSuccessCount: 1,
      alertsSentForRecovery: 0,
      details: { recoverySequence: true },
    };
    const alertService = {
      sendNotification: jest.fn(async () => ({ delivered: true })),
      signalFailure: jest.fn(),
      signalRecovery: jest.fn(async () => false),
    };
    const evaluator = new MonitorEvaluator(
      {
        db: {
          query: { monitorResults: { findFirst: jest.fn(async () => latest) } },
          update: jest.fn(() => ({
            set: jest.fn(() => ({ where: jest.fn() })),
          })),
        },
      } as never,
      alertService as never,
    );
    const res = await evaluator.evaluateAndSendAlert({
      monitorId: 'm1',
      monitor: {
        alertConfig: { enabled: true, alertOnRecovery: true },
        config: {},
      } as never,
      previousStatus: 'down',
      currentStatus: 'up',
      reason: 'up',
      metadata: {},
    });
    expect(res).toEqual({ alertSent: true, alertType: 'recovery' });
    expect(alertService.sendNotification).toHaveBeenCalledTimes(1);
    expect(alertService.signalRecovery).toHaveBeenCalledTimes(1);
  });
});

describe('MonitorEvaluator reminder cadence details', () => {
  it('threshold 5: alerts at 5, 15, 35', async () => {
    expect(await alertCounts(5, 1, 100, true)).toEqual([5, 15, 35]);
  });

  it('never sends a 4th alert in a failure sequence', async () => {
    expect(await alertCounts(1, 1, 300, true)).toHaveLength(3);
  });

  it('keeps an undelivered reminder due on the next count', async () => {
    const outcomes = [false, true];
    const send = jest.fn(async () => ({ delivered: outcomes.shift() ?? true }));
    const evaluator = new MonitorEvaluator(
      { db: {} } as never,
      { sendNotification: send } as never,
    );
    jest
      .spyOn(evaluator as never, 'persistAggregatedAlertState')
      .mockResolvedValue(undefined as never);
    const attempts: number[] = [];
    for (const count of [5, 6, 7, 8]) {
      const before = send.mock.calls.length;
      const res = await evaluator.evaluateAndSendAlert({
        monitorId: 'm1',
        monitor: {
          alertConfig: {
            enabled: true,
            alertOnFailure: true,
            failureThreshold: 1,
          },
          config: {},
        } as never,
        previousStatus: 'down',
        currentStatus: 'down',
        reason: 'down',
        metadata: { locationResults: [{}, {}] },
        preparedAlertState: {
          consecutiveFailureCount: count,
          consecutiveSuccessCount: 0,
          alertsSentForFailure: 1,
          alertsSentForRecovery: 0,
        },
      });
      if (send.mock.calls.length > before) attempts.push(count);
      if (res.alertSent) break;
    }
    // Count 6 is the first reminder: undelivered, so it stays due and is retried at 7.
    expect(attempts).toEqual([6, 7]);
  });
});

describe('MonitorEvaluator.persistAggregatedAlertState', () => {
  it('writes only aggregatedAlertState, atomically, with or without a group id', async () => {
    const sets: SQL[] = [];
    const evaluator = new MonitorEvaluator(
      {
        db: {
          update: jest.fn(() => ({
            set: jest.fn((values: { config: SQL }) => {
              sets.push(values.config);
              return { where: jest.fn() };
            }),
          })),
        },
      } as never,
      {} as never,
    );
    const state = {
      consecutiveFailureCount: 1,
      consecutiveSuccessCount: 0,
      alertsSentForFailure: 0,
      alertsSentForRecovery: 0,
    };
    await evaluator.persistAggregatedAlertState('m1', state);
    await evaluator.persistAggregatedAlertState('m1', {
      ...state,
      executionGroupId: 'g1',
    });
    expect(sets).toHaveLength(2);
    for (const config of sets)
      expect(new PgDialect().sqlToQuery(config).sql).toContain('jsonb_set');
  });
});

describe('MonitorEvaluator alert windows (thresholds 1, 3, 5)', () => {
  // N = max(5, 2T): T=1 -> 5, T=3 -> 6, T=5 -> 10
  const cases: Array<[number, number]> = [
    [1, 5],
    [3, 6],
    [5, 10],
  ];

  it.each(cases)(
    'threshold %s: an unsent first alert is delivered in the first reminder window',
    async (threshold, n) => {
      const attempted: number[] = [];
      const fired: number[] = [];
      // all channels fail through the first window, then delivery works
      const evaluator = new MonitorEvaluator(
        { db: {} } as never,
        {
          sendNotification: jest.fn(async () => ({ delivered: true })),
        } as never,
      );
      jest
        .spyOn(evaluator as never, 'persistAggregatedAlertState')
        .mockResolvedValue(undefined as never);
      let sent = 0;
      for (let count = threshold; count <= threshold + 2 * n; count++) {
        const send = (
          evaluator['monitorAlertService'] as unknown as {
            sendNotification: jest.Mock;
          }
        ).sendNotification;
        send.mockImplementation(async () => {
          attempted.push(count);
          return { delivered: count >= threshold + n };
        });
        const res = await evaluator.evaluateAndSendAlert({
          monitorId: 'm1',
          monitor: {
            alertConfig: {
              enabled: true,
              alertOnFailure: true,
              failureThreshold: threshold,
            },
            config: {},
          } as never,
          previousStatus: 'down',
          currentStatus: 'down',
          reason: 'down',
          metadata: { locationResults: [{}, {}] },
          preparedAlertState: {
            consecutiveFailureCount: count,
            consecutiveSuccessCount: 0,
            alertsSentForFailure: sent,
            alertsSentForRecovery: 0,
          },
        });
        if (res.alertSent) {
          sent++;
          fired.push(count);
        }
      }
      expect(attempted.slice(0, n)).toEqual(
        Array.from({ length: n }, (_, i) => threshold + i),
      );
      expect(fired[0]).toBe(threshold + n);
    },
  );

  it.each(cases)(
    'threshold %s: a late reminder 1 does not make reminder 2 fire on the next check',
    async (threshold, n) => {
      // reminder 1 delivered on the last count of its window
      const lastOfWindow1 = threshold + n + (n - 1);
      const fired = await alertCountsWhere(
        threshold,
        (c, sent) => sent !== 1 || c >= lastOfWindow1,
        threshold + 10 * n,
      );
      // the next alert keeps the full 2N gap after the actual delivery
      expect(fired).toEqual([threshold, lastOfWindow1, lastOfWindow1 + 2 * n]);
      expect(fired[1] - fired[0]).toBeGreaterThanOrEqual(n);
      expect(fired[2] - fired[1]).toBeGreaterThanOrEqual(2 * n);
    },
  );

  it.each(cases)(
    'threshold %s: no reminder is retried after its window closes',
    async (threshold, n) => {
      // reminder 1 never delivers; reminder 2 still waits for its own window
      const attempted: number[] = [];
      const fired = await alertCountsWhere(
        threshold,
        (_c, sent) => sent !== 1,
        threshold + 10 * n,
        attempted,
      );
      expect(fired).toEqual([threshold]);
      expect(
        attempted.filter(
          (c) => c >= threshold + 2 * n && c < threshold + 3 * n,
        ),
      ).toEqual([]);
    },
  );
});

describe('MonitorEvaluator late first alert consumes its window', () => {
  it('threshold 1: first alert fails at 1-5, delivers at 6, next alert at 16 not 7', async () => {
    const fired = await alertCountsWhere(1, (c) => c >= 6, 40);
    expect(fired).toEqual([6, 16]);
  });

  it('threshold 1: an alert delivered in the last window caps the sequence', async () => {
    const fired = await alertCountsWhere(1, (c) => c >= 16, 100);
    expect(fired).toEqual([16]);
  });
});

/** Failure counts that alerted (multi-location, carrying the persisted state), given which counts can deliver. */
async function alertCountsWhere(
  threshold: number,
  deliversAt: (count: number, alertsSoFar: number) => boolean,
  upTo: number,
  attempted: number[] = [],
) {
  const send = jest.fn();
  const evaluator = new MonitorEvaluator(
    { db: {} } as never,
    { sendNotification: send } as never,
  );
  let persisted: Record<string, number> = { alertsSentForFailure: 0 };
  jest
    .spyOn(evaluator as never, 'persistAggregatedAlertState')
    .mockImplementation((async (_id: string, state: Record<string, number>) => {
      persisted = state;
    }) as never);
  const fired: number[] = [];
  for (let count = threshold; count <= upTo; count++) {
    send.mockImplementation(async () => {
      attempted.push(count);
      return { delivered: deliversAt(count, fired.length) };
    });
    const res = await evaluator.evaluateAndSendAlert({
      monitorId: 'm1',
      monitor: {
        alertConfig: {
          enabled: true,
          alertOnFailure: true,
          failureThreshold: threshold,
        },
        config: {},
      } as never,
      previousStatus: 'down',
      currentStatus: 'down',
      reason: 'down',
      metadata: { locationResults: [{}, {}] },
      preparedAlertState: {
        alertsSentForRecovery: 0,
        ...persisted,
        consecutiveFailureCount: count,
        consecutiveSuccessCount: 0,
        alertsSentForFailure: persisted.alertsSentForFailure,
      },
    });
    if (res.alertSent) fired.push(count);
  }
  return fired;
}

describe('MonitorEvaluator keeps the scheduled gap after a late delivery', () => {
  it.each([
    [1, 5],
    [3, 6],
    [5, 10],
  ])(
    'threshold %s: first alert delivered on the last count of window 0 is followed by one at least N later',
    async (threshold, n) => {
      const last = threshold + n - 1;
      const fired = await alertCountsWhere(
        threshold,
        (c, sent) => sent !== 0 || c >= last,
        threshold + 12 * n,
      );
      expect(fired[0]).toBe(last);
      expect(fired[1]).toBeGreaterThanOrEqual(last + n);
      expect(fired[2] - fired[1]).toBeGreaterThanOrEqual(2 * n);
      expect(fired).toHaveLength(3);
    },
  );
});

describe('single-location last alert count', () => {
  const run = async (lastAlertCount?: number) => {
    const configWrites: SQL[] = [];
    const evaluator = new MonitorEvaluator(
      {
        db: {
          query: {
            monitorResults: {
              findFirst: jest.fn(async () => ({
                id: 'r1',
                consecutiveFailureCount: 10,
                alertsSentForFailure: 1,
              })),
            },
          },
          update: jest.fn(() => ({
            set: jest.fn((values: { config?: SQL }) => {
              if (values.config) configWrites.push(values.config);
              return { where: jest.fn() };
            }),
          })),
        },
      } as never,
      { sendNotification: jest.fn(async () => ({ delivered: true })) } as never,
    );
    const res = await evaluator.evaluateAndSendAlert({
      monitorId: 'm1',
      monitor: {
        alertConfig: {
          enabled: true,
          alertOnFailure: true,
          failureThreshold: 1,
        },
        config:
          lastAlertCount === undefined
            ? {}
            : {
                aggregatedAlertState: {
                  lastAlertCount,
                  lastAlertWindows: 1,
                  alertCounterVersion: 2,
                },
              },
      } as never,
      previousStatus: 'down',
      currentStatus: 'down',
      reason: 'down',
      metadata: {},
    });
    return { res, configWrites };
  };

  it('stores the delivery count in config.aggregatedAlertState', async () => {
    const { res, configWrites } = await run();
    expect(res.alertSent).toBe(true);
    expect(configWrites).toHaveLength(1);
    const q = new PgDialect().sqlToQuery(configWrites[0]);
    expect(q.sql).toContain('jsonb_build_object');
    expect(q.params).toContain(10);
  });

  it('holds the next alert back when the last one was delivered late', async () => {
    // reminder 1 (window 1, count 10) was delivered at count 9: reminder 2 waits 2N after that
    const { res } = await run(9);
    expect(res.alertSent).toBe(false);
  });
});

describe('alert counter versioning and monotonic writes', () => {
  const state = (extra: object, sent = 1) => ({
    consecutiveFailureCount: 9,
    consecutiveSuccessCount: 0,
    alertsSentForFailure: sent,
    alertsSentForRecovery: 0,
    ...extra,
  });
  const decide = async (preparedAlertState: object) => {
    const send = jest.fn(async () => ({ delivered: true }));
    const evaluator = new MonitorEvaluator(
      { db: {} } as never,
      { sendNotification: send } as never,
    );
    jest
      .spyOn(evaluator as never, 'persistAggregatedAlertState')
      .mockResolvedValue(undefined as never);
    await evaluator.evaluateAndSendAlert({
      monitorId: 'm1',
      monitor: {
        alertConfig: {
          enabled: true,
          alertOnFailure: true,
          failureThreshold: 1,
        },
        config: {},
      } as never,
      previousStatus: 'down',
      currentStatus: 'down',
      reason: 'down',
      metadata: { locationResults: [{}, {}] },
      preparedAlertState: preparedAlertState as never,
    });
    return send.mock.calls.length;
  };

  it('treats an unversioned counter as an older worker count and ignores a stale lastAlertCount', async () => {
    // count 9 is inside window 1 (5..9 after threshold 1); a stale lastAlertCount of 8 would hold it back,
    // an unversioned state ignores it and follows the older schedule.
    expect(await decide(state({ lastAlertCount: 8 }))).toBe(1);
  });

  it('trusts lastAlertCount only with the current version and matching counter', async () => {
    const v2 = {
      alertCounterVersion: 2,
      lastAlertCount: 8,
      lastAlertWindows: 1,
    };
    expect(await decide(state(v2))).toBe(0);
    // an older worker bumped the counter since: the marker no longer matches
    expect(await decide(state(v2, 2))).toBe(0); // window 2 starts later
    expect(await decide(state({ ...v2, lastAlertWindows: 0 }))).toBe(1);
  });

  it('writes the failure counter monotonically', async () => {
    const sets: SQL[] = [];
    const evaluator = new MonitorEvaluator(
      {
        db: {
          update: jest.fn(() => ({
            set: jest.fn((v: { config: SQL }) => {
              sets.push(v.config);
              return { where: jest.fn() };
            }),
          })),
        },
      } as never,
      {} as never,
    );
    await evaluator.persistAggregatedAlertState('m1', state({}), {
      monotonicFailureCounter: true,
    });
    await evaluator.persistAggregatedAlertState('m1', state({}));
    expect(new PgDialect().sqlToQuery(sets[0]).sql).toContain('GREATEST');
    expect(new PgDialect().sqlToQuery(sets[1]).sql).not.toContain('GREATEST');
  });

  it('single-location counter write uses GREATEST and records the version', async () => {
    const writes: SQL[] = [];
    const evaluator = new MonitorEvaluator(
      {
        db: {
          query: {
            monitorResults: {
              findFirst: jest.fn(async () => ({
                id: 'r1',
                consecutiveFailureCount: 1,
                alertsSentForFailure: 0,
              })),
            },
          },
          update: jest.fn(() => ({
            set: jest.fn((v: Record<string, SQL>) => {
              for (const value of Object.values(v)) writes.push(value);
              return { where: jest.fn() };
            }),
          })),
        },
      } as never,
      { sendNotification: jest.fn(async () => ({ delivered: true })) } as never,
    );
    await evaluator.evaluateAndSendAlert({
      monitorId: 'm1',
      monitor: {
        alertConfig: {
          enabled: true,
          alertOnFailure: true,
          failureThreshold: 1,
        },
        config: {},
      } as never,
      previousStatus: 'down',
      currentStatus: 'down',
      reason: 'down',
      metadata: {},
    });
    const sql = writes.map((w) => new PgDialect().sqlToQuery(w).sql).join(' ');
    expect(sql).toContain('GREATEST');
    expect(sql).toContain('alertCounterVersion');
  });
});

describe('state carry-over across outages', () => {
  const evaluator = new MonitorEvaluator({ db: {} } as never, {} as never);
  const alerted = {
    consecutiveFailureCount: 12,
    consecutiveSuccessCount: 0,
    alertsSentForFailure: 2,
    alertsSentForRecovery: 0,
    lastAlertCount: 11,
    lastAlertWindows: 2,
    alertCounterVersion: 2 as const,
  };

  it('drops the alert markers when the sequence goes up and starts a new outage', () => {
    const up = evaluator.getNextAggregatedAlertState(alerted, 'down', 'up');
    expect(up).not.toHaveProperty('lastAlertCount');
    expect(up).not.toHaveProperty('lastAlertWindows');
    expect(up).not.toHaveProperty('alertCounterVersion');
    expect(up.alertsSentForFailure).toBe(0);
    const down = evaluator.getNextAggregatedAlertState(up, 'up', 'down');
    expect(down).toMatchObject({
      consecutiveFailureCount: 1,
      alertsSentForFailure: 0,
    });
    expect(down).not.toHaveProperty('lastAlertCount');
  });

  it('keeps the markers while the same outage continues', () => {
    const next = evaluator.getNextAggregatedAlertState(alerted, 'down', 'down');
    expect(next).toMatchObject({
      lastAlertCount: 11,
      lastAlertWindows: 2,
      alertCounterVersion: 2,
    });
  });

  it('outage, recovery and a new outage: the new first alert is not suppressed', async () => {
    const send = jest.fn(async () => ({ delivered: true }));
    const ev = new MonitorEvaluator(
      { db: {} } as never,
      { sendNotification: send, signalRecovery: jest.fn() } as never,
    );
    const monitor = {
      alertConfig: {
        enabled: true,
        alertOnFailure: true,
        alertOnRecovery: true,
        failureThreshold: 1,
        recoveryThreshold: 1,
      },
      config: {},
    } as never;
    jest
      .spyOn(ev as never, 'persistAggregatedAlertState')
      .mockResolvedValue(undefined as never);
    // recovery of the old outage, then a new outage whose state is derived from it
    const recovered = ev.getNextAggregatedAlertState(alerted, 'down', 'up');
    const fresh = ev.getNextAggregatedAlertState(recovered, 'up', 'down');
    const res = await ev.evaluateAndSendAlert({
      monitorId: 'm1',
      monitor,
      previousStatus: 'up',
      currentStatus: 'down',
      reason: 'down',
      metadata: { locationResults: [{}, {}] },
      preparedAlertState: fresh,
    });
    expect(res).toEqual({ alertSent: true, alertType: 'failure' });
  });

  it('a manual run (no group id) writes the counter without GREATEST', async () => {
    const sets: SQL[] = [];
    const ev = new MonitorEvaluator(
      {
        db: {
          update: jest.fn(() => ({
            set: jest.fn((v: { config: SQL }) => {
              sets.push(v.config);
              return { where: jest.fn() };
            }),
          })),
        },
      } as never,
      {
        sendNotification: jest.fn(async () => ({ delivered: true })),
      } as never,
    );
    const call = (preparedAlertState?: object) =>
      ev.evaluateAndSendAlert({
        monitorId: 'm1',
        monitor: {
          alertConfig: {
            enabled: true,
            alertOnFailure: true,
            failureThreshold: 1,
          },
          config: {},
        } as never,
        previousStatus: 'up',
        currentStatus: 'down',
        reason: 'down',
        metadata: { locationResults: [{}, {}] },
        preparedAlertState: preparedAlertState as never,
      });
    await call();
    await call({
      consecutiveFailureCount: 1,
      consecutiveSuccessCount: 0,
      alertsSentForFailure: 0,
      alertsSentForRecovery: 0,
      executionGroupId: 'g1',
    });
    const q = sets.map((c) => new PgDialect().sqlToQuery(c).sql);
    // The manual run persists its freshly minted outage key before sending, then the counters after.
    expect(q).toHaveLength(3);
    expect(q[0]).not.toContain('GREATEST');
    expect(q[1]).not.toContain('GREATEST');
    expect(q[2]).toContain('GREATEST');
  });
});

describe('MonitorEvaluator.checkSslExpirationAlert', () => {
  const run = async (details: Record<string, unknown>, isUp = true) => {
    const alertService = {
      sendSslExpirationNotification: jest.fn(async () => true),
    };
    const evaluator = new MonitorEvaluator(
      { db: {} } as never,
      alertService as never,
    );
    jest.spyOn(evaluator, 'getLastSslAlert').mockResolvedValue(null);
    await evaluator.checkSslExpirationAlert(
      { monitorId: 'm1', details, responseTimeMs: 1, isUp } as never,
      {
        alertConfig: { enabled: true, alertOnSslExpiration: true },
        config: { sslDaysUntilExpirationWarning: 30 },
      } as never,
    );
    return alertService.sendSslExpirationNotification;
  };

  it('does not send an expiry alert for a probe that read no certificate', async () => {
    const send = await run({
      sslWarning: 'SSL check could not complete: SSL connection timeout',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('alerts when the certificate probe has failed for a day while the site is up', async () => {
    const send = await run({
      sslWarning: 'SSL check could not complete: timeout',
      sslProbeFailedSince: new Date(Date.now() - 25 * 3_600_000).toISOString(),
    });
    expect(send).toHaveBeenCalledWith(
      'm1',
      'SSL certificate could not be read for 25 hours',
      expect.anything(),
    );
  });

  it('does not add an SSL warning while the site itself is down', async () => {
    const send = await run(
      {
        sslProbeFailedSince: new Date(
          Date.now() - 72 * 3_600_000,
        ).toISOString(),
      },
      false,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('stays quiet while the probe has failed for less than a day', async () => {
    const send = await run({
      sslProbeFailedSince: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('passes the check time to the SSL alert', async () => {
    const alertService = {
      sendSslExpirationNotification: jest.fn(async () => true),
    };
    const evaluator = new MonitorEvaluator(
      { db: {} } as never,
      alertService as never,
    );
    jest.spyOn(evaluator, 'getLastSslAlert').mockResolvedValue(null);
    const checkedAt = new Date('2026-11-09T10:00:00.000Z');
    await evaluator.checkSslExpirationAlert(
      {
        monitorId: 'm1',
        details: { sslCertificate: { valid: true, daysRemaining: 10 } },
        responseTimeMs: 1,
        isUp: true,
        checkedAt,
      } as never,
      {
        alertConfig: { enabled: true, alertOnSslExpiration: true },
        config: { sslDaysUntilExpirationWarning: 30 },
      } as never,
    );
    expect(alertService.sendSslExpirationNotification).toHaveBeenCalledWith(
      'm1',
      expect.any(String),
      expect.objectContaining({ observedAt: checkedAt }),
    );
  });

  it('alerts from a certificate inside the warning window', async () => {
    const send = await run({
      sslCertificate: { valid: true, daysRemaining: 10 },
    });
    expect(send).toHaveBeenCalledWith(
      'm1',
      'SSL certificate expires in 10 days',
      expect.anything(),
    );
  });
});

describe('outage key in aggregated alert state', () => {
  const evaluator = new MonitorEvaluator({ db: {} } as never, {} as never);
  const KEY = '0194a1c0-0000-7000-8000-000000000001';
  const base = {
    consecutiveFailureCount: 3,
    consecutiveSuccessCount: 0,
    alertsSentForFailure: 0,
    alertsSentForRecovery: 0,
  };

  it('mints a key where a failure sequence starts and keeps it while it continues', () => {
    const first = evaluator.getNextAggregatedAlertState(base, 'up', 'down');
    expect(first.outageKey).toMatch(/^[0-9a-f-]{36}$/);
    const second = evaluator.getNextAggregatedAlertState(first, 'down', 'down');
    expect(second.outageKey).toBe(first.outageKey);
    // A different outage never reuses the key, even from the same stored state.
    expect(
      evaluator.getNextAggregatedAlertState(first, 'up', 'down').outageKey,
    ).not.toBe(first.outageKey);
  });

  it('a new outage never reuses the key of a recovered one, even from an up-state frozen with it', () => {
    const k1 = evaluator.getNextAggregatedAlertState(
      base,
      'up',
      'down',
    ).outageKey;
    const recovered = evaluator.getNextAggregatedAlertState(
      { ...base, outageKey: k1, alertsSentForFailure: 1 },
      'down',
      'up',
    );
    expect(recovered.outageKey).toBe(k1);
    // Status says down (e.g. counting was skipped after the recovery) but the state is the up-state.
    const next = evaluator.getNextAggregatedAlertState(
      recovered,
      'down',
      'down',
    );
    expect(next.consecutiveFailureCount).toBe(1);
    expect(next.outageKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(next.outageKey).not.toBe(k1);
  });

  it('gives a sequence that has no key one when counting resumes mid-outage', () => {
    const next = evaluator.getNextAggregatedAlertState(base, 'down', 'down');
    expect(next.outageKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('the recovery keeps the key of the outage it ends, until the next outage', () => {
    const up = evaluator.getNextAggregatedAlertState(
      { ...base, outageKey: KEY },
      'down',
      'up',
    );
    expect(up.outageKey).toBe(KEY);
    expect(
      evaluator.getNextAggregatedAlertState(up, 'up', 'up').outageKey,
    ).toBe(KEY);
    // No key to carry (older state): none is invented for a recovery.
    expect(
      evaluator.getNextAggregatedAlertState(base, 'down', 'up').outageKey,
    ).toBeUndefined();
  });

  it('drops the key for cycles that were not counted, so a later outage cannot reuse it', () => {
    const state = evaluator.advanceAggregatedAlertState(
      false,
      { aggregatedAlertState: { ...base, outageKey: KEY } },
      'down',
      'down',
    );
    expect(state.outageKey).toBeUndefined();
    expect(state.failureCountUnknown).toBe(true);
  });

  it('reads only a well-formed key back from stored state', () => {
    const read = (outageKey: unknown) =>
      evaluator.readAggregatedAlertState({
        aggregatedAlertState: { ...base, outageKey },
      }).outageKey;
    expect(read(KEY)).toBe(KEY);
    expect(read('not-a-uuid')).toBeUndefined();
    expect(read(7)).toBeUndefined();
  });
});

describe('claims passed with alerts', () => {
  const KEY = '0194a1c0-0000-7000-8000-000000000002';
  const alertConfig = {
    enabled: true,
    alertOnFailure: true,
    alertOnRecovery: true,
    failureThreshold: 1,
    recoveryThreshold: 1,
  };

  function setup(notification: Record<string, unknown>, ac = alertConfig) {
    const latest = {
      id: 'r1',
      consecutiveFailureCount: 1,
      consecutiveSuccessCount: 0,
      alertsSentForFailure: 0,
      alertsSentForRecovery: 0,
      details: { outageKey: KEY } as Record<string, unknown>,
    };
    const dbService = {
      db: {
        query: { monitorResults: { findFirst: jest.fn(async () => latest) } },
        update: jest.fn(() => ({
          set: jest.fn(() => ({ where: jest.fn() })),
        })),
      },
    };
    const alertService = {
      sendNotification: jest.fn(async () => notification),
      signalFailure: jest.fn(async () => ({ delivered: false })),
      signalRecovery: jest.fn(async () => true),
    };
    const evaluator = new MonitorEvaluator(
      dbService as never,
      alertService as never,
    );
    const persist = jest
      .spyOn(evaluator, 'persistAggregatedAlertState')
      .mockResolvedValue(undefined);
    const call = (over: Record<string, unknown> = {}) =>
      evaluator.evaluateAndSendAlert({
        monitorId: 'm1',
        monitor: { alertConfig: ac, config: {} } as never,
        previousStatus: 'down',
        currentStatus: 'down',
        reason: 'down',
        metadata: {},
        ...over,
      } as never);
    return { latest, alertService, persist, call, dbService };
  }

  it('claims window j of the result row outage key for a failure alert', async () => {
    const { alertService, call } = setup({ delivered: true });
    await call();
    expect(alertService.sendNotification).toHaveBeenCalledWith(
      'm1',
      'failure',
      'down',
      expect.anything(),
      { outageKey: KEY, ordinal: 0 },
    );
  });

  it('ignores a malformed key on the result row and sends unclaimed', async () => {
    const { alertService, call, latest } = setup({ delivered: true });
    latest.details.outageKey = 'nope';
    await call();
    expect(alertService.sendNotification).toHaveBeenCalledWith(
      'm1',
      'failure',
      'down',
      expect.anything(),
      undefined,
    );
  });

  it('claims ordinal 0 for the recovery alert', async () => {
    const { alertService, call, latest } = setup({ delivered: true });
    latest.consecutiveFailureCount = 0;
    latest.consecutiveSuccessCount = 1;
    await call({ previousStatus: 'down', currentStatus: 'up' });
    expect(alertService.sendNotification).toHaveBeenCalledWith(
      'm1',
      'recovery',
      'down',
      expect.anything(),
      { outageKey: KEY, ordinal: 0 },
    );
  });

  it('makes no claim for an incident-only monitor', async () => {
    const { alertService, call } = setup({}, {
      enabled: false,
      incidentEnabled: true,
    } as never);
    await call();
    expect(alertService.signalFailure).toHaveBeenCalled();
    expect(alertService.sendNotification).not.toHaveBeenCalled();
  });

  it('catches the counters up, without reporting a send, when every provider already had the alert', async () => {
    const { call, dbService, alertService } = setup({
      delivered: true,
      alreadySent: true,
    });
    const res = await call();
    expect(res).toEqual({ alertSent: false });
    expect(alertService.sendNotification).toHaveBeenCalledTimes(1);
    // The window is consumed on the result row (GREATEST) like a normal delivery.
    expect(dbService.db.update).toHaveBeenCalled();
  });

  it('treats an alert another evaluator is sending as neither delivered nor failed', async () => {
    const { call, dbService } = setup({
      delivered: false,
      suppressed: true,
      reason: 'claimed',
    });
    expect(await call()).toEqual({ alertSent: false });
    expect(dbService.db.update).not.toHaveBeenCalled();
  });

  it('retries a recovery held by another evaluator, since it has no later window to fall back on', async () => {
    const { call, latest } = setup({
      delivered: false,
      suppressed: true,
      reason: 'claimed',
    });
    latest.consecutiveFailureCount = 0;
    latest.consecutiveSuccessCount = 1;
    expect(await call({ previousStatus: 'down', currentStatus: 'up' })).toEqual(
      {
        alertSent: false,
        deliveryFailed: true,
      },
    );
  });

  it('persists a key it minted for a manual multi-location run before sending under it', async () => {
    const { call, persist, alertService } = setup({ delivered: true });
    await call({ metadata: { locationResults: [{}, {}] } });
    const order = [
      persist.mock.invocationCallOrder[0],
      alertService.sendNotification.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]);
    expect(persist.mock.calls[0][1]).toMatchObject({
      outageKey: expect.any(String),
    });
  });
});

describe('SSL renewed notice', () => {
  const STATE_ID = '0194a1c0-0000-7000-8000-000000000003';
  const warned = {
    id: STATE_ID,
    host: 'example.com',
    validTo: '2026-12-01T00:00:00.000Z',
    warnedAt: '2026-11-20T00:00:00.000Z',
  };
  const healthy = {
    valid: true,
    daysRemaining: 80,
    validTo: '2027-02-01T00:00:00.000Z',
  };

  function setup(
    opts: { delivered?: boolean; gaveUp?: boolean; dbFails?: boolean } = {},
  ) {
    const sets: SQL[] = [];
    const update = jest.fn(() => ({
      set: jest.fn((v: { config: SQL }) => {
        sets.push(v.config);
        return {
          where: opts.dbFails
            ? jest.fn(async () => {
                throw new Error('db down');
              })
            : jest.fn(),
        };
      }),
    }));
    const alertService = {
      sendSslExpirationNotification: jest.fn(async () => true),
      sendSslRenewedNotification: jest.fn(async () => ({
        delivered: opts.delivered ?? true,
        ...(opts.gaveUp ? { gaveUp: true } : {}),
      })),
    };
    const evaluator = new MonitorEvaluator(
      { db: { update } } as never,
      alertService as never,
    );
    jest.spyOn(evaluator, 'getLastSslAlert').mockResolvedValue(null);
    const check = (
      certificate: Record<string, unknown> | undefined,
      config: Record<string, unknown> = { sslAlertState: warned },
      target = 'https://example.com/health',
      alertConfig: Record<string, unknown> = {
        enabled: true,
        alertOnSslExpiration: true,
      },
    ) =>
      evaluator.checkSslExpirationAlert(
        {
          monitorId: 'm1',
          details: certificate ? { sslCertificate: certificate } : {},
          responseTimeMs: 1,
          isUp: true,
          checkedAt: new Date('2026-12-05T00:00:00Z'),
        } as never,
        {
          id: 'm1',
          target,
          alertConfig,
          config: {
            enableSslCheck: true,
            sslDaysUntilExpirationWarning: 30,
            ...config,
          },
        } as never,
      );
    return { alertService, check, sets, update };
  }

  it('sends one notice with the new expiry date, claimed under the warning id, and closes the warning', async () => {
    const { alertService, check, sets } = setup();
    await check(healthy);
    expect(alertService.sendSslRenewedNotification).toHaveBeenCalledWith(
      'm1',
      'SSL certificate renewed (valid until 2027-02-01)',
      expect.objectContaining({ daysRemaining: 80 }),
      { outageKey: STATE_ID, ordinal: 0 },
    );
    // The renewal consumed this read: no warning goes out beside it.
    expect(alertService.sendSslExpirationNotification).not.toHaveBeenCalled();
    expect(new PgDialect().sqlToQuery(sets[0]).sql).toContain(
      "- 'sslAlertState'",
    );
  });

  it('counts a later expiry as renewed even while still inside the warning window', async () => {
    const { alertService, check } = setup();
    await check({
      valid: true,
      daysRemaining: 20,
      validTo: '2026-12-25T00:00:00.000Z',
    });
    expect(alertService.sendSslRenewedNotification).toHaveBeenCalled();
  });

  it('does not call it renewed while the warned certificate is still the one in use', async () => {
    const { alertService, check } = setup();
    await check({ valid: true, daysRemaining: 10, validTo: warned.validTo });
    expect(alertService.sendSslRenewedNotification).not.toHaveBeenCalled();
    // The warning itself still goes out.
    expect(alertService.sendSslExpirationNotification).toHaveBeenCalled();
  });

  it('does not call the warned certificate renewed because the warning window was lowered', async () => {
    const { alertService, check } = setup();
    await check(
      { valid: true, daysRemaining: 40, validTo: warned.validTo },
      { sslAlertState: warned, sslDaysUntilExpirationWarning: 7 },
    );
    expect(alertService.sendSslRenewedNotification).not.toHaveBeenCalled();
  });

  it.each([
    ['an untrusted certificate', { ...healthy, valid: false }],
    ['an expired certificate', { ...healthy, daysRemaining: 0 }],
    ['a read with no day count', { valid: true, validTo: healthy.validTo }],
  ])('does not call %s renewed', async (_name, certificate) => {
    const { alertService, check } = setup();
    await check(certificate);
    expect(alertService.sendSslRenewedNotification).not.toHaveBeenCalled();
  });

  it('sends nothing when no warning was ever sent, or the read has no certificate', async () => {
    const { alertService, check } = setup();
    await check(healthy, {});
    await check(undefined);
    expect(alertService.sendSslRenewedNotification).not.toHaveBeenCalled();
  });

  it('ignores a stored state with a malformed id', async () => {
    const { alertService, check } = setup();
    await check(healthy, { sslAlertState: { ...warned, id: 'x' } });
    expect(alertService.sendSslRenewedNotification).not.toHaveBeenCalled();
  });

  it('drops the warning of another host instead of announcing a renewal for it', async () => {
    const { alertService, check, sets } = setup();
    await check(healthy, undefined, 'https://other.example.org');
    expect(alertService.sendSslRenewedNotification).not.toHaveBeenCalled();
    expect(new PgDialect().sqlToQuery(sets[0]).sql).toContain(
      "- 'sslAlertState'",
    );
  });

  it('keeps the warning open when the notice was not delivered, so the next read retries', async () => {
    const { check, update } = setup({ delivered: false });
    await check(healthy);
    expect(update).not.toHaveBeenCalled();
  });

  it('words the notice as readable again when the warning was that no certificate could be read', async () => {
    const { alertService, check } = setup();
    await check(healthy, {
      sslAlertState: { ...warned, validTo: undefined },
    });
    expect(alertService.sendSslRenewedNotification).toHaveBeenCalledWith(
      'm1',
      'SSL certificate readable again (valid until 2027-02-01)',
      expect.objectContaining({ readableAgain: true }),
      { outageKey: STATE_ID, ordinal: 0 },
    );
  });

  it('words the notice without a date when the certificate has none', async () => {
    const { alertService, check } = setup();
    await check(
      { valid: true, daysRemaining: 80, validTo: undefined },
      { sslAlertState: { ...warned, validTo: undefined } },
    );
    expect(alertService.sendSslRenewedNotification).toHaveBeenCalledWith(
      'm1',
      'SSL certificate readable again',
      expect.anything(),
      expect.anything(),
    );
  });

  it('clears the warning when the notice was given up, so it is not claimed on every check', async () => {
    const { check, sets } = setup({ delivered: false, gaveUp: true });
    await check(healthy);
    expect(sets).toHaveLength(1);
    expect(new PgDialect().sqlToQuery(sets[0]).sql).toContain(
      "- 'sslAlertState'",
    );
  });

  it.each([
    [
      'SSL alerts are turned off',
      { enabled: true, alertOnSslExpiration: false },
      { sslAlertState: warned, enableSslCheck: true },
    ],
    [
      'alerts are turned off',
      { enabled: false, alertOnSslExpiration: true },
      { sslAlertState: warned, enableSslCheck: true },
    ],
    [
      'SSL Check is turned off',
      { enabled: true, alertOnSslExpiration: true },
      { sslAlertState: warned, enableSslCheck: false },
    ],
  ])(
    'drops the stored warning when %s, so a stale notice cannot fire later',
    async (_name, alertConfig, config) => {
      const { alertService, check, sets } = setup();
      await check(healthy, config, undefined, alertConfig);
      expect(alertService.sendSslRenewedNotification).not.toHaveBeenCalled();
      expect(sets).toHaveLength(1);
      expect(new PgDialect().sqlToQuery(sets[0]).sql).toContain(
        "- 'sslAlertState'",
      );
    },
  );

  it('records the warning once delivered: same host keeps the first episode, a new host starts one', async () => {
    const { check, sets } = setup();
    await check({ valid: true, daysRemaining: 5, validTo: warned.validTo }, {});
    const q = new PgDialect().sqlToQuery(sets[0]);
    expect(q.sql).toContain("jsonb_build_object('sslAlertState'");
    expect(q.params).toEqual(expect.arrayContaining(['example.com']));
    expect(q.params.join(' ')).toContain(warned.validTo);
  });

  it('survives database errors while recording or clearing the warning state', async () => {
    const { alertService, check } = setup({ dbFails: true });
    await check(healthy);
    await check({ valid: true, daysRemaining: 5, validTo: warned.validTo }, {});
    expect(alertService.sendSslRenewedNotification).toHaveBeenCalled();
    expect(alertService.sendSslExpirationNotification).toHaveBeenCalled();
  });
});
