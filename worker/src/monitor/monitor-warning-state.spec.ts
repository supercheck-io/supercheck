import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema';
import {
  advanceSlowStreak,
  persistGuardedState,
} from './monitor-warning-state';

const CYCLE_AT = new Date('2026-01-01T00:00:00.000Z');

describe('persistGuardedState', () => {
  const dialect = new PgDialect();
  function fakeDb(rows: unknown[]) {
    const captured: { set?: { config: SQL }; where?: SQL } = {};
    const db = {
      update: () => ({
        set: (values: { config: SQL }) => {
          captured.set = values;
          return {
            where: (cond: SQL) => {
              captured.where = cond;
              return { returning: () => Promise.resolve(rows) };
            },
          };
        },
      }),
    } as unknown as PostgresJsDatabase<typeof schema>;
    return { db, captured };
  }

  it('writes only the one key with jsonb_set and guards on the cycle key', async () => {
    const { db, captured } = fakeDb([{ id: 'm1' }]);
    expect(
      await persistGuardedState(db, 'm1', 'mcpState', 'prev', 'cur', CYCLE_AT, {
        lastCycleKey: 'cur',
      }),
    ).toBe(true);
    const set = dialect.sqlToQuery(captured.set!.config);
    expect(set.sql).toMatch(
      /jsonb_set\(coalesce\("monitors"\."config", '\{\}'::jsonb\), '\{mcpState\}', \$1::jsonb\)/,
    );
    expect(set.params).toEqual([JSON.stringify({ lastCycleKey: 'cur' })]);
    const where = dialect.sqlToQuery(captured.where!);
    expect(where.sql).toContain(
      `coalesce(config->'mcpState'->>'lastCycleKey','') <> $`,
    );
    expect(where.sql).toContain(
      `coalesce(config->'mcpState'->>'lastCycleKey','') = $`,
    );
    expect(where.sql).toContain(
      `(config->'mcpState'->>'lastCycleAt') is null or (config->'mcpState'->>'lastCycleAt')::timestamptz < $`,
    );
    expect(where.params).toEqual(
      expect.arrayContaining(['m1', 'cur', 'prev', CYCLE_AT.toISOString()]),
    );
  });

  it('can guard on another field pair and require other fields to be unchanged', async () => {
    const { db, captured } = fakeDb([{ id: 'm1' }]);
    await persistGuardedState(
      db,
      'm1',
      'mcpState',
      'tk',
      'cyc',
      CYCLE_AT,
      {},
      {
        keyField: 'toolsCycleKey',
        atField: 'toolsCycleAt',
        also: { lastCycleKey: 'lk', toolsGone: undefined },
      },
    );
    const where = dialect.sqlToQuery(captured.where!);
    expect(where.sql).toContain(
      `coalesce(config->'mcpState'->>'toolsCycleKey','') <> $`,
    );
    expect(where.sql).toContain(
      `(config->'mcpState'->>'toolsCycleAt') is null`,
    );
    expect(where.sql).toContain(
      `coalesce(config->'mcpState'->>'lastCycleKey','') = $`,
    );
    expect(where.sql).toContain(
      `coalesce(config->'mcpState'->>'toolsGone','') = $`,
    );
    expect(where.params).toEqual(
      expect.arrayContaining(['tk', 'cyc', 'lk', '']),
    );
  });

  it('uses the other worker-owned key and an empty previous key', async () => {
    const { db, captured } = fakeDb([]);
    expect(
      await persistGuardedState(
        db,
        'm1',
        'aiEndpointState',
        undefined,
        'cur',
        CYCLE_AT,
        {},
      ),
    ).toBe(false);
    expect(dialect.sqlToQuery(captured.set!.config).sql).toContain(
      `'{aiEndpointState}'`,
    );
    expect(dialect.sqlToQuery(captured.where!).params).toContain('');
  });
});

describe('advanceSlowStreak', () => {
  it('starts an episode at the first slow cycle and fires exactly on the third', () => {
    const one = advanceSlowStreak({}, true, 'mcp_slow', 'c1');
    expect(one).toEqual({ streak: 1, episodeKey: 'mcp_slow:c1', fire: false });
    const two = advanceSlowStreak(
      { streak: 1, episodeKey: one.episodeKey },
      true,
      'mcp_slow',
      'c2',
    );
    expect(two.fire).toBe(false);
    const three = advanceSlowStreak(
      { streak: 2, episodeKey: two.episodeKey },
      true,
      'mcp_slow',
      'c3',
    );
    expect(three).toEqual({ streak: 3, episodeKey: 'mcp_slow:c1', fire: true });
    expect(
      advanceSlowStreak(
        { streak: 3, episodeKey: three.episodeKey },
        true,
        'mcp_slow',
        'c4',
      ).fire,
    ).toBe(false);
  });

  it('resets on a fast cycle and leaves the streak on an unmeasured one', () => {
    expect(
      advanceSlowStreak({ streak: 2, episodeKey: 'k' }, false, 'mcp_slow', 'c'),
    ).toEqual({ streak: 0, episodeKey: null, fire: false });
    expect(
      advanceSlowStreak(
        { streak: 2, episodeKey: 'k' },
        undefined,
        'mcp_slow',
        'c',
      ),
    ).toEqual({ streak: 2, episodeKey: 'k', fire: false });
    expect(advanceSlowStreak({}, undefined, 'mcp_slow', 'c')).toEqual({
      streak: 0,
      episodeKey: null,
      fire: false,
    });
  });

  it('starts a key when a streak has none stored', () => {
    expect(
      advanceSlowStreak(
        { streak: 1, episodeKey: null },
        true,
        'ai_slow_first_token',
        'c9',
      ).episodeKey,
    ).toBe('ai_slow_first_token:c9');
  });
});
