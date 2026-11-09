import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  MonitorEvaluator,
  isIncidentOnly,
  tracksAlertState,
} from './monitor-evaluator';

/** An update().where() result: awaitable, and `.returning()` reports one matched row. */
const matched = () =>
  Object.assign(Promise.resolve(undefined), {
    returning: jest.fn(async () => [{ id: 'row' }]),
  });

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
      update: jest.fn(() => ({
        set: jest.fn(() => ({ where: jest.fn(matched) })),
      })),
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
    // Only the first alert's bounded window: reminders need a delivered first alert.
    expect(attempted).toEqual([1, 2, 3, 4, 5]);
  });

  it.each([false, true])(
    'threshold 1: alerts at 1, then doubling reminders, capped at 3 (multi=%s)',
    async (multi) => {
      expect(await alertCounts(1, 1, 30, multi)).toEqual([1, 6, 16]);
    },
  );

  it.each([false, true])(
    'threshold 3: alerts at 3, then doubling reminders, capped at 3 (multi=%s)',
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
        update: jest.fn(() => ({
          set: jest.fn(() => ({ where: jest.fn(matched) })),
        })),
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
      if (values.alertsSentForRecovery !== undefined)
        recoveriesRecorded = values.alertsSentForRecovery;
      return { where: jest.fn(matched) };
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
    // The slot is recorded before the send and released when nothing was delivered.
    const persist = jest
      .spyOn(evaluator as never, 'writeAggregatedAlertState')
      .mockImplementation((async (
        _id: string,
        state: { alertsSentForRecovery: number },
      ) => {
        recoveriesRecorded = state.alertsSentForRecovery;
        return true;
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
        update: jest.fn(() => ({
          set: jest.fn(() => ({ where: jest.fn(matched) })),
        })),
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
            set: jest.fn(() => ({ where: jest.fn(matched) })),
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

describe('MonitorEvaluator delivered-alert bookkeeping', () => {
  const monitor = {
    alertConfig: { enabled: true, alertOnFailure: true, failureThreshold: 1 },
    config: { locationConfig: { enabled: true, locations: ['a', 'b'] } },
  } as never;
  const run = (evaluator: MonitorEvaluator, multi: boolean) =>
    evaluator.evaluateAndSendAlert({
      monitorId: 'm1',
      monitor,
      previousStatus: 'down',
      currentStatus: 'down',
      reason: 'down',
      metadata: multi ? { locationResults: [{}, {}] } : {},
      preparedAlertState: multi
        ? {
            consecutiveFailureCount: 1,
            consecutiveSuccessCount: 0,
            alertsSentForFailure: 0,
            alertsSentForRecovery: 0,
          }
        : undefined,
    });

  it.each([false, true])(
    'sends nothing when the alert counter cannot be recorded first (multi=%s)',
    async (multi) => {
      const dbService = {
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
          update: jest.fn(() => {
            throw new Error('db down');
          }),
        },
      };
      const alertService = { sendNotification: jest.fn() };
      const evaluator = new MonitorEvaluator(
        dbService as never,
        alertService as never,
      );
      await expect(run(evaluator, multi)).resolves.toEqual({
        alertSent: false,
        deliveryFailed: true,
      });
      expect(alertService.sendNotification).not.toHaveBeenCalled();
    },
  );

  it('keeps the slot used and reports a retry when only some channels failed', async () => {
    const writes: number[] = [];
    const dbService = {
      db: {
        update: jest.fn(() => ({
          set: jest.fn(() => ({ where: jest.fn(matched) })),
        })),
      },
    };
    const alertService = {
      sendNotification: jest.fn(async () => ({
        delivered: true,
        retryFailedChannels: true,
      })),
    };
    const evaluator = new MonitorEvaluator(
      dbService as never,
      alertService as never,
    );
    jest
      .spyOn(evaluator as never, 'writeAggregatedAlertState')
      .mockImplementation((async (
        _id: string,
        state: { alertsSentForFailure: number },
      ) => {
        writes.push(state.alertsSentForFailure);
        return true;
      }) as never);
    await expect(run(evaluator, true)).resolves.toEqual({
      alertSent: true,
      alertType: 'failure',
      deliveryFailed: true,
    });
    expect(writes).toEqual([1]);
  });

  it('writes only aggregatedAlertState, atomically, with or without a group id', async () => {
    const sets: unknown[] = [];
    const dbService = {
      db: {
        update: jest.fn(() => ({
          set: jest.fn((values: { config: SQL }) => {
            sets.push(values.config);
            return { where: jest.fn(matched) };
          }),
        })),
      },
    };
    const evaluator = new MonitorEvaluator(dbService as never, {} as never);
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
    for (const config of sets) {
      expect(new PgDialect().sqlToQuery(config as SQL).sql).toContain(
        'jsonb_set',
      );
    }
    expect(sets).toHaveLength(2);
  });
});

describe('MonitorEvaluator alert slot races and cadence', () => {
  const monitorFor = (failureThreshold: number) =>
    ({
      alertConfig: { enabled: true, alertOnFailure: true, failureThreshold },
      config: {},
    }) as never;

  /** Single-location harness: `updates` records each write; `rowsFor` sets how many rows each write matches. */
  function single(
    send: jest.Mock,
    rowsFor: (call: number) => number | Error = () => 1,
  ) {
    const updates: { set: unknown; where: SQL }[] = [];
    const dbService = {
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
          set: (set: unknown) => ({
            where: (where: SQL) => ({
              returning: async () => {
                updates.push({ set, where });
                const rows = rowsFor(updates.length);
                if (rows instanceof Error) throw rows;
                return Array.from({ length: rows }, () => ({ id: 'r1' }));
              },
            }),
          }),
        })),
      },
    };
    const evaluator = new MonitorEvaluator(
      dbService as never,
      {
        sendNotification: send,
      } as never,
    );
    const run = () =>
      evaluator.evaluateAndSendAlert({
        monitorId: 'm1',
        monitor: monitorFor(1),
        previousStatus: 'down',
        currentStatus: 'down',
        reason: 'down',
        metadata: {},
      });
    return { run, updates, evaluator };
  }

  it('skips the send when a newer cycle owns the counter (record matched no row)', async () => {
    const send = jest.fn();
    const { run } = single(send, () => 0);
    await expect(run()).resolves.toEqual({ alertSent: false });
    expect(send).not.toHaveBeenCalled();
  });

  describe('superseded multi-location group', () => {
    const superseded = async (ownerSent: number) => {
      const send = jest.fn().mockResolvedValue({ delivered: true });
      const evaluator = new MonitorEvaluator(
        {
          db: {
            query: {
              monitors: {
                findFirst: jest.fn(async () => ({
                  config: {
                    aggregatedAlertState: { alertsSentForFailure: ownerSent },
                  },
                })),
              },
            },
          },
        } as never,
        { sendNotification: send } as never,
      );
      jest
        .spyOn(evaluator as never, 'writeAggregatedAlertState')
        .mockResolvedValue(false as never);
      const res = await evaluator.evaluateAndSendAlert({
        monitorId: 'm1',
        monitor: monitorFor(1),
        previousStatus: 'down',
        currentStatus: 'down',
        reason: 'down',
        metadata: { locationResults: [{}, {}] },
        preparedAlertState: {
          consecutiveFailureCount: 1,
          consecutiveSuccessCount: 0,
          alertsSentForFailure: 0,
          alertsSentForRecovery: 0,
          executionGroupId: 'old',
        },
      });
      return { res, send };
    };

    it('skips the send when the newer cycle already alerted', async () => {
      const { res, send } = await superseded(1);
      expect(res).toEqual({ alertSent: false });
      expect(send).not.toHaveBeenCalled();
    });

    it('still sends a delayed alert the newer cycle did not send', async () => {
      const { res, send } = await superseded(0);
      expect(res).toEqual({ alertSent: true, alertType: 'failure' });
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  it('releases the slot when the send throws, with a release that only matches its own record', async () => {
    const send = jest.fn().mockRejectedValue(new Error('boom'));
    const { run, updates } = single(send);
    await expect(run()).resolves.toEqual({
      alertSent: false,
      deliveryFailed: true,
    });
    expect(updates.map((u) => u.set)).toEqual([
      { alertsSentForFailure: 1 },
      { alertsSentForFailure: 0 },
    ]);
    const release = new PgDialect().sqlToQuery(updates[1].where);
    expect(release.sql).toContain('"alerts_sent_for_failure" =');
    expect(release.params).toEqual(['r1', 1]);
  });

  it('still reports a failed delivery when the release itself throws', async () => {
    const send = jest.fn().mockResolvedValue({ delivered: false });
    const { run } = single(send, (call) =>
      call === 2 ? new Error('db down') : 1,
    );
    await expect(run()).resolves.toEqual({
      alertSent: false,
      deliveryFailed: true,
    });
  });

  it.each([
    [{ delivered: false, suppressed: true, reason: 'no_providers' }, false],
    [{ delivered: false, suppressed: true, reason: 'maintenance' }, false],
  ])('releases the slot for %j', async (outcome) => {
    const { run, updates } = single(jest.fn().mockResolvedValue(outcome));
    await expect(run()).resolves.toEqual({ alertSent: false });
    expect(updates.map((u) => u.set)).toEqual([
      { alertsSentForFailure: 1 },
      { alertsSentForFailure: 0 },
    ]);
  });

  it('keeps the slot after a delivered alert', async () => {
    const { run, updates } = single(
      jest.fn().mockResolvedValue({ delivered: true }),
    );
    await expect(run()).resolves.toEqual({
      alertSent: true,
      alertType: 'failure',
    });
    expect(updates).toHaveLength(1);
  });

  it('threshold 5: alerts at 5, 15, 35', async () => {
    expect(await alertCounts(5, 1, 100, true)).toEqual([5, 15, 35]);
  });

  it('never sends a 4th alert in a failure sequence', async () => {
    expect(await alertCounts(1, 1, 300, true)).toHaveLength(3);
  });

  it('keeps an undelivered reminder due on the next count', async () => {
    const attempts: number[] = [];
    const outcomes = [false, true];
    const send = jest.fn(async () => ({ delivered: outcomes.shift() ?? true }));
    const evaluator = new MonitorEvaluator(
      {} as never,
      {
        sendNotification: send,
      } as never,
    );
    jest
      .spyOn(evaluator as never, 'writeAggregatedAlertState')
      .mockResolvedValue(true as never);
    for (const count of [6, 7, 8]) {
      const res = await evaluator.evaluateAndSendAlert({
        monitorId: 'm1',
        monitor: monitorFor(1),
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
      if (send.mock.calls.length > attempts.length) attempts.push(count);
      if (res.alertSent) break;
    }
    // Count 6 is the first reminder: undelivered, retried at 7, delivered there.
    expect(attempts).toEqual([6, 7]);
  });
});

describe('MonitorEvaluator single-location retry of a partly delivered alert', () => {
  const run = (retryDelivery: boolean, alertsSentForFailure: number) => {
    const update = jest.fn();
    const send = jest.fn().mockResolvedValue({ delivered: true });
    const evaluator = new MonitorEvaluator(
      {
        db: {
          query: {
            monitorResults: {
              findFirst: jest.fn(async () => ({
                id: 'r1',
                consecutiveFailureCount: 1,
                alertsSentForFailure,
              })),
            },
          },
          update,
        },
      } as never,
      { sendNotification: send } as never,
    );
    return {
      send,
      update,
      result: evaluator.evaluateAndSendAlert({
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
        retryDelivery,
      }),
    };
  };

  it('re-sends to the failed channels without taking another slot', async () => {
    const { send, update, result } = run(true, 1);
    await expect(result).resolves.toEqual({
      alertSent: true,
      alertType: 'failure',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not re-send a used slot when it is not a retry', async () => {
    const { send, result } = run(false, 1);
    await expect(result).resolves.toEqual({ alertSent: false });
    expect(send).not.toHaveBeenCalled();
  });
});
