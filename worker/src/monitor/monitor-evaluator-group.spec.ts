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
  it.each([1, 2])(
    'counts the first non-pending failing cycle so threshold %i is reached on that cycle',
    async (threshold) => {
      const states = await firstAlertCycle(threshold, ['down', 'down', 'down']);
      expect(states.map((s) => s.failures)).toEqual([1, 2, 3]);
      expect(states.findIndex((s) => s.failures >= threshold) + 1).toBe(
        threshold,
      );
    },
  );

  it('counts the first successful cycle after pending', async () => {
    const states = await firstAlertCycle(1, ['up', 'up']);
    expect(states.map((s) => s.successes)).toEqual([1, 2]);
  });
});
