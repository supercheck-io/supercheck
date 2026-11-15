import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import type { MonitorConfig } from '../db/schema/types';
import { evaluateAgentRunWarning } from './agent-run-warning';
import { evaluateAiEndpointWarnings } from './ai-endpoint-warnings';
import { evaluateMcpCycle, type McpToolsInput } from './mcp-cycle-evaluation';
import type { WarningSender } from './monitor-warning-dispatch';

type CycleResult = {
  isUp: boolean;
  responseTimeMs?: number | null;
  details?: unknown;
};

/**
 * Per-cycle MCP and AI endpoint evaluation, shared by every evaluation path (control-plane
 * `notifyCycle`, the legacy group path and the single-location path). `cycleKey` is the control-plane
 * cycle id, else the execution group id, else the result id. Both evaluators log and swallow their
 * own failures, so result saving and alert delivery never depend on them.
 */
export async function evaluateCycleWarnings(
  db: PostgresJsDatabase<typeof schema>,
  alerts: WarningSender,
  monitor: { id: string; type: string; config: MonitorConfig | null },
  cycleKey: string,
  cycleAt: Date,
  results: CycleResult[],
  /** The cycle's up rows once every location reported (control-plane path): MCP tools and the AI served model. */
  tools?: McpToolsInput,
): Promise<void> {
  if (monitor.type === 'mcp_server')
    await evaluateMcpCycle(
      db,
      alerts,
      monitor.id,
      cycleKey,
      cycleAt,
      results.filter((result) => result.isUp),
      tools,
    );
  else if (monitor.type === 'http_request' && monitor.config?.aiEndpoint)
    await evaluateAiEndpointWarnings(
      db,
      alerts,
      monitor.id,
      cycleKey,
      cycleAt,
      results,
      tools,
    );
  else if (monitor.type === 'synthetic_test')
    await evaluateAgentRunWarning(db, alerts, monitor.id, results);
}
