import { MonitorEvaluator } from './monitor-evaluator';

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
    signalRecovery: jest.fn(),
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
