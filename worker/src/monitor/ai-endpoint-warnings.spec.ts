jest.mock('./monitor-warning-dispatch', () => ({
  dispatchMonitorWarning: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./monitor-warning-state', () => ({
  ...jest.requireActual('./monitor-warning-state'),
  persistGuardedState: jest.fn(),
}));

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema';
import type { MonitorConfig } from '../db/schema/types';
import {
  completeAiModel,
  evaluateAiEndpointWarnings,
} from './ai-endpoint-warnings';
import { dispatchMonitorWarning } from './monitor-warning-dispatch';
import { persistGuardedState } from './monitor-warning-state';

const dispatch = dispatchMonitorWarning as jest.Mock;
const alerts = { sendWarning: jest.fn() };
const persist = persistGuardedState as jest.Mock;

const ai = (over: Record<string, unknown> = {}) => ({
  details: {
    ai: {
      totalMs: 900,
      firstTokenMs: 100,
      servedModel: 'gpt-x',
      totalTokens: 10,
      ...over,
    },
  },
});

describe('evaluateAiEndpointWarnings', () => {
  let config: MonitorConfig | null;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(config ? [{ config }] : []),
        }),
      }),
    }),
  } as unknown as PostgresJsDatabase<typeof schema>;
  const state = () =>
    config?.aiEndpointState as NonNullable<MonitorConfig['aiEndpointState']>;
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
    results: Parameters<typeof evaluateAiEndpointWarnings>[5],
    overrideMs?: number,
  ) =>
    evaluateAiEndpointWarnings(
      db,
      alerts,
      'm1',
      cycleKey,
      at(cycleKey, overrideMs),
      results,
    );
  const kinds = () => dispatch.mock.calls.map((c) => [c[3], c[5]]);
  const set = (
    settings: Partial<NonNullable<MonitorConfig['aiEndpoint']>> = {},
    st?: MonitorConfig['aiEndpointState'],
  ) => {
    config = {
      aiEndpoint: { model: 'gpt-x', ...settings },
      ...(st ? { aiEndpointState: st } : {}),
    };
  };

  beforeEach(() => {
    set();
    times.clear();
    dispatch.mockClear();
    persist
      .mockReset()
      .mockImplementation(
        (_db, _id, _key, readKey, cycleKey, cycleAt, next) => {
          const stored = config?.aiEndpointState?.lastCycleKey ?? '';
          const lastAt = config?.aiEndpointState?.lastCycleAt;
          if (
            stored !== (readKey ?? '') ||
            stored === cycleKey ||
            (lastAt && Date.parse(lastAt) >= (cycleAt as Date).getTime())
          )
            return Promise.resolve(false);
          config = { ...config, aiEndpointState: next };
          return Promise.resolve(true);
        },
      );
  });

  describe('model changed', () => {
    it('is silent on the first value and stores it', async () => {
      await evaluate('c1', [ai()]);
      expect(state().lastServedModel).toBe('gpt-x');
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('warns once per new value, keyed by the detection, and warns again when it changes back', async () => {
      await evaluate('c1', [ai()]);
      await evaluate('c2', [ai()]);
      expect(dispatch).not.toHaveBeenCalled();
      await evaluate('c3', [ai({ servedModel: 'gpt-y' })]);
      await evaluate('c4', [ai({ servedModel: 'gpt-y' })]);
      await evaluate('c5', [ai({ servedModel: 'gpt-x' })]);
      expect(kinds()).toEqual([
        ['ai_model_changed', 'ai_model_changed:c3'],
        ['ai_model_changed', 'ai_model_changed:c5'],
      ]);
      expect(state().lastServedModel).toBe('gpt-x');
    });

    it('never puts the model name in the warning text', async () => {
      await evaluate('c1', [ai()]);
      await evaluate('c2', [ai({ servedModel: 'secret-model-name' })]);
      expect(dispatch.mock.calls[0][4]).not.toContain('secret-model-name');
    });

    it('compares nothing while locations serve different models, whatever their order', async () => {
      await evaluate('c1', [ai()]);
      await evaluate('c2', [ai({ servedModel: 'gpt-y' }), ai()]);
      await evaluate('c3', [ai(), ai({ servedModel: 'gpt-y' })]);
      expect(dispatch).not.toHaveBeenCalled();
      expect(state().lastServedModel).toBe('gpt-x');
    });

    it('on a control-plane cycle compares every region once all reported, and nothing while one is pending', async () => {
      const full = (
        key: string,
        complete: boolean,
        ...rows: ReturnType<typeof ai>[]
      ) =>
        evaluateAiEndpointWarnings(db, alerts, 'm1', key, at(key), [rows[0]], {
          complete,
          upResults: rows,
        });
      await evaluate('c1', [ai()]);
      // Frozen view saw only the region now serving gpt-y; the other region has not reported.
      await full('c2', false, ai({ servedModel: 'gpt-y' }), ai());
      expect(dispatch).not.toHaveBeenCalled();
      expect(state().lastServedModel).toBe('gpt-x');
      await full(
        'c3',
        true,
        ai({ servedModel: 'gpt-y' }),
        ai({ servedModel: 'gpt-y' }),
        ai({ servedModel: 'gpt-y' }),
      );
      expect(kinds()).toEqual([
        ['ai_model_changed', expect.stringMatching(/^ai_model_changed:/)],
      ]);
    });

    it('keeps the remembered model when a result carries none', async () => {
      await evaluate('c1', [ai()]);
      await evaluate('c2', [ai({ servedModel: undefined })]);
      expect(state().lastServedModel).toBe('gpt-x');
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe('slow first token', () => {
    beforeEach(() => set({ warnFirstTokenMs: 500 }));
    const slow = () => [ai({ firstTokenMs: 900 })];

    it('warns after 3 slow cycles, once per episode, keyed by the first slow cycle', async () => {
      await evaluate('c1', slow());
      await evaluate('c2', slow());
      expect(dispatch).not.toHaveBeenCalled();
      await evaluate('c3', slow());
      await evaluate('c4', slow());
      expect(kinds()).toEqual([
        ['ai_slow_first_token', 'ai_slow_first_token:c1'],
      ]);
    });

    it('a fast cycle resets and the next episode warns again', async () => {
      for (const k of ['c1', 'c2', 'c3']) await evaluate(k, slow());
      await evaluate('c4', [ai({ firstTokenMs: 500 })]);
      expect(state()).toMatchObject({
        slowFirstTokenStreak: 0,
        slowFirstTokenEpisodeKey: null,
      });
      for (const k of ['c5', 'c6', 'c7']) await evaluate(k, slow());
      expect(kinds().map((k) => k[1])).toEqual([
        'ai_slow_first_token:c1',
        'ai_slow_first_token:c5',
      ]);
    });

    it('a cycle with no first token (a failed check) leaves the streak alone', async () => {
      await evaluate('c1', slow());
      await evaluate('c2', [ai({ firstTokenMs: undefined })]);
      expect(state().slowFirstTokenStreak).toBe(1);
      await evaluate('c3', slow());
      await evaluate('c4', slow());
      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('the slowest location decides and one cycle counts once', async () => {
      await evaluate('c1', [
        ai({ firstTokenMs: 10 }),
        ai({ firstTokenMs: 900 }),
      ]);
      await evaluate('c1', slow());
      expect(state().slowFirstTokenStreak).toBe(1);
    });

    it('is off without a limit', async () => {
      set(
        {},
        {
          slowFirstTokenStreak: 2,
          slowFirstTokenEpisodeKey: 'ai_slow_first_token:c0',
        },
      );
      for (const k of ['c1', 'c2', 'c3'])
        await evaluate(k, [ai({ firstTokenMs: 60_000 })]);
      expect(dispatch).not.toHaveBeenCalled();
      expect(state().slowFirstTokenStreak).toBe(0);
    });
  });

  describe('tokens high', () => {
    beforeEach(() => set({ warnTotalTokens: 100 }));

    it('warns once per episode, ends it when a call is back under the limit, then warns again', async () => {
      await evaluate('c1', [ai({ totalTokens: 100 })]);
      expect(dispatch).not.toHaveBeenCalled();
      await evaluate('c2', [ai({ totalTokens: 101 })]);
      await evaluate('c3', [ai({ totalTokens: 500 })]);
      expect(kinds()).toEqual([['ai_tokens_high', 'ai_tokens_high:c2']]);
      expect(state().tokensHighEpisodeKey).toBe('ai_tokens_high:c2');
      await evaluate('c4', [ai({ totalTokens: 5 })]);
      expect(state().tokensHighEpisodeKey).toBeNull();
      await evaluate('c5', [ai({ totalTokens: 200 })]);
      expect(kinds().map((k) => k[1])).toEqual([
        'ai_tokens_high:c2',
        'ai_tokens_high:c5',
      ]);
    });

    it('a cycle with no token count leaves the episode alone', async () => {
      await evaluate('c1', [ai({ totalTokens: 200 })]);
      await evaluate('c2', [ai({ totalTokens: undefined })]);
      expect(state().tokensHighEpisodeKey).toBe('ai_tokens_high:c1');
    });

    it('is off without a limit and clears an old episode', async () => {
      set({}, { tokensHighEpisodeKey: 'ai_tokens_high:c0' });
      await evaluate('c1', [ai({ totalTokens: 9_999 })]);
      expect(dispatch).not.toHaveBeenCalled();
      expect(state().tokensHighEpisodeKey).toBeNull();
    });
  });

  it('does nothing for an http monitor without the preset, a gone monitor, or results without details.ai', async () => {
    config = { method: 'GET' };
    expect(await evaluate('c1', [ai()])).toBe(false);
    config = null;
    expect(await evaluate('c1', [ai()])).toBe(false);
    set();
    expect(
      await evaluate('c1', [
        { details: { statusCode: 500 } },
        { details: null },
        {},
      ]),
    ).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it('evaluating the same cycle twice, or two workers at once, sends one warning', async () => {
    await evaluate('c1', [ai()]);
    const results = [ai({ servedModel: 'gpt-y' })];
    await Promise.all([evaluate('c2', results), evaluate('c2', results)]);
    await evaluate('c2', results);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('an older cycle redelivered after a newer one cannot rewind the model, streaks or episodes', async () => {
    set({ warnFirstTokenMs: 500, warnTotalTokens: 100 });
    await evaluate('c1', [ai({ firstTokenMs: 900 })]);
    await evaluate('c2', [ai({ firstTokenMs: 900, servedModel: 'gpt-y' })]);
    expect(kinds()).toEqual([['ai_model_changed', 'ai_model_changed:c2']]);
    const before = JSON.stringify(state());
    expect(
      await evaluate(
        'late',
        [ai({ servedModel: 'gpt-x', totalTokens: 999 })],
        1500,
      ),
    ).toBe(false);
    expect(JSON.stringify(state())).toBe(before);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(state().lastCycleAt).toBe(at('c2').toISOString());
  });

  it('sends nothing when its UPDATE changed no row, and swallows failures', async () => {
    await evaluate('c1', [ai()]);
    // Changed no row twice: the first try and its one re-read.
    persist.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    expect(await evaluate('c2', [ai({ servedModel: 'gpt-y' })])).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    persist.mockRejectedValueOnce(new Error('db down'));
    await expect(evaluate('c3', [ai({ servedModel: 'gpt-z' })])).resolves.toBe(
      false,
    );
    persist.mockRejectedValueOnce('plain');
    await expect(evaluate('c4', [ai({ servedModel: 'gpt-z' })])).resolves.toBe(
      false,
    );
  });

  it('passes the key it read and writes only aiEndpointState', async () => {
    set({}, { lastCycleKey: 'old' });
    await evaluate('new', [ai()]);
    expect(persist).toHaveBeenCalledWith(
      db,
      'm1',
      'aiEndpointState',
      'old',
      'new',
      at('new'),
      expect.any(Object),
      { also: { modelCycleKey: undefined } },
    );
  });
});

describe('completeAiModel (late rows reach a cycle closed early)', () => {
  type State = NonNullable<MonitorConfig['aiEndpointState']>;
  let config: MonitorConfig;
  let cycle: Record<string, unknown> | undefined;
  let rows: Array<Record<string, unknown>>;
  const scheduledFor = new Date(1_800_000_005_000);
  const row = (location: string, servedModel: string) => ({
    location,
    isUp: true,
    checkedAt: new Date(1_800_000_006_000),
    ...ai({ servedModel }),
  });
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
              : { limit: () => Promise.resolve([{ config }]) };
          },
        }),
      }),
    } as unknown as PostgresJsDatabase<typeof schema>;
    return completeAiModel(dbc, alerts, 'm1', key);
  };
  const state = () => config.aiEndpointState as State;

  beforeEach(() => {
    dispatch.mockClear();
    config = {
      aiEndpoint: { model: 'gpt-x' },
      aiEndpointState: {
        lastServedModel: 'gpt-x',
        lastCycleKey: 'cyc',
        modelCycleKey: 'older',
        modelCycleAt: new Date(1_800_000_000_000).toISOString(),
      },
    };
    cycle = {
      status: 'closed',
      monitorId: 'm1',
      scheduledFor,
      expectedLocations: ['eu', 'us'],
    };
    rows = [row('eu', 'gpt-y'), row('us', 'gpt-y')];
    persist
      .mockReset()
      .mockImplementation(
        (_db, _id, _key, readKey, cycleKey, cycleAt, next, opts) => {
          const o = opts as {
            keyField: string;
            atField: string;
            also: Record<string, string | undefined>;
          };
          const st = (config.aiEndpointState ?? {}) as Record<
            string,
            string | undefined
          >;
          const stored = st[o.keyField] ?? '';
          const lastAt = st[o.atField];
          if (
            stored !== (readKey ?? '') ||
            stored === cycleKey ||
            (lastAt && Date.parse(lastAt) >= (cycleAt as Date).getTime()) ||
            Object.entries(o.also).some(([k, v]) => (st[k] ?? '') !== (v ?? ''))
          )
            return Promise.resolve(false);
          config = { ...config, aiEndpointState: next as State };
          return Promise.resolve(true);
        },
      );
  });

  it('compares the model once every region is in, and only once', async () => {
    expect(await complete()).toBe(true);
    expect(dispatch.mock.calls.map((c) => [c[3], c[5]])).toEqual([
      ['ai_model_changed', 'ai_model_changed:cyc'],
    ]);
    expect(state()).toMatchObject({
      lastServedModel: 'gpt-y',
      modelCycleKey: 'cyc',
      modelCycleAt: scheduledFor.toISOString(),
    });
    expect(await complete()).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('waits while a region is missing, and compares nothing while regions disagree', async () => {
    rows = [row('eu', 'gpt-y')];
    expect(await complete()).toBe(false);
    rows = [row('eu', 'gpt-y'), row('us', 'gpt-x')];
    expect(await complete()).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(state().lastServedModel).toBe('gpt-x');
  });

  it("skips an open cycle, another monitor's cycle, a cycle older than the last compared, and a monitor without the preset", async () => {
    cycle = { ...cycle, status: 'open' };
    expect(await complete()).toBe(false);
    cycle = { ...cycle, status: 'closed', monitorId: 'other' };
    expect(await complete()).toBe(false);
    cycle = undefined;
    expect(await complete()).toBe(false);
    cycle = {
      status: 'closed',
      monitorId: 'm1',
      scheduledFor,
      expectedLocations: ['eu', 'us'],
    };
    config = {
      ...config,
      aiEndpointState: {
        ...state(),
        modelCycleAt: new Date(1_800_000_009_000).toISOString(),
      },
    };
    expect(await complete()).toBe(false);
    config = {};
    expect(await complete()).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it('re-reads at most three times when another writer moved the state, and swallows failures', async () => {
    persist.mockReset().mockResolvedValue(false);
    expect(await complete()).toBe(false);
    expect(persist).toHaveBeenCalledTimes(3);
    persist.mockReset().mockRejectedValue(new Error('db down'));
    await expect(complete()).resolves.toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
