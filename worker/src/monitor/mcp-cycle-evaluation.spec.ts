jest.mock('./monitor-warning-dispatch', () => ({
  dispatchMonitorWarning: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./monitor-warning-state', () => ({
  ...jest.requireActual('./monitor-warning-state'),
  persistGuardedState: jest.fn(),
}));

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema';
import type {
  McpMonitorState,
  McpToolFingerprint,
  MonitorConfig,
} from '../db/schema/types';
import { evaluateMcpCycle } from './mcp-cycle-evaluation';
import { fingerprintTool, hashToolList } from './mcp-tool-diff';
import { dispatchMonitorWarning } from './monitor-warning-dispatch';
import { persistGuardedState } from './monitor-warning-state';

const dispatch = dispatchMonitorWarning as jest.Mock;
const persist = persistGuardedState as jest.Mock;

const tool = (name: string, description = 'd', inputSchema: unknown = {}) =>
  fingerprintTool({ name, description, inputSchema })!;
const result = (
  tools: McpToolFingerprint[],
  ms = 100,
  protocol = '2026-07-28',
) => ({
  responseTimeMs: ms,
  details: {
    mcp: {
      protocol,
      toolsHash: hashToolList(tools),
      tools,
      toolCount: tools.length,
    },
  },
});

describe('evaluateMcpCycle', () => {
  let config: MonitorConfig | null;
  let writes: number;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(config ? [{ config }] : []),
        }),
      }),
    }),
  } as unknown as PostgresJsDatabase<typeof schema>;
  const state = () => config?.mcpState as McpMonitorState;
  const times = new Map<string, number>();
  /** Each new cycle key is one second later than the previous new one; a repeated key keeps its time. */
  const at = (key: string, override?: number) =>
    new Date(
      1_800_000_000_000 +
        (override ??
          times.get(key) ??
          times.set(key, (times.size + 1) * 1000).get(key)!),
    );
  const evaluate = (
    cycleKey: string,
    ups: Parameters<typeof evaluateMcpCycle>[4],
    overrideMs?: number,
  ) => evaluateMcpCycle(db, 'm1', cycleKey, at(cycleKey, overrideMs), ups);
  const kinds = () => dispatch.mock.calls.map((c) => [c[1], c[3]]);

  beforeEach(() => {
    config = { mcp: { auth: { type: 'none' }, slowMs: 1000 } };
    writes = 0;
    times.clear();
    dispatch.mockClear();
    // Same compare-and-set rule as the SQL guard: still the key that was read, and not this cycle.
    persist
      .mockReset()
      .mockImplementation(
        (_db, _id, _key, readKey, cycleKey, cycleAt, next) => {
          const stored = config?.mcpState?.lastCycleKey ?? '';
          const lastAt = config?.mcpState?.lastCycleAt;
          if (
            stored !== (readKey ?? '') ||
            stored === cycleKey ||
            (lastAt && Date.parse(lastAt) >= (cycleAt as Date).getTime())
          )
            return Promise.resolve(false);
          config = { ...config, mcpState: next as McpMonitorState };
          writes += 1;
          return Promise.resolve(true);
        },
      );
  });

  const A = [tool('a'), tool('b')];

  it('stores the first successful list as the baseline without a warning', async () => {
    expect(await evaluate('c1', [result(A)])).toBe(true);
    expect(state().baseline).toMatchObject({ hash: hashToolList(A), tools: A });
    expect(state()).toMatchObject({
      lastCycleKey: 'c1',
      detectedProtocol: '2026',
      slowStreak: 0,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('records the 2025 protocol as detected', async () => {
    await evaluate('c1', [result(A, 100, '2025-06-18')]);
    expect(state().detectedProtocol).toBe('2025');
  });

  it('does nothing visible when the list is unchanged', async () => {
    await evaluate('c1', [result(A)]);
    const takenAt = state().baseline!.takenAt;
    await evaluate('c2', [result([...A].reverse())]);
    expect(state().baseline!.takenAt).toBe(takenAt);
    expect(state().changes).toBeUndefined();
    expect(state().lastCycleKey).toBe('c2');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('warns once per change, replaces the baseline and appends the change with reasons', async () => {
    await evaluate('c1', [result(A)]);
    const B = [tool('a', 'changed text'), tool('c')];
    await evaluate('c2', [result(B)]);
    expect(kinds()).toEqual([['mcp_tools_changed', 'mcp_tools_changed:c2']]);
    expect(dispatch.mock.calls[0][2]).toBe(
      'Tool list changed: 1 added, 1 removed, 1 changed',
    );
    expect(state().baseline!.hash).toBe(hashToolList(B));
    expect(state().changes).toHaveLength(1);
    expect(state().changes![0]).toMatchObject({
      added: ['c'],
      removed: ['b'],
      changed: [{ name: 'a', reasons: ['description'] }],
    });
    await evaluate('c3', [result(B)]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('an older cycle redelivered after a newer one changes nothing: no false diff, no early slow warning', async () => {
    const B = [tool('x')];
    await evaluate('c1', [result(A)]);
    await evaluate('c2', [result(B)]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const before = JSON.stringify(state());
    // cycle c1.5 (older than c2) arrives late with the old list
    expect(await evaluate('late', [result(A, 5000)], 1500)).toBe(false);
    expect(JSON.stringify(state())).toBe(before);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('an older slow cycle redelivered cannot complete a streak', async () => {
    await evaluate('c1', [result(A, 2000)]);
    await evaluate('c2', [result(A, 2000)]);
    await evaluate('old', [result(A, 2000)], 500);
    expect(state().slowStreak).toBe(2);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('a cycle at exactly the same time as the last one is ignored', async () => {
    await evaluate('c1', [result(A)], 1000);
    expect(await evaluate('twin', [result(A)], 1000)).toBe(false);
  });

  it('records lastCycleAt as an ISO time', async () => {
    await evaluate('c1', [result(A)]);
    expect(state().lastCycleAt).toBe(at('c1').toISOString());
  });

  it('a list that goes back to an earlier state is a new change and warns again', async () => {
    const B = [tool('x')];
    await evaluate('c1', [result(A)]);
    await evaluate('c2', [result(B)]);
    await evaluate('c3', [result(A)]);
    expect(kinds()).toEqual([
      ['mcp_tools_changed', 'mcp_tools_changed:c2'],
      ['mcp_tools_changed', 'mcp_tools_changed:c3'],
    ]);
  });

  it('records nothing when up locations disagree on the list', async () => {
    await evaluate('c1', [result(A)]);
    const before = state().baseline;
    await evaluate('c2', [result(A), result([tool('z')])]);
    expect(state().baseline).toEqual(before);
    expect(state().changes).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
    expect(state().lastCycleKey).toBe('c2');
  });

  it('does not set a baseline while up locations disagree', async () => {
    await evaluate('c1', [result(A), result([tool('z')])]);
    expect(state().baseline).toBeUndefined();
  });

  it('leaves everything alone when no location was up', async () => {
    expect(await evaluate('c1', [])).toBe(false);
    expect(
      await evaluate('c1', [
        { responseTimeMs: 5, details: { errorMessage: 'x' } },
        { details: null },
      ]),
    ).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it('ignores a monitor that is not an MCP monitor, or gone', async () => {
    config = {};
    expect(await evaluate('c1', [result(A)])).toBe(false);
    config = null;
    expect(await evaluate('c1', [result(A)])).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it('evaluating the same cycle twice (redelivery) changes and sends nothing the second time', async () => {
    await evaluate('c1', [result(A)]);
    await evaluate('c2', [result([tool('n')])]);
    await evaluate('c2', [result([tool('n')])]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(writes).toBe(2);
  });

  it('two workers evaluating one cycle at once send one warning (only the winning UPDATE sends)', async () => {
    await evaluate('c1', [result(A)]);
    const B = [tool('n')];
    const [one, two] = await Promise.all([
      evaluate('c2', [result(B)]),
      evaluate('c2', [result(B)]),
    ]);
    expect([one, two].filter(Boolean)).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('keeps the last 10 changes and caps names at 50 per group', async () => {
    await evaluate('c0', [result([tool('base')])]);
    for (let i = 1; i <= 12; i += 1)
      await evaluate(`c${i}`, [result([tool(`only${i}`)])]);
    expect(state().changes).toHaveLength(10);
    expect(state().changes![9].added).toEqual(['only12']);
    const many = Array.from({ length: 80 }, (_, i) =>
      tool(`n${String(i).padStart(2, '0')}`),
    );
    await evaluate('big', [result(many)]);
    const last = state().changes!.at(-1)!;
    expect(last.added).toHaveLength(50);
    expect(last.removed).toEqual(['only12']);
    const renamed = many.map((t) => tool(t.name, 'other'));
    await evaluate('big2', [result(renamed)]);
    expect(state().changes!.at(-1)!.changed).toHaveLength(50);
  });

  describe('slow checks', () => {
    const slow = (ms = 2000) => [result(A, ms)];

    it('warns after 3 slow cycles in a row, once per episode, keyed by the first slow cycle', async () => {
      await evaluate('c1', slow());
      await evaluate('c2', slow());
      expect(dispatch).not.toHaveBeenCalled();
      await evaluate('c3', slow());
      expect(kinds()).toEqual([['mcp_slow', 'mcp_slow:c1']]);
      expect(dispatch.mock.calls[0][2]).toBe(
        'Checks took longer than 1000 ms for 3 cycles in a row',
      );
      await evaluate('c4', slow());
      await evaluate('c5', slow());
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(state().slowStreak).toBe(5);
    });

    it('a fast cycle ends the episode, and the next 3 slow cycles warn again', async () => {
      for (const k of ['c1', 'c2', 'c3']) await evaluate(k, slow());
      await evaluate('c4', slow(500));
      expect(state()).toMatchObject({ slowStreak: 0, slowEpisodeKey: null });
      for (const k of ['c5', 'c6', 'c7']) await evaluate(k, slow());
      expect(kinds()).toEqual([
        ['mcp_slow', 'mcp_slow:c1'],
        ['mcp_slow', 'mcp_slow:c5'],
      ]);
    });

    it('a fast cycle before the third breaks the streak', async () => {
      await evaluate('c1', slow());
      await evaluate('c2', slow());
      await evaluate('c3', slow(10));
      await evaluate('c4', slow());
      await evaluate('c5', slow());
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('counts a cycle once even when it is evaluated again', async () => {
      await evaluate('c1', slow());
      await evaluate('c1', slow());
      await evaluate('c1', slow());
      expect(state().slowStreak).toBe(1);
    });

    it('the slowest up location decides, and the limit is exclusive', async () => {
      await evaluate('c1', [result(A, 10), result(A, 1001)]);
      expect(state().slowStreak).toBe(1);
      await evaluate('c2', [result(A, 1000)]);
      expect(state().slowStreak).toBe(0);
    });

    it('a down cycle leaves the streak where it was', async () => {
      await evaluate('c1', slow());
      await evaluate('c2', []);
      await evaluate('c3', slow());
      await evaluate('c4', slow());
      expect(kinds()).toEqual([['mcp_slow', 'mcp_slow:c1']]);
    });

    it('is off without slowMs', async () => {
      config = {
        mcp: { auth: { type: 'none' } },
        mcpState: { slowStreak: 2, slowEpisodeKey: 'mcp_slow:c0' },
      };
      for (const k of ['c1', 'c2', 'c3']) await evaluate(k, slow(60_000));
      expect(dispatch).not.toHaveBeenCalled();
      expect(state().slowStreak).toBe(0);
    });

    it('treats a missing response time as fast', async () => {
      await evaluate('c1', [{ details: result(A).details }]);
      expect(state().slowStreak).toBe(0);
    });
  });

  it('sends nothing when its UPDATE changed no row (another worker moved first)', async () => {
    await evaluate('c1', [result(A)]);
    persist.mockResolvedValueOnce(false);
    expect(await evaluate('c2', [result([tool('n')])])).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('logs and swallows a failure, never breaking result saving', async () => {
    persist.mockRejectedValueOnce(new Error('db down'));
    await expect(evaluate('c1', [result(A)])).resolves.toBe(false);
    persist.mockRejectedValueOnce('plain');
    await expect(evaluate('c2', [result(A)])).resolves.toBe(false);
    config = {
      mcp: { auth: { type: 'none' } },
      mcpState: { baseline: { hash: 'old', takenAt: 't', tools: [] } },
    };
    dispatch.mockRejectedValueOnce(new Error('send failed'));
    await expect(evaluate('c3', [result(A)])).resolves.toBe(false);
  });

  it('passes the key it read and writes only mcpState', async () => {
    config = {
      mcp: { auth: { type: 'none' } },
      mcpState: { lastCycleKey: 'old' },
    };
    await evaluate('new', [result(A)]);
    expect(persist).toHaveBeenCalledWith(
      db,
      'm1',
      'mcpState',
      'old',
      'new',
      at('new'),
      expect.any(Object),
    );
  });
});
