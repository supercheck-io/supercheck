import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import * as schema from '../db/schema';
import type { MonitorCycleEvaluation } from '../db/schema';
import { MonitorAlertService } from '../monitor/services/monitor-alert.service';
import { MonitorEvaluator } from '../monitor/monitor-evaluator';
import type { MonitorExecutionResult } from '../monitor/types/monitor-result.type';
import { BillingHoldService } from './billing-hold.service';
import { decideMonitorCycle } from './cycle-policy';
import { nextSequenceCounters } from './sequence-counters';

/** Bounded redelivery: repair backs off by one minute per failed attempt. */
export const MAX_NOTIFY_ATTEMPTS = 5;

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

  /**
   * Idempotent: a second caller sees a non-open cycle and does nothing.
   *
   * Lock order is monitor -> cycle, the same order a cascading monitor/organization delete takes,
   * so the two can never deadlock. Both locks are NO KEY UPDATE: they still exclude every other
   * closer and the legacy aggregation path (which takes FOR UPDATE on the monitor), but they do not
   * block the foreign-key checks of regional result inserts, arrival hints or the next cycle.
   */
  async closeCycle(
    cycleId: string,
    now: Date = new Date(),
  ): Promise<CloseOutcome> {
    const [peek] = await this.dbService.db
      .select({
        status: schema.monitorCycles.status,
        monitorId: schema.monitorCycles.monitorId,
      })
      .from(schema.monitorCycles)
      .where(eq(schema.monitorCycles.id, cycleId))
      .limit(1);
    if (!peek || peek.status !== 'open') return 'noop';

    return this.dbService.db.transaction(async (tx) => {
      const [monitor] = await tx
        .select()
        .from(schema.monitors)
        .where(eq(schema.monitors.id, peek.monitorId))
        .limit(1)
        .for('no key update');
      // A deleted monitor cascades its cycles away.
      if (!monitor) return 'noop';
      const [cycle] = await tx
        .select()
        .from(schema.monitorCycles)
        .where(eq(schema.monitorCycles.id, cycleId))
        .limit(1)
        .for('no key update');
      if (!cycle || cycle.status !== 'open') return 'noop';

      const expected = [...new Set(cycle.expectedLocations)];
      if (expected.length === 0) {
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

      // An older-image worker may have aggregated this group through the legacy Redis path
      // (rollout or rollback). It already advanced the counters and alerted: never do it twice.
      const legacyEvaluated =
        rows.some(
          (row) =>
            (row.details as { aggregationEvaluation?: unknown } | null)
              ?.aggregationEvaluation,
        ) ||
        (
          monitor.config as {
            aggregatedAlertState?: { executionGroupId?: string };
          } | null
        )?.aggregatedAlertState?.executionGroupId === cycle.id;
      if (legacyEvaluated) {
        await this.finish(tx, cycleId, 'closed', now, { notifiedAt: now });
        return 'superseded';
      }

      const latest = new Map<string, ResultRow>();
      for (const row of rows) {
        if (!latest.has(row.location)) latest.set(row.location, row);
      }
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
      // Checked on the same transaction (no second connection). A failed verification throws,
      // rolling back and leaving the cycle open for the next tick.
      const hold = await this.billing.isHeld(
        monitor.organizationId,
        monitor,
        tx as never,
      );
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
      // the outage. A decisive early arrival has not failed anyone: those regions just haven't
      // reported, and a late result stays a diagnostic row.
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

      // A newer cycle was already applied to this monitor: keep this one's history, leave the state
      // alone. Ordered by the cycles' own scheduled time, not by result timestamps, so slow regions,
      // clock skew and app-written status updates cannot mis-order it.
      const [newer] = await tx
        .select({ id: schema.monitorCycles.id })
        .from(schema.monitorCycles)
        .where(
          and(
            eq(schema.monitorCycles.monitorId, cycle.monitorId),
            gt(schema.monitorCycles.scheduledFor, cycle.scheduledFor),
            eq(schema.monitorCycles.status, 'closed'),
            isNotNull(schema.monitorCycles.evaluation),
          ),
        )
        .limit(1);
      if (newer) {
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
      const observedRows = decision.observed.map(
        (location) => latest.get(location)!,
      );
      const evaluation: MonitorCycleEvaluation = {
        previousStatus,
        currentStatus: decision.status,
        reason: this.buildReason(
          decision,
          expected,
          decision.observed.filter((location) => statuses[location]).length,
        ),
        avgResponseTimeMs: this.averageResponse(observedRows),
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
   * At-least-once: the receipt is written only after delivery succeeded (or nothing was due, or the
   * alert was deliberately suppressed). A failed delivery leaves the cycle without a receipt so the
   * repair pass retries it with backoff; after MAX_NOTIFY_ATTEMPTS it gives up and says so loudly.
   * A crash between delivery and receipt re-sends once. The evaluator keeps recovery-once
   * semantics (zero successful deliveries stays eligible).
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
    const pendingEarly = cycle.closedBy === 'arrival';
    const outcome = await this.evaluator.evaluateAndSendAlert({
      monitorId: monitor.id,
      monitor,
      previousStatus: evaluation.previousStatus,
      currentStatus: evaluation.currentStatus,
      reason: evaluation.reason,
      preparedAlertState: evaluation.alertState,
      metadata: {
        responseTime: evaluation.avgResponseTimeMs,
        // One entry per expected region, like the legacy path: the evaluator derives its
        // multi-location mode from this count, so it must match the mode chosen at closure.
        locationResults: [...new Set(cycle.expectedLocations)].map(
          (location) => {
            const row = rows.find(
              (candidate) => candidate.location === location,
            );
            if (row)
              return {
                location,
                isUp: row.isUp,
                responseTime: row.responseTimeMs,
              };
            // Early closure: the region has not reported yet. At the deadline it was written as a
            // failed row above, so a missing row here only happens for early closures.
            return pendingEarly
              ? { location, isUp: false, pending: true }
              : { location, isUp: false, noResult: true };
          },
        ),
      },
    });
    for (const row of rows) {
      if ((row.details as { synthetic?: boolean } | null)?.synthetic) continue;
      await this.evaluator.checkSslExpirationAlert(
        this.toExecutionResult(row),
        monitor,
      );
    }
    if (outcome.deliveryFailed) {
      const attempts = cycle.notifyAttempts + 1;
      await this.dbService.db
        .update(schema.monitorCycles)
        .set({
          notifyAttempts: attempts,
          // Giving up still writes the receipt so the backlog alert clears; the log is the record.
          ...(attempts >= MAX_NOTIFY_ATTEMPTS
            ? { notifiedAt: new Date() }
            : {}),
        })
        .where(eq(schema.monitorCycles.id, cycleId));
      if (attempts >= MAX_NOTIFY_ATTEMPTS) {
        this.logger.error(
          `Giving up delivering the alert for cycle ${cycleId} after ${attempts} failed attempts`,
        );
        return true;
      }
      return false;
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

  /** A cycle that cannot be closed (persistent verification failure) must not stay open forever. */
  async abortCycle(cycleId: string, now: Date = new Date()): Promise<void> {
    await this.dbService.db
      .update(schema.monitorCycles)
      .set({ status: 'aborted', closedAt: now, notifiedAt: now })
      .where(
        and(
          eq(schema.monitorCycles.id, cycleId),
          eq(schema.monitorCycles.status, 'open'),
        ),
      );
  }

  /**
   * A delivery step that threw (or timed out) before reporting a result still counts as an attempt,
   * so repair backs off and gives up instead of retrying on every tick.
   */
  async recordNotifyFailure(cycleId: string): Promise<void> {
    await this.dbService.db
      .update(schema.monitorCycles)
      .set({
        notifyAttempts: sql`${schema.monitorCycles.notifyAttempts} + 1`,
        notifiedAt: sql`CASE WHEN ${schema.monitorCycles.notifyAttempts} + 1 >= ${MAX_NOTIFY_ATTEMPTS} THEN (now() AT TIME ZONE 'utc') ELSE NULL END`,
      })
      .where(
        and(
          eq(schema.monitorCycles.id, cycleId),
          eq(schema.monitorCycles.status, 'closed'),
          isNull(schema.monitorCycles.notifiedAt),
        ),
      );
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
    // At the deadline a silent region failed; on an early closure it simply hasn't reported yet.
    const missing = decision.missing.length
      ? decision.closedBy === 'deadline'
        ? ` (no results from ${decision.missing.join(', ')})`
        : ` (awaiting results from ${decision.missing.join(', ')})`
      : '';
    return decision.status === 'down'
      ? `Monitor is down in ${total - upCount}/${total} locations${missing}`
      : `Monitor has recovered (${upCount}/${total} locations up)`;
  }

  /** Like the legacy path: every observed result counts, a missing response time as 0. */
  private averageResponse(rows: ResultRow[]): number {
    return rows.length
      ? rows.reduce((sum, row) => sum + (row.responseTimeMs || 0), 0) /
          rows.length
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
