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
import { diffTools, hasToolChanges, mcpEndpointKey } from './mcp-tool-diff';
import {
  dispatchMonitorWarning,
  type WarningSender,
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

type Up = { mcp: McpResultDetails; ms: number };

/**
 * Up results with MCP details. With `endpointKey`, a result stamped for other settings is dropped: a check
 * that started before a URL or login change must not seed the new baseline. Unstamped (older worker) results count.
 */
const upsOf = (results: McpCycleResult[], endpointKey?: string): Up[] =>
  results.flatMap((result) => {
    const mcp = mcpOf(result);
    if (!mcp) return [];
    if (endpointKey && mcp.endpointKey && mcp.endpointKey !== endpointKey)
      return [];
    return [{ mcp, ms: result.responseTimeMs ?? 0 }];
  });

/** What the tool-list part of a cycle sees: whether every expected location has reported, and the up ones. */
export type McpToolsInput = { complete: boolean; upResults: McpCycleResult[] };

/**
 * The tool-list part: baseline on first sight, a change when the up locations agree on a hash that
 * differs from the baseline. Never called for a cycle with a location still pending.
 */
function evaluateTools(
  state: McpMonitorState,
  next: McpMonitorState,
  ups: Up[],
  cycleKey: string,
): Array<[MonitorWarningKind, string, string]> {
  const warnings: Array<[MonitorWarningKind, string, string]> = [];
  if (ups.length === 0) return warnings;
  // Locations that disagree on the list record no change this cycle.
  const hash = ups[0].mcp.toolsHash as string;
  if (!ups.every((up) => up.mcp.toolsHash === hash)) return warnings;
  const tools = ups[0].mcp.tools ?? [];
  const now = new Date().toISOString();
  if (!state.baseline) {
    next.baseline = { hash, takenAt: now, tools };
  } else if (state.baseline.hash !== hash) {
    const diff = diffTools(state.baseline.tools, tools);
    // The hash covers the whole list, only the first 500 names are stored: no visible diff means the change is past them.
    const beyondStored = !hasToolChanges(diff);
    const change: McpToolChange = {
      at: now,
      added: diff.added.slice(0, MAX_NAMES_PER_GROUP),
      removed: diff.removed.slice(0, MAX_NAMES_PER_GROUP),
      changed: diff.changed.slice(0, MAX_NAMES_PER_GROUP),
      ...(beyondStored ? { beyondStored: true } : {}),
    };
    next.changes = [...(state.changes ?? []), change].slice(-MAX_CHANGES);
    warnings.push([
      'mcp_tools_changed',
      beyondStored
        ? 'Tool list changed beyond the stored tools'
        : `Tool list changed: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`,
      `mcp_tools_changed:${cycleKey}`,
    ]);
    next.baseline = { hash, takenAt: now, tools };
  }
  return warnings;
}

const toolsDue = (state: McpMonitorState, cycleAt: Date) =>
  !state.toolsCycleAt || Date.parse(state.toolsCycleAt) < cycleAt.getTime();

async function readState(
  db: PostgresJsDatabase<typeof schema>,
  monitorId: string,
) {
  const [row] = await db
    .select({ config: schema.monitors.config, target: schema.monitors.target })
    .from(schema.monitors)
    .where(and(eq(schema.monitors.id, monitorId), liveMonitor()))
    .limit(1);
  return row?.config?.mcp
    ? {
        settings: row.config.mcp,
        endpointKey: mcpEndpointKey(row.target, row.config.mcp.auth),
        state: row.config.mcpState ?? {},
      }
    : undefined;
}

/**
 * Tool-list change and slow-check evaluation, once per cycle. Called from every evaluation path
 * (control-plane `notifyCycle`, the legacy group path, the single-location path), so the baseline is
 * read from the monitor ROW (a job's config is a snapshot) and the cycle key makes a repeat harmless.
 * `upResults` are the cycle's up results as the closure saw them (they drive the slow streak); a down
 * check never touches the baseline. `tools` is what the tool-list part may use: when a location is
 * still pending (a cycle closed early by a decisive arrival) the part is skipped and
 * `completeMcpTools` finishes it once the late rows are in. Omitted, every result is the full set.
 * Never throws: a failure here must not break result saving or alert delivery.
 */
export async function evaluateMcpCycle(
  db: PostgresJsDatabase<typeof schema>,
  alerts: WarningSender,
  monitorId: string,
  cycleKey: string,
  cycleAt: Date,
  upResults: McpCycleResult[],
  tools: McpToolsInput = { complete: true, upResults },
  retry = true,
): Promise<boolean> {
  try {
    if (upsOf(upResults).length === 0) return false;
    const current = await readState(db, monitorId);
    if (!current) return false;
    const { settings, state, endpointKey } = current;
    const ups = upsOf(upResults, endpointKey);
    if (ups.length === 0) return false;
    if ((state.lastCycleKey ?? '') === cycleKey) return false;
    // An older cycle redelivered after a newer one was evaluated must not rewind streaks or baselines.
    if (state.lastCycleAt && Date.parse(state.lastCycleAt) >= cycleAt.getTime())
      return false;

    const next: McpMonitorState = {
      ...state,
      lastCycleKey: cycleKey,
      lastCycleAt: cycleAt.toISOString(),
    };
    const protocol = ups[0].mcp.protocol;
    if (protocol)
      next.detectedProtocol = protocol.startsWith('2026') ? '2026' : '2025';

    const warnings: Array<[MonitorWarningKind, string, string]> = [];
    if (tools.complete && toolsDue(state, cycleAt)) {
      warnings.push(
        ...evaluateTools(
          state,
          next,
          upsOf(tools.upResults, endpointKey),
          cycleKey,
        ),
      );
      next.toolsCycleKey = cycleKey;
      next.toolsCycleAt = cycleAt.toISOString();
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
      { also: { toolsCycleKey: state.toolsCycleKey } },
    );
    if (!changed) {
      // A tool-list completion of an earlier cycle may have written between our read and write: read again once.
      return retry
        ? evaluateMcpCycle(
            db,
            alerts,
            monitorId,
            cycleKey,
            cycleAt,
            upResults,
            tools,
            false,
          )
        : false;
    }
    for (const [kind, reason, key] of warnings)
      await dispatchMonitorWarning(db, alerts, monitorId, kind, reason, key);
    return true;
  } catch (error) {
    logger.warn(
      `MCP cycle evaluation failed for monitor ${monitorId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Finishes the tool-list part of a cycle that closed before every location reported. Called when a
 * late regional row of that cycle is saved (and harmless anywhere else): it runs only when every
 * expected location of the closed cycle now has a real row, uses its own `toolsCycleKey/At` guard so it
 * cannot double-count the slow streak the closure already handled, and writes nothing else.
 */
export async function completeMcpTools(
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
        responseTimeMs: schema.monitorResults.responseTimeMs,
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

    const current = await readState(db, monitorId);
    if (!current) return false;
    const { state } = current;
    const cycleAt = cycle.scheduledFor;
    if ((state.toolsCycleKey ?? '') === cycleId || !toolsDue(state, cycleAt))
      return false;
    const next: McpMonitorState = {
      ...state,
      toolsCycleKey: cycleId,
      toolsCycleAt: cycleAt.toISOString(),
    };
    const warnings = evaluateTools(
      state,
      next,
      upsOf(input.upResults, current.endpointKey),
      cycleId,
    );
    const changed = await persistGuardedState(
      db,
      monitorId,
      'mcpState',
      state.toolsCycleKey,
      cycleId,
      cycleAt,
      next,
      {
        keyField: 'toolsCycleKey',
        atField: 'toolsCycleAt',
        also: { lastCycleKey: state.lastCycleKey },
      },
    );
    if (!changed) {
      // Another writer (the closure's evaluation) moved the state between our read and write: re-read, bounded.
      // The retry returns false at once if this cycle's tool part was already recorded.
      return attempt < 3
        ? completeMcpTools(db, alerts, monitorId, cycleId, attempt + 1)
        : false;
    }
    for (const [kind, reason, key] of warnings)
      await dispatchMonitorWarning(db, alerts, monitorId, kind, reason, key);
    return true;
  } catch (error) {
    logger.warn(
      `MCP tool-list completion failed for monitor ${monitorId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * From every row the cycle has now (not the closure's frozen view): complete when each expected
 * location has a real (non-synthetic) row, and the up results are each location's newest up row.
 */
export function toolsInputOf(
  expectedLocations: string[],
  rows: Array<
    McpCycleResult & { location: string; isUp: boolean; checkedAt?: Date }
  >,
): McpToolsInput {
  const newest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if ((row.details as { synthetic?: boolean } | null)?.synthetic) continue;
    const seen = newest.get(row.location);
    if (
      !seen ||
      (row.checkedAt?.getTime() ?? 0) > (seen.checkedAt?.getTime() ?? 0)
    )
      newest.set(row.location, row);
  }
  const expected = [...new Set(expectedLocations)];
  return {
    complete: expected.length > 0 && expected.every((l) => newest.has(l)),
    upResults: expected.flatMap((l) => {
      const row = newest.get(l);
      return row?.isUp ? [row] : [];
    }),
  };
}
