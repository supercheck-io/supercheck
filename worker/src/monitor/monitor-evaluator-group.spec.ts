import { MonitorEvaluator, type GroupReceipt } from './monitor-evaluator';
import * as schema from '../db/schema';

type ResultRow = {
  id: string;
  group: string;
  details: Record<string, unknown> | null;
};
type Receipt = {
  evaluation: Record<string, unknown>;
  notificationProcessedAt: Date | null;
};

/**
 * In-memory stand-in for the tables prepareGroupEvaluation touches. Drizzle conditions are opaque here, so
 * the fake scopes every read to the group passed to `use(group)`, which mirrors the per-group WHERE clauses.
 */
function fakeGroupStore(
  monitor: Record<string, unknown> | null,
  results: ResultRow[],
) {
  let group = '';
  const receipts = new Map<string, Receipt>();
  const writes = { monitor: 0, results: 0, inserts: 0 };
  const thenable = (rows: unknown[]) => ({
    then: (resolve: (v: unknown) => void) => resolve(rows),
    for: () => (monitor ? [monitor] : []),
  });
  const select = (fields?: Record<string, unknown>) => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: () => {
          if (table === schema.monitors) return thenable([monitor]);
          if (table === schema.monitorGroupEvaluations) {
            const receipt = receipts.get(group);
            return thenable(
              receipt
                ? [
                    {
                      evaluation: receipt.evaluation,
                      processedAt: receipt.notificationProcessedAt,
                    },
                  ]
                : [],
            );
          }
          const rows = results.filter((row) => row.group === group);
          if (fields && 'evaluation' in fields) {
            return thenable(
              rows
                .filter((row) => row.details?.aggregationEvaluation)
                .map((row) => ({
                  id: row.id,
                  evaluation: row.details!.aggregationEvaluation,
                  processed:
                    row.details!.aggregationNotificationProcessed === true,
                })),
            );
          }
          return thenable(rows.map((row) => ({ id: row.id })));
        },
      }),
    }),
  });
  const update = (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        if (table === schema.monitors) {
          writes.monitor++;
          Object.assign(monitor!, values);
        } else if (table === schema.monitorGroupEvaluations) {
          const receipt = receipts.get(group);
          if (receipt && !receipt.notificationProcessedAt)
            receipt.notificationProcessedAt =
              values.notificationProcessedAt as Date;
        } else {
          writes.results++;
          for (const row of results.filter(
            (r) => r.group === group && r.details?.aggregationEvaluation,
          ))
            row.details = {
              ...row.details,
              aggregationNotificationProcessed: true,
            };
        }
      },
    }),
  });
  const insert = (table: unknown) => ({
    values: async (values: Record<string, unknown>) => {
      expect(table).toBe(schema.monitorGroupEvaluations);
      if (receipts.has(values.executionGroupId as string))
        throw new Error('duplicate key value violates unique constraint');
      writes.inserts++;
      receipts.set(values.executionGroupId as string, {
        evaluation: values.evaluation as Record<string, unknown>,
        notificationProcessedAt: null,
      });
    },
  });
  const tx = { select, update, insert };
  const evaluator = new MonitorEvaluator(
    {
      db: {
        transaction: (fn: (t: unknown) => unknown) => fn(tx),
        update,
      },
    } as never,
    {} as never,
  );
  return {
    evaluator,
    receipts,
    writes,
    prepare(g: string, status: 'up' | 'down', resultCount = 2) {
      group = g;
      return evaluator.prepareGroupEvaluation(
        'm1',
        g,
        status,
        new Date('2026-11-12T10:00:00Z'),
        resultCount,
      );
    },
    markNotified(g: string, receipt: GroupReceipt) {
      group = g;
      return evaluator.markGroupNotified('m1', g, receipt);
    },
  };
}

const multiLocationMonitor = (
  status: string,
  failureThreshold = 1,
): Record<string, unknown> => ({
  id: 'm1',
  status,
  config: { locationConfig: { enabled: true, locations: ['a', 'b'] } },
  alertConfig: { enabled: true, alertOnFailure: true, failureThreshold },
});

const groupRows = (...groups: string[]): ResultRow[] =>
  groups.flatMap((group) => [
    { id: `${group}-a`, group, details: { responseBody: 'x' } },
    { id: `${group}-b`, group, details: null },
  ]);

describe('MonitorEvaluator.prepareGroupEvaluation multi-location counters', () => {
  async function counters(statuses: Array<'up' | 'down'>, threshold: number) {
    const groups = statuses.map((_, i) => `g${i}`);
    const store = fakeGroupStore(
      multiLocationMonitor('pending', threshold),
      groupRows(...groups),
    );
    const states: Array<{ failures: number; successes: number }> = [];
    for (let i = 0; i < statuses.length; i++) {
      const prepared = await store.prepare(groups[i], statuses[i]);
      const s = prepared!.evaluation.alertState!;
      states.push({
        failures: s.consecutiveFailureCount,
        successes: s.consecutiveSuccessCount,
      });
    }
    return states;
  }

  it('counts the first failing cycle after pending as failure 1', async () => {
    const states = await counters(['down', 'down', 'down'], 2);
    expect(states.map((s) => s.failures)).toEqual([1, 2, 3]);
  });

  it('counts the first successful cycle after pending', async () => {
    const states = await counters(['up', 'up'], 1);
    expect(states.map((s) => s.successes)).toEqual([1, 2]);
  });
});

describe('MonitorEvaluator.prepareGroupEvaluation paused monitor', () => {
  it('keeps a monitor paused mid-cycle paused and does not stamp a status change', async () => {
    const monitor = multiLocationMonitor('paused');
    const store = fakeGroupStore(monitor, groupRows('g1'));
    await store.prepare('g1', 'up');
    expect(monitor.status).toBe('paused');
    expect(monitor.lastStatusChangeAt).toBeUndefined();
  });
});

describe('MonitorEvaluator group receipt', () => {
  it('records a new group in its own receipt and never rewrites a result row', async () => {
    const monitor = multiLocationMonitor('up');
    const rows = groupRows('g1');
    const before = JSON.stringify(rows);
    const store = fakeGroupStore(monitor, rows);
    const prepared = await store.prepare('g1', 'down');
    expect(prepared).toMatchObject({
      receipt: { kind: 'group' },
      evaluation: { previousStatus: 'up', currentStatus: 'down' },
    });
    expect(store.receipts.get('g1')).toMatchObject({
      evaluation: { previousStatus: 'up', currentStatus: 'down' },
      notificationProcessedAt: null,
    });
    expect(store.writes).toEqual({ monitor: 1, results: 0, inserts: 1 });
    expect(JSON.stringify(rows)).toBe(before);
    expect(monitor.status).toBe('down');
  });

  it('resumes an unprocessed receipt without advancing the counters again (crash before notifying)', async () => {
    const store = fakeGroupStore(multiLocationMonitor('up'), groupRows('g1'));
    const first = await store.prepare('g1', 'down');
    const retry = await store.prepare('g1', 'down');
    expect(retry!.evaluation).toEqual(first!.evaluation);
    expect(retry!.receipt).toEqual({ kind: 'group' });
    expect(store.writes).toEqual({ monitor: 1, results: 0, inserts: 1 });
  });

  it('returns null for a group whose alerts were already handled', async () => {
    const store = fakeGroupStore(multiLocationMonitor('up'), groupRows('g1'));
    const prepared = await store.prepare('g1', 'down');
    await store.markNotified('g1', prepared!.receipt);
    expect(store.receipts.get('g1')!.notificationProcessedAt).toBeInstanceOf(
      Date,
    );
    await expect(store.prepare('g1', 'down')).resolves.toBeNull();
    expect(store.writes).toEqual({ monitor: 1, results: 0, inserts: 1 });
  });

  it('keeps the first processed time when marked twice', async () => {
    const store = fakeGroupStore(multiLocationMonitor('up'), groupRows('g1'));
    const prepared = await store.prepare('g1', 'down');
    await store.markNotified('g1', prepared!.receipt);
    const first = store.receipts.get('g1')!.notificationProcessedAt;
    await store.markNotified('g1', prepared!.receipt);
    expect(store.receipts.get('g1')!.notificationProcessedAt).toBe(first);
  });

  it('throws without writing anything when the group has no persisted result', async () => {
    const monitor = multiLocationMonitor('up');
    const store = fakeGroupStore(monitor, groupRows('other'));
    await expect(store.prepare('g1', 'down')).rejects.toThrow(
      'Persisted aggregation group is missing',
    );
    expect(store.writes).toEqual({ monitor: 0, results: 0, inserts: 0 });
    expect(monitor.status).toBe('up');
  });

  it('returns null for a deleted monitor', async () => {
    const store = fakeGroupStore(null, groupRows('g1'));
    await expect(store.prepare('g1', 'down')).resolves.toBeNull();
    expect(store.writes).toEqual({ monitor: 0, results: 0, inserts: 0 });
  });
});

describe('MonitorEvaluator legacy receipt (groups evaluated by older workers)', () => {
  const legacyRows = (processed: boolean): ResultRow[] => [
    { id: 'g1-a', group: 'g1', details: { responseBody: 'x' } },
    {
      id: 'g1-b',
      group: 'g1',
      details: {
        aggregationEvaluation: {
          previousStatus: 'up',
          currentStatus: 'down',
          alertState: { consecutiveFailureCount: 4 },
        },
        aggregationNotificationProcessed: processed,
      },
    },
  ];

  it('resumes an unprocessed legacy receipt without a new receipt or counter change', async () => {
    const monitor = multiLocationMonitor('down');
    const store = fakeGroupStore(monitor, legacyRows(false));
    const prepared = await store.prepare('g1', 'up');
    expect(prepared).toMatchObject({
      receipt: { kind: 'legacy', resultId: 'g1-b' },
      evaluation: {
        currentStatus: 'down',
        alertState: { consecutiveFailureCount: 4 },
      },
    });
    expect(store.writes).toEqual({ monitor: 0, results: 0, inserts: 0 });
    expect(monitor.status).toBe('down');
  });

  it('marks a legacy receipt processed in the result row, as older workers expect', async () => {
    const rows = legacyRows(false);
    const store = fakeGroupStore(multiLocationMonitor('down'), rows);
    const prepared = await store.prepare('g1', 'up');
    await store.markNotified('g1', prepared!.receipt);
    expect(rows[1].details!.aggregationNotificationProcessed).toBe(true);
    expect(store.receipts.size).toBe(0);
    await expect(store.prepare('g1', 'up')).resolves.toBeNull();
  });

  // Backs the 2 h AGGREGATION_COMPLETED_TTL_SECONDS: once the Redis marker has expired, a late sibling
  // of an already-notified group is stopped by the persisted receipt, so it cannot alert twice.
  it('returns null for a processed legacy receipt', async () => {
    const store = fakeGroupStore(
      multiLocationMonitor('down'),
      legacyRows(true),
    );
    await expect(store.prepare('g1', 'up')).resolves.toBeNull();
    expect(store.writes).toEqual({ monitor: 0, results: 0, inserts: 0 });
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
