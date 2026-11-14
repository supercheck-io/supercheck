import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import type { MonitorConfig } from '../db/schema/types';
import { evaluateAiEndpointWarnings } from './ai-endpoint-warnings';
import { evaluateMcpCycle } from './mcp-cycle-evaluation';

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
  results: CycleResult[],
): Promise<void> {
  if (monitor.type === 'mcp_server')
    await evaluateMcpCycle(
      db,
      monitor.id,
      cycleKey,
      results.filter((result) => result.isUp),
    );
  else if (monitor.type === 'http_request' && monitor.config?.aiEndpoint)
    await evaluateAiEndpointWarnings(db, monitor.id, cycleKey, results);
}
