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
import { evaluateAiEndpointWarnings } from './ai-endpoint-warnings';
import { dispatchMonitorWarning } from './monitor-warning-dispatch';
import { persistGuardedState } from './monitor-warning-state';

const dispatch = dispatchMonitorWarning as jest.Mock;
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
  const evaluate = (
    cycleKey: string,
    results: Parameters<typeof evaluateAiEndpointWarnings>[3],
  ) => evaluateAiEndpointWarnings(db, 'm1', cycleKey, results);
  const kinds = () => dispatch.mock.calls.map((c) => [c[1], c[3]]);
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
    dispatch.mockClear();
    persist
      .mockReset()
      .mockImplementation((_db, _id, _key, readKey, cycleKey, next) => {
        const stored = config?.aiEndpointState?.lastCycleKey ?? '';
        if (stored !== (readKey ?? '') || stored === cycleKey)
          return Promise.resolve(false);
        config = { ...config, aiEndpointState: next };
        return Promise.resolve(true);
      });
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
      expect(dispatch.mock.calls[0][2]).not.toContain('secret-model-name');
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

  it('sends nothing when its UPDATE changed no row, and swallows failures', async () => {
    await evaluate('c1', [ai()]);
    persist.mockResolvedValueOnce(false);
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
      expect.any(Object),
    );
  });
});
