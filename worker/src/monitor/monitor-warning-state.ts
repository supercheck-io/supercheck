import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { liveMonitor } from '../db/deletion-visibility';
import type { MonitorWarningKind } from './monitor-warning-dispatch';

export const SLOW_CYCLES_BEFORE_WARNING = 3;

export type WorkerStateKey = 'mcpState' | 'aiEndpointState';

/**
 * Writes ONLY `config.<key>` (jsonb_set on that one key, never the whole config), and only if the
 * stored `lastCycleKey` is still the one the caller read is not this cycle, and is strictly later than `lastCycleAt`. A second worker
 * evaluating the same cycle, or a redelivered `notifyCycle`, therefore changes no row and the caller
 * sends nothing. Returns true when this call's UPDATE changed the row.
 */
export async function persistGuardedState(
  db: PostgresJsDatabase<typeof schema>,
  monitorId: string,
  key: WorkerStateKey,
  readCycleKey: string | undefined,
  cycleKey: string,
  cycleAt: Date,
  next: object,
  opts: {
    /** Which pair of fields carries the guard; the tool-list completion has its own pair. */
    keyField?: string;
    atField?: string;
    /** Other guard fields that must still hold the value the caller read (no lost update). */
    also?: Record<string, string | undefined>;
  } = {},
): Promise<boolean> {
  // `key` and the field names are closed literals from this module, so interpolating them is safe.
  const field = (name: string) =>
    sql.raw(`coalesce(config->'${key}'->>'${name}','')`);
  const lastKey = field(opts.keyField ?? 'lastCycleKey');
  const lastAt = sql.raw(
    `(config->'${key}'->>'${opts.atField ?? 'lastCycleAt'}')`,
  );
  const rows = await db
    .update(schema.monitors)
    .set({
      config: sql`jsonb_set(coalesce(${schema.monitors.config}, '{}'::jsonb), ${sql.raw(`'{${key}}'`)}, ${JSON.stringify(next)}::jsonb)`,
    })
    .where(
      and(
        eq(schema.monitors.id, monitorId),
        liveMonitor(),
        sql`${lastKey} <> ${cycleKey}`,
        sql`${lastKey} = ${readCycleKey ?? ''}`,
        // Strictly later than the newest evaluated cycle: a redelivered older cycle changes nothing.
        sql`(${lastAt} is null or ${lastAt}::timestamptz < ${cycleAt.toISOString()}::timestamptz)`,
        ...Object.entries(opts.also ?? {}).map(
          ([name, value]) => sql`${field(name)} = ${value ?? ''}`,
        ),
      ),
    )
    .returning({ id: schema.monitors.id });
  return rows.length > 0;
}

export type SlowStreak = { streak: number; episodeKey: string | null };

/**
 * One cycle of a "slow for 3 cycles in a row" rule. `slow` undefined means the cycle has no
 * measurement (a down check): the streak is left alone. The episode key is the first slow cycle's
 * key, kept while the streak runs; the warning fires exactly when the streak reaches 3, so it is
 * once per episode, and a fast cycle resets it.
 */
export function advanceSlowStreak(
  previous: { streak?: number; episodeKey?: string | null },
  slow: boolean | undefined,
  kind: MonitorWarningKind,
  cycleKey: string,
): SlowStreak & { fire: boolean } {
  const streak = previous.streak ?? 0;
  const episodeKey = previous.episodeKey ?? null;
  if (slow === undefined) return { streak, episodeKey, fire: false };
  if (!slow) return { streak: 0, episodeKey: null, fire: false };
  const next = streak + 1;
  const key = streak === 0 || !episodeKey ? `${kind}:${cycleKey}` : episodeKey;
  return {
    streak: next,
    episodeKey: key,
    fire: next === SLOW_CYCLES_BEFORE_WARNING,
  };
}
