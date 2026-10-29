import { MonitorEvaluator } from './monitor-evaluator';

/** Runs prepareGroupEvaluation per cycle against an in-memory monitor row and returns the cycles that would alert. */
async function firstAlertCycle(
  failureThreshold: number,
  statuses: Array<'up' | 'down'>,
  initialStatus = 'pending',
) {
  const monitor: Record<string, unknown> = {
    id: 'm1',
    status: initialStatus,
    config: { locationConfig: { enabled: true, locations: ['a', 'b'] } },
    alertConfig: { enabled: true, alertOnFailure: true, failureThreshold },
  };
  let cycle = '';
  const resultRow = {
    id: 'r1',
    details: null as Record<string, unknown> | null,
  };
  const select = jest.fn().mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.for = () => [monitor];
    chain.then = (res: (v: unknown) => void) => res([resultRow]);
    return chain;
  });
  const tx = {
    select,
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          if ('status' in v) Object.assign(monitor, v);
          else resultRow.details = null;
        },
      }),
    }),
  };
  const dbService = {
    db: { transaction: (fn: (t: unknown) => unknown) => fn(tx) },
  };
  const evaluator = new MonitorEvaluator(dbService as never, {} as never);
  const states: Array<{ failures: number; successes: number }> = [];
  for (let i = 0; i < statuses.length; i++) {
    cycle = `g${i}`;
    const prepared = await evaluator.prepareGroupEvaluation(
      'm1',
      cycle,
      statuses[i],
      new Date(),
      2,
    );
    const s = prepared!.evaluation.alertState!;
    states.push({
      failures: s.consecutiveFailureCount,
      successes: s.consecutiveSuccessCount,
    });
  }
  return states;
}

describe('MonitorEvaluator.prepareGroupEvaluation multi-location counters', () => {
  it('counts the first failing cycle after pending as failure 1', async () => {
    const states = await firstAlertCycle(2, ['down', 'down', 'down']);
    expect(states.map((s) => s.failures)).toEqual([1, 2, 3]);
  });

  it('counts the first successful cycle after pending', async () => {
    const states = await firstAlertCycle(1, ['up', 'up']);
    expect(states.map((s) => s.successes)).toEqual([1, 2]);
  });
});

describe('MonitorEvaluator.advanceAggregatedAlertState', () => {
  const evaluator = new MonitorEvaluator({} as never, {} as never);
  const stale = {
    aggregatedAlertState: {
      consecutiveFailureCount: 9,
      consecutiveSuccessCount: 0,
      alertsSentForFailure: 3,
      alertsSentForRecovery: 0,
      recoverySequence: false,
    },
  } as never;

  it('starts a fresh failure sequence after pending, dropping stale sent counts', () => {
    expect(
      evaluator.advanceAggregatedAlertState(true, stale, 'pending', 'down'),
    ).toMatchObject({ consecutiveFailureCount: 1, alertsSentForFailure: 0 });
  });

  it('does not mark a pending to up cycle as a recovery', () => {
    expect(
      evaluator.advanceAggregatedAlertState(true, stale, 'pending', 'up'),
    ).toMatchObject({ consecutiveSuccessCount: 1, recoverySequence: false });
  });

  it.each([
    ['paused', true],
    ['down', false],
  ])(
    'leaves counters unchanged when previous status is %s and alerts enabled is %s',
    (previousStatus, enabled) => {
      expect(
        evaluator.advanceAggregatedAlertState(
          enabled,
          stale,
          previousStatus,
          'down',
        ),
      ).toMatchObject({ consecutiveFailureCount: 9, alertsSentForFailure: 3 });
    },
  );

  it('continues a down sequence', () => {
    expect(
      evaluator.advanceAggregatedAlertState(true, stale, 'down', 'down'),
    ).toMatchObject({ consecutiveFailureCount: 10, alertsSentForFailure: 3 });
  });
});
