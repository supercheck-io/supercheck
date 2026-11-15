import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { liveMonitor } from '../db/deletion-visibility';
import type { MonitorConfig, MonitorResultDetails } from '../db/schema/types';
import {
  dispatchMonitorWarning,
  type WarningSender,
  type MonitorWarningKind,
} from './monitor-warning-dispatch';
import {
  advanceSlowStreak,
  persistGuardedState,
} from './monitor-warning-state';

const logger = new Logger('AiEndpointWarnings');

export type AiCycleResult = { details?: unknown };

type AiState = NonNullable<MonitorConfig['aiEndpointState']>;

const max = (values: Array<number | undefined>) => {
  const present = values.filter((v): v is number => typeof v === 'number');
  return present.length ? Math.max(...present) : undefined;
};

/**
 * AI endpoint warnings for one cycle (http_request monitors with `config.aiEndpoint`): slow first
 * token for 3 cycles, served model changed, tokens high. Same shape as the MCP evaluation: state is read from the
 * monitor row, written with jsonb_set on `aiEndpointState` only, guarded by `lastCycleKey`, and only
 * the caller whose UPDATE changed the row sends. Never throws.
 */
export async function evaluateAiEndpointWarnings(
  db: PostgresJsDatabase<typeof schema>,
  alerts: WarningSender,
  monitorId: string,
  cycleKey: string,
  cycleAt: Date,
  results: AiCycleResult[],
): Promise<boolean> {
  try {
    const ai = results.flatMap((r) => {
      const value = (r.details as MonitorResultDetails | null | undefined)?.ai;
      return value ? [value] : [];
    });
    if (ai.length === 0) return false;

    const [row] = await db
      .select({ config: schema.monitors.config })
      .from(schema.monitors)
      .where(and(eq(schema.monitors.id, monitorId), liveMonitor()))
      .limit(1);
    const settings = row?.config?.aiEndpoint;
    if (!settings) return false;
    const state: AiState = row.config?.aiEndpointState ?? {};
    if ((state.lastCycleKey ?? '') === cycleKey) return false;
    // An older cycle redelivered after a newer one was evaluated must not rewind streaks or baselines.
    if (state.lastCycleAt && Date.parse(state.lastCycleAt) >= cycleAt.getTime())
      return false;

    const next: AiState = {
      ...state,
      lastCycleKey: cycleKey,
      lastCycleAt: cycleAt.toISOString(),
    };
    const warnings: Array<[MonitorWarningKind, string, string]> = [];

    // Served model: silent on the first value, once per new value, always remembered.
    const model = ai.find((a) => a.servedModel)?.servedModel;
    if (model) {
      if (state.lastServedModel && state.lastServedModel !== model)
        warnings.push([
          'ai_model_changed',
          'The endpoint now serves a different model',
          `ai_model_changed:${cycleKey}`,
        ]);
      next.lastServedModel = model;
    }

    // First token: the slowest location decides; a cycle with no first token (down) is left alone.
    const firstToken = max(ai.map((a) => a.firstTokenMs));
    const limit = settings.warnFirstTokenMs;
    const slow = advanceSlowStreak(
      {
        streak: state.slowFirstTokenStreak,
        episodeKey: state.slowFirstTokenEpisodeKey,
      },
      limit === undefined
        ? false
        : firstToken === undefined
          ? undefined
          : firstToken > limit,
      'ai_slow_first_token',
      cycleKey,
    );
    next.slowFirstTokenStreak = slow.streak;
    next.slowFirstTokenEpisodeKey = slow.episodeKey;
    if (slow.fire && slow.episodeKey)
      warnings.push([
        'ai_slow_first_token',
        `First token took longer than ${limit} ms for 3 cycles in a row`,
        slow.episodeKey,
      ]);

    // Tokens: one warning per episode; a call back under the limit ends it.
    const tokens = max(ai.map((a) => a.totalTokens));
    const tokenLimit = settings.warnTotalTokens;
    if (tokenLimit === undefined) next.tokensHighEpisodeKey = null;
    else if (tokens !== undefined) {
      if (tokens > tokenLimit) {
        if (!state.tokensHighEpisodeKey) {
          next.tokensHighEpisodeKey = `ai_tokens_high:${cycleKey}`;
          warnings.push([
            'ai_tokens_high',
            `A call used ${tokens} tokens, above the ${tokenLimit} limit`,
            next.tokensHighEpisodeKey,
          ]);
        }
      } else next.tokensHighEpisodeKey = null;
    }

    const changed = await persistGuardedState(
      db,
      monitorId,
      'aiEndpointState',
      state.lastCycleKey,
      cycleKey,
      cycleAt,
      next,
    );
    if (!changed) return false;
    for (const [kind, reason, key] of warnings)
      await dispatchMonitorWarning(db, alerts, monitorId, kind, reason, key);
    return true;
  } catch (error) {
    logger.warn(
      `AI endpoint warning evaluation failed for monitor ${monitorId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
