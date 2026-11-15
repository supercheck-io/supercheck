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
import {
  completeMcpTools,
  evaluateMcpCycle,
  toolsInputOf,
} from './mcp-cycle-evaluation';
import { fingerprintTool, hashToolList, mcpEndpointKey } from './mcp-tool-diff';
import { dispatchMonitorWarning } from './monitor-warning-dispatch';
import { persistGuardedState } from './monitor-warning-state';

const dispatch = dispatchMonitorWarning as jest.Mock;
const alerts = { sendWarning: jest.fn() };
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
    ups: Parameters<typeof evaluateMcpCycle>[5],
    overrideMs?: number,
  ) =>
    evaluateMcpCycle(db, alerts, 'm1', cycleKey, at(cycleKey, overrideMs), ups);
  const kinds = () => dispatch.mock.calls.map((c) => [c[3], c[5]]);

  beforeEach(() => {
    config = { mcp: { auth: { type: 'none' }, slowMs: 1000 } };
    writes = 0;
    times.clear();
    dispatch.mockClear();
    // Same compare-and-set rule as the SQL guard: still the key that was read, and not this cycle.
    persist
      .mockReset()
      .mockImplementation(
        (_db, _id, _key, readKey, cycleKey, cycleAt, next, opts) => {
          const o = opts as
            | {
                keyField?: string;
                atField?: string;
                also?: Record<string, string | undefined>;
              }
            | undefined;
          const st = (config?.mcpState ?? {}) as Record<
            string,
            string | undefined
          >;
          const stored = st[o?.keyField ?? 'lastCycleKey'] ?? '';
          const lastAt = st[o?.atField ?? 'lastCycleAt'];
          if (
            stored !== (readKey ?? '') ||
            stored === cycleKey ||
            (lastAt && Date.parse(lastAt) >= (cycleAt as Date).getTime()) ||
            Object.entries(o?.also ?? {}).some(
              ([k, v]) => (st[k] ?? '') !== (v ?? ''),
            )
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

  it('ignores results stamped for other settings (a check from before a URL or login change)', async () => {
    await evaluate('c1', [result(A)]);
    const stamped = (tools: McpToolFingerprint[], endpointKey: string) => {
      const r = result(tools);
      return { ...r, details: { mcp: { ...r.details.mcp, endpointKey } } };
    };
    // The mocked row has no target, so this is the key of the current settings.
    const currentKey = mcpEndpointKey(undefined as never, { type: 'none' });
    expect(
      await evaluate('c2', [stamped([tool('old')], 'stale-settings')]),
    ).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(state().baseline).toMatchObject({ hash: hashToolList(A) });
    await evaluate('c3', [stamped([tool('new')], currentKey)]);
    expect(kinds()).toEqual([['mcp_tools_changed', 'mcp_tools_changed:c3']]);
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
    expect(dispatch.mock.calls[0][4]).toBe(
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

  it('re-reads once when a tool-list completion wrote between our read and write', async () => {
    await evaluate('c1', [result(A)]);
    persist.mockResolvedValueOnce(false);
    expect(await evaluate('c2', [result([tool('n')])])).toBe(true);
    expect(persist).toHaveBeenCalledTimes(3);
  });

  describe('a cycle closed early (a location still pending)', () => {
    const pending = (ups: ReturnType<typeof result>[]) => ({
      complete: false,
      upResults: ups,
    });
    const B = [tool('x')];

    it('records no change from the early rows, but still counts the slow streak and the cycle', async () => {
      await evaluate('c1', [result(A)]);
      const key = 'c2';
      expect(
        await evaluateMcpCycle(
          db,
          alerts,
          'm1',
          key,
          at(key),
          [result(B, 2000)],
          pending([result(B)]),
        ),
      ).toBe(true);
      expect(state().baseline!.hash).toBe(hashToolList(A));
      expect(state().changes).toBeUndefined();
      expect(state().slowStreak).toBe(1);
      expect(state().lastCycleKey).toBe('c2');
      expect(state().toolsCycleKey).toBe('c1');
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('does not even take a baseline from early rows', async () => {
      await evaluateMcpCycle(
        db,
        alerts,
        'm1',
        'c1',
        at('c1'),
        [result(A)],
        pending([result(A)]),
      );
      expect(state().baseline).toBeUndefined();
      expect(state().toolsCycleKey).toBeUndefined();
    });
  });

  describe('completeMcpTools (late rows reach a closed cycle)', () => {
    const cycleRow = (over: Record<string, unknown> = {}) => ({
      status: 'closed',
      monitorId: 'm1',
      scheduledFor: new Date(1_800_000_005_000),
      expectedLocations: ['eu', 'us'],
      ...over,
    });
    const row = (
      location: string,
      tools: McpToolFingerprint[],
      over: Record<string, unknown> = {},
    ) => ({
      location,
      isUp: true,
      responseTimeMs: 5,
      checkedAt: new Date(1_800_000_006_000),
      details: result(tools).details,
      ...over,
    });
    let cycle: ReturnType<typeof cycleRow> | undefined;
    let rows: ReturnType<typeof row>[];
    const complete = (key = 'cyc') => {
      let n = 0;
      const dbc = {
        select: () => ({
          from: () => ({
            where: () => {
              n += 1;
              if (n % 3 === 1)
                return { limit: () => Promise.resolve(cycle ? [cycle] : []) };
              return n % 3 === 2
                ? Promise.resolve(rows)
                : { limit: () => Promise.resolve(config ? [{ config }] : []) };
            },
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;
      return completeMcpTools(dbc, alerts, 'm1', key);
    };
    const B = [tool('x')];

    beforeEach(() => {
      cycle = cycleRow();
      rows = [row('eu', B), row('us', B)];
      config = {
        mcp: { auth: { type: 'none' } },
        mcpState: {
          lastCycleKey: 'cyc',
          lastCycleAt: new Date(1_800_000_005_000).toISOString(),
          baseline: { hash: hashToolList(A), takenAt: 't', tools: A },
        },
      };
    });

    it('records the change once every expected region is in and they agree, without touching the slow streak', async () => {
      config!.mcpState!.slowStreak = 2;
      expect(await complete()).toBe(true);
      expect(kinds()).toEqual([['mcp_tools_changed', 'mcp_tools_changed:cyc']]);
      expect(state().baseline!.hash).toBe(hashToolList(B));
      expect(state().slowStreak).toBe(2);
      expect(state().lastCycleKey).toBe('cyc');
      expect(state().toolsCycleKey).toBe('cyc');
    });

    it('does nothing while a region is still missing, or only has a synthetic row', async () => {
      rows = [row('eu', B)];
      expect(await complete()).toBe(false);
      rows = [
        row('eu', B),
        row('us', B, { isUp: false, details: { synthetic: true } }),
      ];
      expect(await complete()).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('records nothing when the regions disagree, but completes the cycle', async () => {
      rows = [row('eu', B), row('us', A)];
      expect(await complete()).toBe(true);
      expect(state().baseline!.hash).toBe(hashToolList(A));
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('a region that is down has reported and does not block; only up regions are compared', async () => {
      rows = [row('eu', B), row('us', B, { isUp: false })];
      expect(await complete()).toBe(true);
      expect(kinds()).toHaveLength(1);
    });

    it('runs once per cycle, and never for an older cycle than one already completed', async () => {
      expect(await complete()).toBe(true);
      expect(await complete()).toBe(false);
      cycle = cycleRow({ scheduledFor: new Date(1_800_000_001_000) });
      expect(await complete('older')).toBe(false);
      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('ignores open cycles, other monitors cycles and missing cycles', async () => {
      cycle = cycleRow({ status: 'open' });
      expect(await complete()).toBe(false);
      cycle = cycleRow({ monitorId: 'other' });
      expect(await complete()).toBe(false);
      cycle = undefined;
      expect(await complete()).toBe(false);
    });

    it('uses the newest real row of a region', async () => {
      rows = [
        row('eu', A, { checkedAt: new Date(1_800_000_001_000) }),
        row('eu', B, { checkedAt: new Date(1_800_000_009_000) }),
        row('us', B),
      ];
      expect(await complete()).toBe(true);
      expect(kinds()).toHaveLength(1);
    });

    it('persists with its own guard fields and the other pair as an extra guard', async () => {
      await complete();
      expect(persist).toHaveBeenCalledWith(
        expect.anything(),
        'm1',
        'mcpState',
        undefined,
        'cyc',
        cycleRow().scheduledFor,
        expect.any(Object),
        {
          keyField: 'toolsCycleKey',
          atField: 'toolsCycleAt',
          also: { lastCycleKey: 'cyc' },
        },
      );
    });

    it('swallows a failure', async () => {
      cycle = undefined;
      persist.mockRejectedValue(new Error('x'));
      expect(await complete()).toBe(false);
      const bad = {
        select: () => {
          throw new Error('db down');
        },
      } as unknown as PostgresJsDatabase<typeof schema>;
      await expect(completeMcpTools(bad, alerts, 'm1', 'cyc')).resolves.toBe(
        false,
      );
    });

    it('retries when another writer moved the state, and records the change once', async () => {
      persist.mockResolvedValueOnce(false);
      expect(await complete()).toBe(true);
      expect(persist).toHaveBeenCalledTimes(2);
      expect(kinds()).toHaveLength(1);
    });

    it('gives up after 3 attempts', async () => {
      persist.mockResolvedValue(false);
      expect(await complete()).toBe(false);
      expect(persist).toHaveBeenCalledTimes(3);
    });

    it('does nothing for a monitor that is gone or has no MCP settings', async () => {
      config = null;
      expect(await complete()).toBe(false);
    });
  });

  it('a list change past the stored tools is still recorded and warned, flagged beyondStored', async () => {
    await evaluate('c1', [result(A)]);
    // same stored names and fingerprints, but the whole-list hash differs (a tool beyond the stored 500 changed)
    const beyond = {
      ...result(A),
      details: { mcp: { ...result(A).details.mcp, toolsHash: 'f'.repeat(64) } },
    };
    await evaluate('c2', [beyond]);
    expect(state().changes).toHaveLength(1);
    expect(state().changes![0]).toMatchObject({
      added: [],
      removed: [],
      changed: [],
      beyondStored: true,
    });
    expect(kinds()).toEqual([['mcp_tools_changed', 'mcp_tools_changed:c2']]);
    expect(dispatch.mock.calls[0][4]).toBe(
      'Tool list changed beyond the stored tools',
    );
    expect(state().baseline!.hash).toBe('f'.repeat(64));
  });

  it('a visible change is not flagged beyondStored', async () => {
    await evaluate('c1', [result(A)]);
    await evaluate('c2', [result([tool('n')])]);
    expect(state().changes![0].beyondStored).toBeUndefined();
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
      expect(dispatch.mock.calls[0][4]).toBe(
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
    persist.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
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
      { also: { toolsCycleKey: undefined } },
    );
  });
});

describe('toolsInputOf', () => {
  const up = (location: string, ms = 0) => ({
    location,
    isUp: true,
    checkedAt: new Date(ms),
    details: {},
  });
  it('needs every distinct expected location to have a real row', () => {
    expect(toolsInputOf(['a', 'b', 'a'], [up('a'), up('b')]).complete).toBe(
      true,
    );
    expect(toolsInputOf(['a', 'b'], [up('a')]).complete).toBe(false);
    expect(toolsInputOf([], []).complete).toBe(false);
    expect(
      toolsInputOf(
        ['a'],
        [{ location: 'a', isUp: false, details: { synthetic: true } }],
      ).complete,
    ).toBe(false);
  });
  it('keeps each location newest row, ignores unexpected locations, and drops down rows from upResults', () => {
    const newer = up('a', 20);
    const input = toolsInputOf(
      ['a', 'b'],
      [
        up('a', 10),
        newer,
        up('z'),
        { location: 'b', isUp: false, details: {} },
      ],
    );
    expect(input.complete).toBe(true);
    expect(input.upResults).toEqual([newer]);
  });
  it('treats rows without a checkedAt as oldest', () => {
    const dated = up('a', 5);
    const input = toolsInputOf(
      ['a'],
      [
        { location: 'a', isUp: true, details: {} },
        dated,
        { location: 'a', isUp: true, details: {} },
      ],
    );
    expect(input.upResults).toEqual([dated]);
  });
});
