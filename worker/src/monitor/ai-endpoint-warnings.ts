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
import { toolsInputOf } from './mcp-cycle-evaluation';
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

const aiOf = (rows: AiCycleResult[]) =>
  rows.flatMap((r) => {
    const value = (r.details as MonitorResultDetails | null | undefined)?.ai;
    return value ? [value] : [];
  });

/** The model part of a cycle runs once, and never for a cycle older than the newest one compared. */
const modelDue = (state: AiState, cycleAt: Date) =>
  !state.modelCycleAt || Date.parse(state.modelCycleAt) < cycleAt.getTime();

/**
 * Served model: silent on the first value, once per new value, always remembered. Locations that
 * disagree (regional deployments, routers) compare nothing, so the order of rows cannot flip it.
 */
function compareModel(
  state: AiState,
  next: AiState,
  ai: ReturnType<typeof aiOf>,
  cycleKey: string,
): Array<[MonitorWarningKind, string, string]> {
  const models = new Set(
    ai.flatMap((a) => (a.servedModel ? [a.servedModel] : [])),
  );
  const model = models.size === 1 ? [...models][0] : undefined;
  if (!model) return [];
  next.lastServedModel = model;
  return state.lastServedModel && state.lastServedModel !== model
    ? [
        [
          'ai_model_changed',
          'The endpoint now serves a different model',
          `ai_model_changed:${cycleKey}`,
        ],
      ]
    : [];
}

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
  /** Control-plane cycles: every location's reply once all have reported (the frozen view may lack some). */
  full?: { complete: boolean; upResults: AiCycleResult[] },
  retry = true,
): Promise<boolean> {
  try {
    const ai = aiOf(results);
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

    // A cycle closed before every region reported defers the model part to completeAiModel.
    if ((!full || full.complete) && modelDue(state, cycleAt)) {
      warnings.push(
        ...compareModel(
          state,
          next,
          aiOf(full ? full.upResults : results),
          cycleKey,
        ),
      );
      next.modelCycleKey = cycleKey;
      next.modelCycleAt = cycleAt.toISOString();
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
      { also: { modelCycleKey: state.modelCycleKey } },
    );
    if (!changed) {
      // A late-region model completion may have written between our read and write: read again once.
      return retry
        ? evaluateAiEndpointWarnings(
            db,
            alerts,
            monitorId,
            cycleKey,
            cycleAt,
            results,
            full,
            false,
          )
        : false;
    }
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

/**
 * Finishes the model part of a control-plane cycle that closed before every location reported. Called
 * when a late regional row of that cycle is saved: it runs only once every expected location has a real
 * row, uses its own `modelCycleKey/At` guard so the closure's slow and token parts are not counted twice,
 * and writes nothing else. Never throws.
 */
export async function completeAiModel(
  db: PostgresJsDatabase<typeof schema>,
  alerts: WarningSender,
  monitorId: string,
  cycleId: string,
  attempt = 1,
): Promise<boolean> {
  try {
    const [cycle] = await db
      .select({
        status: schema.monitorCycles.status,
        monitorId: schema.monitorCycles.monitorId,
        scheduledFor: schema.monitorCycles.scheduledFor,
        expectedLocations: schema.monitorCycles.expectedLocations,
      })
      .from(schema.monitorCycles)
      .where(eq(schema.monitorCycles.id, cycleId))
      .limit(1);
    if (!cycle || cycle.monitorId !== monitorId || cycle.status !== 'closed')
      return false;
    const rows = await db
      .select({
        location: schema.monitorResults.location,
        isUp: schema.monitorResults.isUp,
        details: schema.monitorResults.details,
        checkedAt: schema.monitorResults.checkedAt,
      })
      .from(schema.monitorResults)
      .where(
        and(
          eq(schema.monitorResults.monitorId, monitorId),
          eq(schema.monitorResults.executionGroupId, cycleId),
        ),
      );
    const input = toolsInputOf(cycle.expectedLocations, rows);
    if (!input.complete) return false;

    const [row] = await db
      .select({ config: schema.monitors.config })
      .from(schema.monitors)
      .where(and(eq(schema.monitors.id, monitorId), liveMonitor()))
      .limit(1);
    if (!row?.config?.aiEndpoint) return false;
    const state: AiState = row.config.aiEndpointState ?? {};
    const cycleAt = cycle.scheduledFor;
    if ((state.modelCycleKey ?? '') === cycleId || !modelDue(state, cycleAt))
      return false;
    const next: AiState = {
      ...state,
      modelCycleKey: cycleId,
      modelCycleAt: cycleAt.toISOString(),
    };
    const warnings = compareModel(state, next, aiOf(input.upResults), cycleId);
    const changed = await persistGuardedState(
      db,
      monitorId,
      'aiEndpointState',
      state.modelCycleKey,
      cycleId,
      cycleAt,
      next,
      {
        keyField: 'modelCycleKey',
        atField: 'modelCycleAt',
        also: { lastCycleKey: state.lastCycleKey },
      },
    );
    if (!changed)
      return attempt < 3
        ? completeAiModel(db, alerts, monitorId, cycleId, attempt + 1)
        : false;
    for (const [kind, reason, key] of warnings)
      await dispatchMonitorWarning(db, alerts, monitorId, kind, reason, key);
    return true;
  } catch (error) {
    logger.warn(
      `AI model completion failed for monitor ${monitorId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
