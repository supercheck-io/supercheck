import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema';
import { evaluateAgentRunWarning } from './agent-run-warning';

const monitorRow = {
  id: 'm1',
  name: 'Bot',
  type: 'synthetic_test',
  target: null,
  projectId: 'p1',
  alertConfig: { enabled: true, failureThreshold: 3 },
  deletingAt: null,
};
const failedAgent = {
  isUp: false,
  details: {
    testType: 'agent',
    agent: { passRate: 0.6, attempts: 10, totalTokens: 1 },
  },
};

/** select() answers in call order: newest result, then the monitor's alert config, then dispatch's row. */
function fakeDb(
  latest: unknown,
  alertConfig: unknown = { failureThreshold: 3 },
  dispatchRow: unknown = monitorRow,
) {
  const answers = [
    latest ? [latest] : [],
    alertConfig ? [{ alertConfig }] : [],
    dispatchRow ? [dispatchRow] : [],
  ];
  const select = jest.fn(() => {
    const rows = answers.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => Promise.resolve(rows);
    return chain;
  });
  return { select } as unknown as PostgresJsDatabase<typeof schema>;
}
const row = (over: object = {}) => ({
  id: 'r3',
  isUp: false,
  count: 1,
  details: { outageKey: 'outage-7' },
  ...over,
});

describe('evaluateAgentRunWarning', () => {
  const alerts = { sendWarning: jest.fn().mockResolvedValue({}) };
  beforeEach(() => alerts.sendWarning.mockClear());

  it('warns on a failed run below the threshold, keyed on the streak', async () => {
    await evaluateAgentRunWarning(fakeDb(row({ count: 2 })), alerts, 'm1', [
      failedAgent,
    ]);
    expect(alerts.sendWarning).toHaveBeenCalledWith(
      monitorRow,
      'agent_run_failed',
      'Agent run failed (2 of 3 before an incident); pass rate 60% over 10 attempts',
      'agent_run_failed:outage-7',
    );
  });

  it('falls back to the result id as the streak key, and omits the pass rate without one', async () => {
    await evaluateAgentRunWarning(fakeDb(row({ details: {} })), alerts, 'm1', [
      { isUp: false, details: { testType: 'agent' } },
    ]);
    expect(alerts.sendWarning).toHaveBeenCalledWith(
      monitorRow,
      'agent_run_failed',
      'Agent run failed (1 of 3 before an incident)',
      'agent_run_failed:r3',
    );
  });

  it('sends nothing for the failure that reaches the threshold (that opens the incident)', async () => {
    await evaluateAgentRunWarning(fakeDb(row({ count: 3 })), alerts, 'm1', [
      failedAgent,
    ]);
    expect(alerts.sendWarning).not.toHaveBeenCalled();
  });

  it('treats a missing threshold as 1: the first failure is the incident', async () => {
    await evaluateAgentRunWarning(fakeDb(row(), {}), alerts, 'm1', [
      failedAgent,
    ]);
    expect(alerts.sendWarning).not.toHaveBeenCalled();
  });

  it.each([
    ['a passing run', [{ isUp: true, details: { testType: 'agent' } }]],
    [
      'a failed non-agent test',
      [{ isUp: false, details: { testType: 'browser' } }],
    ],
    ['a result without details', [{ isUp: false }]],
  ])('does nothing for %s', async (_n, results) => {
    const db = fakeDb(row());
    await evaluateAgentRunWarning(db, alerts, 'm1', results);
    expect(
      (db as unknown as { select: jest.Mock }).select,
    ).not.toHaveBeenCalled();
  });

  it('does nothing when the newest row is up, missing, or the monitor is gone', async () => {
    await evaluateAgentRunWarning(fakeDb(row({ isUp: true })), alerts, 'm1', [
      failedAgent,
    ]);
    await evaluateAgentRunWarning(fakeDb(null), alerts, 'm1', [failedAgent]);
    await evaluateAgentRunWarning(fakeDb(row(), null), alerts, 'm1', [
      failedAgent,
    ]);
    expect(alerts.sendWarning).not.toHaveBeenCalled();
  });

  it('logs and swallows a database error', async () => {
    const db = {
      select: () => {
        throw new Error('db down');
      },
    } as unknown as PostgresJsDatabase<typeof schema>;
    await expect(
      evaluateAgentRunWarning(db, alerts, 'm1', [failedAgent]),
    ).resolves.toBeUndefined();
    expect(alerts.sendWarning).not.toHaveBeenCalled();
  });
});
