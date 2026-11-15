import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { liveMonitor } from '../db/deletion-visibility';
import type { MonitorAlertService } from './services/monitor-alert.service';

export type MonitorWarningKind =
  | 'mcp_tools_changed'
  | 'mcp_slow'
  | 'ai_slow_first_token'
  | 'ai_model_changed'
  | 'ai_tokens_high';

export type WarningSender = Pick<MonitorAlertService, 'sendWarning'>;

const logger = new Logger('MonitorWarning');

/**
 * The one place every MCP and AI endpoint warning leaves through. `episodeKey` starts with the kind
 * and names the detection (never a value), so the alert claim stays unique per detection.
 * The row is read fresh so the toggle, channels and name are the ones saved now; `reason` is built
 * from numbers and names, never secrets. At most once: the evaluators commit their state first, so a
 * crash or failed send here is not retried by a redelivered cycle.
 */
export async function dispatchMonitorWarning(
  db: PostgresJsDatabase<typeof schema>,
  alerts: WarningSender,
  monitorId: string,
  kind: MonitorWarningKind,
  reason: string,
  episodeKey: string,
): Promise<void> {
  try {
    const [monitor] = await db
      .select({
        id: schema.monitors.id,
        name: schema.monitors.name,
        type: schema.monitors.type,
        target: schema.monitors.target,
        projectId: schema.monitors.projectId,
        alertConfig: schema.monitors.alertConfig,
        deletingAt: schema.monitors.deletingAt,
      })
      .from(schema.monitors)
      .where(and(eq(schema.monitors.id, monitorId), liveMonitor()))
      .limit(1);
    if (monitor) await alerts.sendWarning(monitor, kind, reason, episodeKey);
  } catch (error) {
    // State already moved on; a lost send must not stop the other warnings of the cycle.
    logger.warn(
      `Warning ${kind} for monitor ${monitorId} was not sent: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
