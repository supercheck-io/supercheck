import { Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { liveMonitor } from '../db/deletion-visibility';
import {
  dispatchMonitorWarning,
  type WarningSender,
} from './monitor-warning-dispatch';

const logger = new Logger('AgentRunWarning');

type CycleResult = { isUp: boolean; location: string; details?: unknown };

/**
 * A failed agent test run that is still below the failure threshold sends `agent_run_failed`; the run
 * that reaches the threshold opens the incident instead. Streaks are per location, so each failing
 * location warns on its own newest row. The episode is that streak: its `outageKey` (a UUID minted per
 * location chain), so one warning per streak per channel.
 * Runs after the result rows are stored, and logs and swallows its own failures.
 */
export async function evaluateAgentRunWarning(
  db: PostgresJsDatabase<typeof schema>,
  alerts: WarningSender,
  monitorId: string,
  results: CycleResult[],
): Promise<void> {
  const failures = new Map<string, CycleResult>();
  for (const r of results)
    if (
      !r.isUp &&
      (r.details as { testType?: unknown })?.testType === 'agent' &&
      !failures.has(r.location)
    )
      failures.set(r.location, r);
  for (const failed of failures.values())
    await warnLocation(db, alerts, monitorId, failed);
}

async function warnLocation(
  db: PostgresJsDatabase<typeof schema>,
  alerts: WarningSender,
  monitorId: string,
  failed: CycleResult,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        id: schema.monitorResults.id,
        isUp: schema.monitorResults.isUp,
        count: schema.monitorResults.consecutiveFailureCount,
        details: schema.monitorResults.details,
      })
      .from(schema.monitorResults)
      .where(
        and(
          eq(schema.monitorResults.monitorId, monitorId),
          eq(schema.monitorResults.location, failed.location),
        ),
      )
      .orderBy(desc(schema.monitorResults.checkedAt))
      .limit(1);
    if (!row || row.isUp) return;
    const [monitor] = await db
      .select({ alertConfig: schema.monitors.alertConfig })
      .from(schema.monitors)
      .where(and(eq(schema.monitors.id, monitorId), liveMonitor()))
      .limit(1);
    const threshold = monitor?.alertConfig?.failureThreshold ?? 1;
    if (!monitor || row.count >= threshold) return;
    const agent = (
      failed.details as { agent?: { passRate?: number; attempts?: number } }
    ).agent;
    const rate =
      typeof agent?.passRate === 'number' && agent.attempts
        ? `; pass rate ${Math.round(agent.passRate * 100)}% over ${agent.attempts} attempts`
        : '';
    const outage = (row.details as { outageKey?: unknown } | null)?.outageKey;
    await dispatchMonitorWarning(
      db,
      alerts,
      monitorId,
      'agent_run_failed',
      `Agent run failed (${row.count} of ${threshold} before an incident)${rate}`,
      `agent_run_failed:${typeof outage === 'string' ? outage : row.id}`,
    );
  } catch (error) {
    logger.warn(
      `Agent run warning for monitor ${monitorId} (${failed.location}) was not sent: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
