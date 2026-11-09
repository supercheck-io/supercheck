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
    // Every check up to the first reminder slot, then only the reminder boundaries.
    expect(attempted).toEqual([1, 2, 3, 4, 5, 6, 11, 16, 21, 26]);
  });

  it.each([false, true])(
    'threshold 1: alerts at 1, then reminders, capped at 3 (multi=%s)',
    async (multi) => {
      expect(await alertCounts(1, 1, 30, multi)).toEqual([1, 6, 11]);
    },
  );

  it.each([false, true])(
    'threshold 3: alerts at 3, then reminders, capped at 3 (multi=%s)',
    async (multi) => {
      expect(await alertCounts(3, 1, 40, multi)).toEqual([3, 9, 15]);
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
        _config: unknown,
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

describe('MonitorEvaluator.checkSslExpirationAlert', () => {
  const run = async (details: Record<string, unknown>) => {
    const alertService = {
      sendSslExpirationNotification: jest.fn(async () => true),
    };
    const evaluator = new MonitorEvaluator(
      { db: {} } as never,
      alertService as never,
    );
    jest.spyOn(evaluator, 'getLastSslAlert').mockResolvedValue(null);
    await evaluator.checkSslExpirationAlert(
      { monitorId: 'm1', details, responseTimeMs: 1 } as never,
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
