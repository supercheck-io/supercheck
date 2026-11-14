import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { liveMonitor } from '../db/deletion-visibility';
import type {
  McpMonitorState,
  McpResultDetails,
  McpToolChange,
} from '../db/schema/types';
import { diffTools, hasToolChanges } from './mcp-tool-diff';
import {
  dispatchMonitorWarning,
  type MonitorWarningKind,
} from './monitor-warning-dispatch';
import {
  advanceSlowStreak,
  persistGuardedState,
} from './monitor-warning-state';

const logger = new Logger('McpCycleEvaluation');
const MAX_CHANGES = 10;
const MAX_NAMES_PER_GROUP = 50;

/** The slice of a result row this needs; both saved rows and fresh check results fit. */
export type McpCycleResult = {
  responseTimeMs?: number | null;
  details?: unknown;
};

const mcpOf = (result: McpCycleResult): McpResultDetails | undefined => {
  const mcp = (result.details as { mcp?: McpResultDetails } | null | undefined)
    ?.mcp;
  return mcp && typeof mcp.toolsHash === 'string' && Array.isArray(mcp.tools)
    ? mcp
    : undefined;
};

/**
 * Tool-list change and slow-check evaluation, once per cycle. Called from every evaluation path
 * (control-plane `notifyCycle`, the legacy group path, the single-location path), so the baseline is
 * read from the monitor ROW (a job's config is a snapshot) and the cycle key makes a repeat harmless.
 * `upResults` are the cycle's up results; a down check never touches the baseline.
 * Never throws: a failure here must not break result saving or alert delivery.
 */
export async function evaluateMcpCycle(
  db: PostgresJsDatabase<typeof schema>,
  monitorId: string,
  cycleKey: string,
  cycleAt: Date,
  upResults: McpCycleResult[],
): Promise<boolean> {
  try {
    const ups = upResults.flatMap((result) => {
      const mcp = mcpOf(result);
      return mcp ? [{ mcp, ms: result.responseTimeMs ?? 0 }] : [];
    });
    if (ups.length === 0) return false;

    const [row] = await db
      .select({ config: schema.monitors.config })
      .from(schema.monitors)
      .where(and(eq(schema.monitors.id, monitorId), liveMonitor()))
      .limit(1);
    const settings = row?.config?.mcp;
    if (!settings) return false;
    const state: McpMonitorState = row.config?.mcpState ?? {};
    if ((state.lastCycleKey ?? '') === cycleKey) return false;
    // An older cycle redelivered after a newer one was evaluated must not rewind streaks or baselines.
    if (state.lastCycleAt && Date.parse(state.lastCycleAt) >= cycleAt.getTime())
      return false;

    const next: McpMonitorState = {
      ...state,
      lastCycleKey: cycleKey,
      lastCycleAt: cycleAt.toISOString(),
    };
    const warnings: Array<[MonitorWarningKind, string, string]> = [];
    const protocol = ups[0].mcp.protocol;
    if (protocol)
      next.detectedProtocol = protocol.startsWith('2026') ? '2026' : '2025';

    // Locations that disagree on the list record no change this cycle.
    const hash = ups[0].mcp.toolsHash as string;
    if (ups.every((up) => up.mcp.toolsHash === hash)) {
      const tools = ups[0].mcp.tools ?? [];
      if (!state.baseline) {
        next.baseline = { hash, takenAt: new Date().toISOString(), tools };
      } else if (state.baseline.hash !== hash) {
        const diff = diffTools(state.baseline.tools, tools);
        if (hasToolChanges(diff)) {
          const change: McpToolChange = {
            at: new Date().toISOString(),
            added: diff.added.slice(0, MAX_NAMES_PER_GROUP),
            removed: diff.removed.slice(0, MAX_NAMES_PER_GROUP),
            changed: diff.changed.slice(0, MAX_NAMES_PER_GROUP),
          };
          next.changes = [...(state.changes ?? []), change].slice(-MAX_CHANGES);
          warnings.push([
            'mcp_tools_changed',
            `Tool list changed: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`,
            `mcp_tools_changed:${cycleKey}`,
          ]);
        }
        next.baseline = { hash, takenAt: new Date().toISOString(), tools };
      }
    }

    // The slowest up location decides whether the cycle was slow.
    const slowMs = settings.slowMs;
    const slow = advanceSlowStreak(
      { streak: state.slowStreak, episodeKey: state.slowEpisodeKey },
      slowMs === undefined
        ? false
        : Math.max(...ups.map((up) => up.ms)) > slowMs,
      'mcp_slow',
      cycleKey,
    );
    next.slowStreak = slow.streak;
    next.slowEpisodeKey = slow.episodeKey;
    if (slow.fire && slow.episodeKey)
      warnings.push([
        'mcp_slow',
        `Checks took longer than ${slowMs} ms for 3 cycles in a row`,
        slow.episodeKey,
      ]);

    const changed = await persistGuardedState(
      db,
      monitorId,
      'mcpState',
      state.lastCycleKey,
      cycleKey,
      cycleAt,
      next,
    );
    if (!changed) return false;
    for (const [kind, reason, key] of warnings)
      await dispatchMonitorWarning(monitorId, kind, reason, key);
    return true;
  } catch (error) {
    logger.warn(
      `MCP cycle evaluation failed for monitor ${monitorId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
