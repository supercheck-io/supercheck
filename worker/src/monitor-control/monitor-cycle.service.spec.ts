jest.mock('../monitor/monitor-cycle-warnings', () => ({
  evaluateCycleWarnings: jest.fn().mockResolvedValue(undefined),
}));
const mockEvaluator = {
  isMultiLocationEvaluation: jest.fn(),
  advanceAggregatedAlertState: jest.fn(),
  evaluateAndSendAlert: jest.fn(),
  checkSslExpirationAlert: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../monitor/monitor-evaluator', () => ({
  MonitorEvaluator: jest.fn().mockImplementation(() => mockEvaluator),
  tracksAlertState: jest.fn(),
}));

import { evaluateCycleWarnings } from '../monitor/monitor-cycle-warnings';
import { MonitorCycleService } from './monitor-cycle.service';

const evaluate = evaluateCycleWarnings as jest.Mock;

/** A drizzle-like chain: every builder method returns itself and awaiting it yields the queued rows. */
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'orderBy', 'set'])
    c[m] = jest.fn(() => c);
  c.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  return c;
};

describe('MonitorCycleService.notifyCycle runs the MCP and AI warning evaluation', () => {
  const monitor = {
    id: 'm1',
    type: 'mcp_server',
    config: { mcp: {} },
    deletingAt: null,
  };
  const cycle = {
    id: 'cycle-1',
    scheduledFor: new Date('2026-01-01T00:01:00Z'),
    monitorId: 'm1',
    status: 'closed',
    notifiedAt: null,
    notifyAttempts: 0,
    closedBy: 'deadline',
    expectedLocations: ['eu', 'us', 'eu'],
    evaluation: {
      previousStatus: 'up',
      currentStatus: 'up',
      reason: 'ok',
      avgResponseTimeMs: 5,
    },
  };
  const row = (location: string, over: Record<string, unknown> = {}) => ({
    location,
    isUp: true,
    responseTimeMs: 5,
    checkedAt: new Date(),
    details: { mcp: { toolsHash: 'h' } },
    ...over,
  });

  function build(selects: unknown[][]) {
    const queue = [...selects];
    const db = {
      select: jest.fn(() => chain(queue.shift() ?? [])),
      update: jest.fn(() => chain([])),
    };
    const service = new MonitorCycleService(
      { db } as never,
      {} as never,
      {} as never,
    );
    return { service, db };
  }

  beforeEach(() => {
    evaluate.mockClear();
    mockEvaluator.evaluateAndSendAlert.mockReset().mockResolvedValue({});
  });

  it('hands the evaluator the frozen row of each expected location, without synthetic rows, keyed by the cycle id', async () => {
    const eu = row('eu');
    const synthetic = row('us', { isUp: false, details: { synthetic: true } });
    const { service, db } = build([[cycle], [monitor], [eu, synthetic]]);

    expect(await service.notifyCycle('cycle-1')).toBe(true);

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith(
      db,
      monitor,
      'cycle-1',
      cycle.scheduledFor,
      [eu],
    );
  });

  it('still evaluates when alert delivery failed, so a redelivery cannot skip it', async () => {
    mockEvaluator.evaluateAndSendAlert.mockResolvedValue({
      deliveryFailed: true,
    });
    const { service } = build([[cycle], [monitor], [row('eu')]]);
    expect(await service.notifyCycle('cycle-1')).toBe(false);
    expect(evaluate).toHaveBeenCalledWith(
      expect.anything(),
      monitor,
      'cycle-1',
      cycle.scheduledFor,
      [expect.objectContaining({ location: 'eu' })],
    );
  });

  it('evaluates once per notification and leaves the cycle key to make a repeat harmless', async () => {
    const eu = row('eu');
    const first = build([[cycle], [monitor], [eu]]);
    await first.service.notifyCycle('cycle-1');
    const second = build([[cycle], [monitor], [eu]]);
    await second.service.notifyCycle('cycle-1');
    expect(evaluate.mock.calls.map((c) => c[2])).toEqual([
      'cycle-1',
      'cycle-1',
    ]);
  });

  it('passes each cycle its own scheduled time, so an older cycle redelivered later is recognisably older', async () => {
    const older = {
      ...cycle,
      id: 'cycle-N',
      scheduledFor: new Date('2026-01-01T00:00:00Z'),
    };
    const newer = {
      ...cycle,
      id: 'cycle-N1',
      scheduledFor: new Date('2026-01-01T00:01:00Z'),
    };
    await build([[newer], [monitor], [row('eu')]]).service.notifyCycle(
      'cycle-N1',
    );
    await build([[older], [monitor], [row('eu')]]).service.notifyCycle(
      'cycle-N',
    );
    const [first, second] = evaluate.mock.calls;
    expect(first[2]).toBe('cycle-N1');
    expect(second[2]).toBe('cycle-N');
    expect((second[3] as Date).getTime()).toBeLessThan(
      (first[3] as Date).getTime(),
    );
  });

  it.each([
    ['no cycle', [[]]],
    ['an open cycle', [[{ ...cycle, status: 'open' }]]],
    ['an already notified cycle', [[{ ...cycle, notifiedAt: new Date() }]]],
    ['a cycle without an evaluation', [[{ ...cycle, evaluation: null }]]],
    ['a missing monitor', [[cycle], []]],
    [
      'a monitor being deleted',
      [[cycle], [{ ...monitor, deletingAt: new Date() }]],
    ],
  ])('does not evaluate for %s', async (_name, selects) => {
    const { service } = build(selects);
    expect(await service.notifyCycle('cycle-1')).toBe(false);
    expect(evaluate).not.toHaveBeenCalled();
  });
});
