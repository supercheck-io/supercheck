import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import type { MonitorConfig } from '../db/schema/types';
import { evaluateAiEndpointWarnings } from './ai-endpoint-warnings';
import { evaluateMcpCycle, type McpToolsInput } from './mcp-cycle-evaluation';

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
  monitor: { id: string; type: string; config: MonitorConfig | null },
  cycleKey: string,
  cycleAt: Date,
  results: CycleResult[],
  /** MCP only: the cycle's full row set when it closed before every location reported. */
  tools?: McpToolsInput,
): Promise<void> {
  if (monitor.type === 'mcp_server')
    await evaluateMcpCycle(
      db,
      monitor.id,
      cycleKey,
      cycleAt,
      results.filter((result) => result.isUp),
      tools,
    );
  else if (monitor.type === 'http_request' && monitor.config?.aiEndpoint)
    await evaluateAiEndpointWarnings(
      db,
      monitor.id,
      cycleKey,
      cycleAt,
      results,
    );
}
