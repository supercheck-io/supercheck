import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import * as schema from '../db/schema';
import type { MonitorCycleEvaluation } from '../db/schema';
import { MonitorAlertService } from '../monitor/services/monitor-alert.service';
import { MonitorEvaluator } from '../monitor/monitor-evaluator';
import type { MonitorExecutionResult } from '../monitor/types/monitor-result.type';
import { BillingHoldService } from './billing-hold.service';
import { decideMonitorCycle } from './cycle-policy';
import { nextSequenceCounters } from './sequence-counters';

export type CloseOutcome =
  | 'noop'
  | 'waiting'
  | 'closed'
  | 'superseded'
  | 'aborted';

type ResultRow = typeof schema.monitorResults.$inferSelect;

/**
 * Closes monitor check cycles and owns their notification. One monitor row lock serializes every
 * state change for a monitor, so an older deadline can never overwrite a newer cycle's state.
 */
@Injectable()
export class MonitorCycleService {
  private readonly logger = new Logger(MonitorCycleService.name);
  private readonly evaluator: MonitorEvaluator;

  constructor(
    private readonly dbService: DbService,
    alertService: MonitorAlertService,
    private readonly billing: BillingHoldService,
  ) {
    this.evaluator = new MonitorEvaluator(dbService, alertService);
  }

  /** Idempotent: a second caller sees a non-open cycle and does nothing. */
  async closeCycle(
    cycleId: string,
    now: Date = new Date(),
  ): Promise<CloseOutcome> {
    return this.dbService.db.transaction(async (tx) => {
      const [cycle] = await tx
        .select()
        .from(schema.monitorCycles)
        .where(eq(schema.monitorCycles.id, cycleId))
        .limit(1)
        .for('update');
      if (!cycle || cycle.status !== 'open') return 'noop';

      // Lock order is always cycle -> monitor; no path waits on a second cycle, so no deadlock.
      const [monitor] = await tx
        .select()
        .from(schema.monitors)
        .where(eq(schema.monitors.id, cycle.monitorId))
        .limit(1)
        .for('update');
      if (!monitor) {
        await this.finish(tx, cycleId, 'aborted', now);
        return 'aborted';
      }

      const rows = await tx
        .select()
        .from(schema.monitorResults)
        .where(
          and(
            eq(schema.monitorResults.monitorId, cycle.monitorId),
            eq(schema.monitorResults.executionGroupId, cycle.id),
          ),
        )
        .orderBy(desc(schema.monitorResults.checkedAt));
      const latest = new Map<string, ResultRow>();
      for (const row of rows) {
        if (!latest.has(row.location)) latest.set(row.location, row);
      }
      const expected = [...new Set(cycle.expectedLocations)];
      const statuses: Record<string, boolean> = {};
      for (const location of expected) {
        const row = latest.get(location);
        if (row) statuses[location] = row.isUp;
      }

      const decision = decideMonitorCycle(
        {
          expectedLocations: expected,
          strategy: cycle.strategy,
          threshold: cycle.threshold,
        },
        statuses,
        now.getTime() >= cycle.deadlineAt.getTime(),
      );
      if (!decision) return 'waiting';

      // Paused, disabled or billing-held monitors must never become missing-region downtime.
      if (!monitor.enabled || monitor.status === 'paused') {
        await this.finish(tx, cycleId, 'aborted', now);
        return 'aborted';
      }
      const hold = await this.billing.isHeld(monitor.organizationId, monitor);
      if (hold.blocked) {
        this.logger.warn(
          `Cycle ${cycleId} not evaluated for monitor ${monitor.id}: ${hold.reason}`,
        );
        await this.finish(tx, cycleId, 'aborted', now);
        return 'aborted';
      }

      const observedAt = decision.observed
        .map((location) => latest.get(location)!.checkedAt.getTime())
        .reduce(
          (max, time) => Math.max(max, time),
          cycle.scheduledFor.getTime(),
        );
      const checkedAt = new Date(observedAt);

      // At the deadline, missing regions become explicit failed rows so uptime and status pages show
      // the outage. A decisive early arrival has not failed anyone: those regions just haven't reported,
      // and a late result stays a diagnostic row.
      const synthetic =
        decision.closedBy === 'deadline' ? decision.missing : [];
      for (const location of synthetic) {
        const [previous] = await tx
          .select()
          .from(schema.monitorResults)
          .where(
            and(
              eq(schema.monitorResults.monitorId, cycle.monitorId),
              eq(schema.monitorResults.location, location),
            ),
          )
          .orderBy(desc(schema.monitorResults.checkedAt))
          .limit(1);
        const counters = nextSequenceCounters(previous, false);
        await tx.insert(schema.monitorResults).values({
          monitorId: cycle.monitorId,
          location,
          checkedAt: cycle.scheduledFor,
          status: 'error',
          isUp: false,
          responseTimeMs: null,
          details: {
            synthetic: true,
            errorMessage: `No result from ${location} before the cycle deadline`,
            executionGroupId: cycle.id,
            recoverySequence: false,
          },
          isStatusChange: counters.isStatusChange,
          consecutiveFailureCount: counters.consecutiveFailureCount,
          consecutiveSuccessCount: counters.consecutiveSuccessCount,
          alertsSentForFailure: counters.alertsSentForFailure,
          alertsSentForRecovery: counters.alertsSentForRecovery,
          executionGroupId: cycle.id,
        });
      }

      // A newer cycle already advanced this monitor: keep the history, leave the state alone.
      if (monitor.lastCheckAt && monitor.lastCheckAt > checkedAt) {
        await this.finish(tx, cycleId, 'closed', now, {
          closedBy: decision.closedBy,
          resultStatus: decision.status,
          observed: decision.observed,
          missing: decision.missing,
          notifiedAt: now,
        });
        return 'superseded';
      }

      const previousStatus = monitor.status;
      const evaluation: MonitorCycleEvaluation = {
        previousStatus,
        currentStatus: decision.status,
        reason: this.buildReason(
          decision,
          expected,
          decision.observed.filter((location) => statuses[location]).length,
        ),
        avgResponseTimeMs: this.averageResponse(
          decision.observed.map((location) => latest.get(location)!),
        ),
      };
      if (
        this.evaluator.isMultiLocationEvaluation(
          monitor.config,
          expected.length,
        )
      ) {
        const previousState = this.evaluator.readAggregatedAlertState(
          monitor.config,
        );
        evaluation.alertState = {
          ...(monitor.alertConfig?.enabled &&
          !['pending', 'paused'].includes(previousStatus)
            ? this.evaluator.getNextAggregatedAlertState(
                previousState,
                previousStatus,
                decision.status,
              )
            : previousState),
          executionGroupId: cycle.id,
        };
      }
      await tx
        .update(schema.monitors)
        .set({
          status: decision.status,
          lastCheckAt: checkedAt,
          lastStatusChangeAt:
            previousStatus !== decision.status ? checkedAt : undefined,
          ...(evaluation.alertState
            ? {
                config: {
                  ...(monitor.config ?? {}),
                  aggregatedAlertState: evaluation.alertState,
                },
              }
            : {}),
        })
        .where(eq(schema.monitors.id, monitor.id));
      await this.finish(tx, cycleId, 'closed', now, {
        closedBy: decision.closedBy,
        resultStatus: decision.status,
        observed: decision.observed,
        missing: decision.missing,
        evaluation,
      });
      return 'closed';
    });
  }

  /**
   * At-least-once: the receipt is written after delivery, so a crash in between re-sends. The
   * evaluator keeps recovery-once semantics (zero successful deliveries stays eligible).
   */
  async notifyCycle(cycleId: string): Promise<boolean> {
    const [cycle] = await this.dbService.db
      .select()
      .from(schema.monitorCycles)
      .where(eq(schema.monitorCycles.id, cycleId))
      .limit(1);
    if (
      !cycle ||
      cycle.status !== 'closed' ||
      cycle.notifiedAt ||
      !cycle.evaluation
    )
      return false;
    const [monitor] = await this.dbService.db
      .select()
      .from(schema.monitors)
      .where(eq(schema.monitors.id, cycle.monitorId))
      .limit(1);
    if (!monitor) return false;
    const rows = await this.dbService.db
      .select()
      .from(schema.monitorResults)
      .where(
        and(
          eq(schema.monitorResults.monitorId, cycle.monitorId),
          eq(schema.monitorResults.executionGroupId, cycle.id),
        ),
      )
      .orderBy(desc(schema.monitorResults.checkedAt));
    const evaluation = cycle.evaluation;
    await this.evaluator.evaluateAndSendAlert({
      monitorId: monitor.id,
      monitor,
      previousStatus: evaluation.previousStatus,
      currentStatus: evaluation.currentStatus,
      reason: evaluation.reason,
      preparedAlertState: evaluation.alertState,
      metadata: {
        responseTime: evaluation.avgResponseTimeMs,
        locationResults: rows.map((row) => ({
          location: row.location,
          isUp: row.isUp,
          responseTime: row.responseTimeMs,
        })),
      },
    });
    for (const row of rows) {
      if ((row.details as { synthetic?: boolean } | null)?.synthetic) continue;
      await this.evaluator.checkSslExpirationAlert(
        this.toExecutionResult(row),
        monitor,
      );
    }
    await this.dbService.db
      .update(schema.monitorCycles)
      .set({ notifiedAt: new Date() })
      .where(
        and(
          eq(schema.monitorCycles.id, cycleId),
          sql`${schema.monitorCycles.notifiedAt} IS NULL`,
        ),
      );
    return true;
  }

  private async finish(
    tx: Parameters<Parameters<DbService['db']['transaction']>[0]>[0],
    cycleId: string,
    status: 'closed' | 'aborted',
    now: Date,
    extra: {
      closedBy?: 'arrival' | 'deadline';
      resultStatus?: 'up' | 'down';
      observed?: string[];
      missing?: string[];
      evaluation?: MonitorCycleEvaluation;
      notifiedAt?: Date;
    } = {},
  ): Promise<void> {
    await tx
      .update(schema.monitorCycles)
      .set({
        status,
        closedAt: now,
        closedBy: extra.closedBy,
        resultStatus: extra.resultStatus,
        observedLocations: extra.observed,
        missingLocations: extra.missing,
        evaluation: extra.evaluation,
        // An aborted cycle has nothing to notify.
        notifiedAt: status === 'aborted' ? now : extra.notifiedAt,
      })
      .where(eq(schema.monitorCycles.id, cycleId));
  }

  private buildReason(
    decision: NonNullable<ReturnType<typeof decideMonitorCycle>>,
    expected: string[],
    upCount: number,
  ): string {
    const total = expected.length;
    const missing = decision.missing.length
      ? ` (no results from ${decision.missing.join(', ')})`
      : '';
    return decision.status === 'down'
      ? `Monitor is down in ${total - upCount}/${total} locations${missing}`
      : `Monitor has recovered (${upCount}/${total} locations up)`;
  }

  private averageResponse(rows: ResultRow[]): number {
    const times = rows
      .map((row) => row.responseTimeMs)
      .filter((value): value is number => typeof value === 'number');
    return times.length
      ? times.reduce((sum, value) => sum + value, 0) / times.length
      : 0;
  }

  private toExecutionResult(row: ResultRow): MonitorExecutionResult {
    return {
      monitorId: row.monitorId,
      location: row.location,
      status: row.status,
      checkedAt: row.checkedAt,
      responseTimeMs: row.responseTimeMs ?? undefined,
      details: (row.details as MonitorExecutionResult['details']) ?? undefined,
      isUp: row.isUp,
      testExecutionId: row.testExecutionId ?? undefined,
      testReportS3Url: row.testReportS3Url ?? undefined,
    };
  }
}
