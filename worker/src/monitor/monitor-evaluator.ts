import { Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DbService } from '../db/db.service';
import * as schema from '../db/schema';
import type {
  MonitorConfig,
  monitorsSelectSchema,
  monitorResultsSelectSchema,
} from '../db/schema';
import { MonitorAlertService } from './services/monitor-alert.service';
import { getErrorMessage } from '../common/validation';
import { SECURITY } from '../common/constants';
import { MonitorExecutionResult } from './types/monitor-result.type';

type Monitor = z.infer<typeof monitorsSelectSchema>;
type MonitorResult = z.infer<typeof monitorResultsSelectSchema>;

/** First failure alert plus two reminders per failure sequence. */
const MAX_FAILURE_ALERTS = 3;

export type AggregatedAlertState = {
  consecutiveFailureCount: number;
  consecutiveSuccessCount: number;
  alertsSentForFailure: number;
  alertsSentForRecovery: number;
  recoverySequence?: boolean;
  /** Failure count of the outage this recovery follows, when that outage sent no failure alert. */
  priorFailureCount?: number;
  /** Some cycles of the current failure sequence were not counted (alerts off or paused). */
  failureCountUnknown?: boolean;
  executionGroupId?: string;
};

/**
 * A monitor with alerts off still tracks its checks for incidents when `incidentEnabled: true` (opt-in).
 * Keep in sync with incidentsEnabled in app/src/lib/incident-settings.ts.
 */
export function isIncidentOnly(
  alertConfig:
    { enabled?: boolean; incidentEnabled?: boolean } | null | undefined,
): boolean {
  return !alertConfig?.enabled && alertConfig?.incidentEnabled === true;
}

/** Counters and incidents run for monitors that alert or are incident-only. */
export function tracksAlertState(
  alertConfig:
    { enabled?: boolean; incidentEnabled?: boolean } | null | undefined,
): boolean {
  return Boolean(alertConfig?.enabled) || isIncidentOnly(alertConfig);
}

export type GroupAlertEvaluation = {
  previousStatus: string;
  currentStatus: 'up' | 'down';
  alertState?: AggregatedAlertState;
};

/**
 * Alert and status evaluation shared by the regional worker (MonitorService) and the
 * control-plane cycle closer. Depends only on the database and the alert service, so it
 * can run without any execution, HTTP-probe or regional-queue providers.
 */
export class MonitorEvaluator {
  private readonly logger = new Logger(MonitorEvaluator.name);

  constructor(
    private readonly dbService: DbService,
    private readonly monitorAlertService: MonitorAlertService,
  ) {}

  async updateMonitorStatus(
    monitorId: string,
    status: 'up' | 'down',
    checkedAt: Date,
  ): Promise<void> {
    try {
      // Get current monitor status before update to detect status changes
      const currentMonitor = await this.getMonitorById(monitorId);
      const previousStatus = currentMonitor?.status;

      // Determine if this is a status change
      const isStatusChange = previousStatus && previousStatus !== status;

      await this.dbService.db
        .update(schema.monitors)
        .set({
          status: status,
          lastCheckAt: checkedAt,
          lastStatusChangeAt: isStatusChange ? checkedAt : undefined,
        })
        // An in-flight check must not un-pause a monitor paused after it started.
        .where(
          and(
            eq(schema.monitors.id, monitorId),
            sql`${schema.monitors.status} <> 'paused'`,
          ),
        );

      this.logger.log(
        `Updated monitor ${monitorId} status: ${previousStatus || 'unknown'} -> ${status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update monitor status for ${monitorId}: ${getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  readAggregatedAlertState(
    monitorConfig: MonitorConfig | null | undefined,
  ): AggregatedAlertState {
    const rawAlertState = (
      monitorConfig as { aggregatedAlertState?: Record<string, unknown> } | null
    )?.aggregatedAlertState;

    const toSafeCounter = (value: unknown): number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : 0;

    return {
      consecutiveFailureCount: toSafeCounter(
        rawAlertState?.consecutiveFailureCount,
      ),
      consecutiveSuccessCount: toSafeCounter(
        rawAlertState?.consecutiveSuccessCount,
      ),
      alertsSentForFailure: toSafeCounter(rawAlertState?.alertsSentForFailure),
      alertsSentForRecovery: toSafeCounter(
        rawAlertState?.alertsSentForRecovery,
      ),
      recoverySequence: rawAlertState?.recoverySequence === true,
      ...(typeof rawAlertState?.priorFailureCount === 'number'
        ? { priorFailureCount: toSafeCounter(rawAlertState.priorFailureCount) }
        : {}),
      ...(rawAlertState?.failureCountUnknown === true
        ? { failureCountUnknown: true }
        : {}),
    };
  }

  getNextAggregatedAlertState(
    previousState: AggregatedAlertState,
    previousStatus: string,
    currentStatus: 'up' | 'down',
  ): AggregatedAlertState {
    if (currentStatus === 'down') {
      const continuingFailureSequence = previousStatus === 'down';

      return {
        consecutiveFailureCount: continuingFailureSequence
          ? previousState.consecutiveFailureCount + 1
          : 1,
        consecutiveSuccessCount: 0,
        alertsSentForFailure: continuingFailureSequence
          ? previousState.alertsSentForFailure
          : 0,
        alertsSentForRecovery: 0,
        recoverySequence: false,
        ...(continuingFailureSequence && previousState.failureCountUnknown
          ? { failureCountUnknown: true }
          : {}),
      };
    }

    const continuingRecoverySequence = previousStatus === 'up';

    return {
      consecutiveFailureCount: 0,
      consecutiveSuccessCount: continuingRecoverySequence
        ? previousState.consecutiveSuccessCount + 1
        : 1,
      alertsSentForFailure: 0,
      alertsSentForRecovery: continuingRecoverySequence
        ? previousState.alertsSentForRecovery
        : 0,
      recoverySequence:
        previousStatus === 'down' ||
        (continuingRecoverySequence && previousState.recoverySequence === true),
      // Recorded only when the outage sent no failure alert: an alerted outage always gets its recovery.
      ...(previousStatus === 'down'
        ? previousState.alertsSentForFailure === 0 &&
          !previousState.failureCountUnknown
          ? { priorFailureCount: previousState.consecutiveFailureCount }
          : {}
        : continuingRecoverySequence &&
            previousState.priorFailureCount !== undefined
          ? { priorFailureCount: previousState.priorFailureCount }
          : {}),
    };
  }

  /** Counters after one multi-location cycle. Shared by the legacy and control-plane cycle paths. */
  advanceAggregatedAlertState(
    alertEnabled: boolean | undefined,
    monitorConfig: MonitorConfig | null | undefined,
    previousStatus: string,
    currentStatus: 'up' | 'down',
  ): AggregatedAlertState {
    const previousState = this.readAggregatedAlertState(monitorConfig);
    // 'pending' must count: its first real observation is cycle 1 (as for single-location).
    return alertEnabled && previousStatus !== 'paused'
      ? this.getNextAggregatedAlertState(
          previousState,
          previousStatus,
          currentStatus,
        )
      : // Uncounted cycles leave the outage length unknown, so a later recovery is not gated on it.
        { ...previousState, failureCountUnknown: true };
  }

  /**
   * Writes only `aggregatedAlertState`, atomically (jsonb_set), so worker-owned config keys written
   * concurrently (SSL check times, certificate) are never overwritten by a stale read of the config.
   * Throws when the write fails; returns false when no row matched (a newer cycle owns the config, or,
   * with `onlyIfSent`, the counter is no longer the value the caller wrote).
   */
  private async writeAggregatedAlertState(
    monitorId: string,
    aggregatedAlertState: AggregatedAlertState,
    onlyIfSent?: {
      field: 'alertsSentForFailure' | 'alertsSentForRecovery';
      value: number;
    },
  ): Promise<boolean> {
    const rows = await this.dbService.db
      .update(schema.monitors)
      .set({
        config: sql`jsonb_set(coalesce(${schema.monitors.config}, '{}'::jsonb), '{aggregatedAlertState}', ${JSON.stringify(aggregatedAlertState)}::jsonb)`,
      })
      .where(
        and(
          eq(schema.monitors.id, monitorId),
          ...(aggregatedAlertState.executionGroupId
            ? [
                sql`${schema.monitors.config}->'aggregatedAlertState'->>'executionGroupId' = ${aggregatedAlertState.executionGroupId}`,
              ]
            : []),
          ...(onlyIfSent
            ? [
                sql`(${schema.monitors.config}->'aggregatedAlertState'->>${onlyIfSent.field})::int = ${onlyIfSent.value}`,
              ]
            : []),
        ),
      )
      .returning({ id: schema.monitors.id });
    return rows.length > 0;
  }

  async persistAggregatedAlertState(
    monitorId: string,
    aggregatedAlertState: AggregatedAlertState,
  ): Promise<void> {
    try {
      await this.writeAggregatedAlertState(monitorId, aggregatedAlertState);
    } catch (error) {
      this.logger.error(
        `Failed to persist aggregated alert state for monitor ${monitorId}: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Evaluate and send alerts based on status transitions with threshold support.
   * Consolidated alert logic for both single and multi-location monitors.
   * Prevents unnecessary alerts on initial monitor creation (pending → any status).
   *
   * Threshold behavior:
   * - failureThreshold: Number of consecutive failures before first alert (default: 1)
   * - recoveryThreshold: Number of consecutive successes before recovery alert (default: 1)
   * - Max 3 failure alerts (first + 2 reminders, the gap doubling) and one recovery alert
   *
   * @returns Alert action metadata { alertSent: boolean, alertType?: string }
   */
  async evaluateAndSendAlert(options: {
    monitorId: string;
    monitor: Monitor | undefined;
    previousStatus: string;
    currentStatus: 'up' | 'down';
    reason: string;
    metadata: Record<string, unknown>;
    preparedAlertState?: AggregatedAlertState;
    /** When the failing cycle was observed. A delayed send keeps it, so a later recovery still reads as newer. */
    observedAt?: Date;
    /**
     * The caller is re-driving a cycle whose alert partly failed. A single-location alert whose slot this
     * cycle already used stays due, so the failed channels are retried (channels that got it are skipped
     * by observation time) without consuming another slot.
     */
    retryDelivery?: boolean;
  }): Promise<{
    alertSent: boolean;
    alertType?: string;
    /** An alert was due and attempted but no channel accepted it, or some channel failed and must be retried. */
    deliveryFailed?: boolean;
  }> {
    const { monitorId, previousStatus, currentStatus, reason, metadata } =
      options;

    const monitor = options.monitor;

    // Don't send alerts if alerts are disabled, unless the monitor only opens incidents.
    const monitorAlertConfig = (monitor as Record<string, unknown> | null)
      ?.alertConfig as Record<string, unknown> | undefined;
    const incidentOnly = isIncidentOnly(monitorAlertConfig);
    if (!monitorAlertConfig?.enabled && !incidentOnly) {
      return { alertSent: false };
    }

    // Don't send alerts for state transitions from 'pending' or 'paused'
    // These are initial states and should not trigger notifications
    if (previousStatus === 'pending' || previousStatus === 'paused') {
      this.logger.debug(
        `[ALERT] Skipping alert for monitor ${monitorId}: transitioning from ${previousStatus} status (not a real state change)`,
      );
      return { alertSent: false };
    }

    const monitorConfig = (monitor as Monitor | null)?.config;
    const locationResults = Array.isArray(
      (metadata as { locationResults?: unknown }).locationResults,
    )
      ? ((metadata as { locationResults?: unknown[] }).locationResults ?? [])
      : [];
    const isMultiLocationEvaluation = this.isMultiLocationEvaluation(
      monitorConfig,
      locationResults.length,
    );

    let latestResult: MonitorResult | undefined;
    let aggregatedAlertState: AggregatedAlertState | null = null;

    if (isMultiLocationEvaluation) {
      aggregatedAlertState =
        options.preparedAlertState ??
        this.getNextAggregatedAlertState(
          this.readAggregatedAlertState(monitorConfig),
          previousStatus,
          currentStatus,
        );
    } else {
      // Keep existing row-based logic for single-location evaluations
      latestResult = await this.dbService.db.query.monitorResults.findFirst({
        where: eq(schema.monitorResults.monitorId, monitorId),
        orderBy: [desc(schema.monitorResults.checkedAt)],
      });
    }

    const consecutiveFailureCount = isMultiLocationEvaluation
      ? (aggregatedAlertState?.consecutiveFailureCount ?? 0)
      : (latestResult?.consecutiveFailureCount ?? 0);
    const consecutiveSuccessCount = isMultiLocationEvaluation
      ? (aggregatedAlertState?.consecutiveSuccessCount ?? 0)
      : (latestResult?.consecutiveSuccessCount ?? 0);
    const alertsSentForFailure = isMultiLocationEvaluation
      ? (aggregatedAlertState?.alertsSentForFailure ?? 0)
      : (latestResult?.alertsSentForFailure ?? 0);
    const alertsSentForRecovery = isMultiLocationEvaluation
      ? (aggregatedAlertState?.alertsSentForRecovery ?? 0)
      : (latestResult?.alertsSentForRecovery ?? 0);

    // Determine alert type and whether thresholds are met
    let shouldSendAlert = false;
    // This call re-drives an alert whose slot an earlier attempt of the same cycle already took.
    let resumedSlot = false;
    let alertType: 'recovery' | 'failure' | null = null;

    if (currentStatus === 'down') {
      alertType = 'failure';
      const failureThreshold =
        (monitorAlertConfig?.failureThreshold as number) || 1;

      const failureAlertWanted =
        incidentOnly ||
        (monitorAlertConfig?.alertOnFailure as boolean) ||
        false;
      // First alert: threshold reached (>= so a skipped pending observation cannot miss it), bounded so an
      // undeliverable first alert is not retried for the whole outage.
      const firstDue =
        failureAlertWanted &&
        consecutiveFailureCount >= failureThreshold &&
        consecutiveFailureCount <
          failureThreshold + Math.max(5, failureThreshold * 2);
      // Reminder number k (1 or 2) is due once N * (2^k - 1) failures have passed the threshold, with
      // N = max(5, 2 * threshold): gaps of N, then 2N. ">=" keeps an undelivered reminder due, so the
      // next check retries it instead of losing it.
      const reminderDue = (sent: number): boolean =>
        failureAlertWanted &&
        consecutiveFailureCount > failureThreshold &&
        sent >= 1 &&
        sent < MAX_FAILURE_ALERTS &&
        consecutiveFailureCount - failureThreshold >=
          Math.max(5, failureThreshold * 2) * (2 ** sent - 1);

      if (alertsSentForFailure === 0 && firstDue) {
        shouldSendAlert = true;
      } else if (reminderDue(alertsSentForFailure)) {
        shouldSendAlert = true;
      } else if (
        options.retryDelivery &&
        !isMultiLocationEvaluation &&
        alertsSentForFailure >= 1 &&
        (alertsSentForFailure === 1
          ? firstDue
          : reminderDue(alertsSentForFailure - 1))
      ) {
        shouldSendAlert = true;
        resumedSlot = true;
      }

      if (!shouldSendAlert) {
        if (
          consecutiveFailureCount > 0 &&
          alertsSentForFailure >= MAX_FAILURE_ALERTS
        ) {
          this.logger.debug(
            `[ALERT] Skipping failure alert for monitor ${monitorId} - already sent 3 alerts for this failure sequence`,
          );
        } else {
          this.logger.debug(
            `[ALERT] Failure threshold not yet met for monitor ${monitorId}: ${consecutiveFailureCount}/${failureThreshold}`,
          );
        }
      }
    } else if (
      currentStatus === 'up' &&
      (previousStatus === 'down' ||
        (isMultiLocationEvaluation
          ? aggregatedAlertState?.recoverySequence
          : latestResult?.details?.recoverySequence) === true)
    ) {
      alertType = 'recovery';
      const recoveryThreshold =
        (monitorAlertConfig?.recoveryThreshold as number) || 1;

      // Once per recovery, before the alert toggle, channels or maintenance can drop it.
      if (consecutiveSuccessCount === recoveryThreshold) {
        // signalRecovery retries in place and logs a signal it still loses; the recovery alert below goes
        // out whatever it returns, so a failed incident enqueue cannot suppress the alert.
        await this.monitorAlertService.signalRecovery(monitorId, new Date());
      }

      // A blip shorter than the failure threshold was never an outage, so it gets no recovery alert.
      // Unknown or uncounted (0: older state, or alerts were off during the outage) still alerts.
      const priorFailureCount = isMultiLocationEvaluation
        ? aggregatedAlertState?.priorFailureCount
        : (latestResult?.details as { priorFailureCount?: unknown } | null)
            ?.priorFailureCount;
      const outageReachedThreshold = !(
        typeof priorFailureCount === 'number' &&
        priorFailureCount > 0 &&
        priorFailureCount <
          ((monitorAlertConfig?.failureThreshold as number) || 1)
      );

      const recoveryDue =
        consecutiveSuccessCount >= recoveryThreshold &&
        // Bounded like the failure path, so an undeliverable recovery is not retried forever.
        consecutiveSuccessCount <
          recoveryThreshold + Math.max(5, recoveryThreshold * 2) &&
        outageReachedThreshold &&
        // Nothing to notify without alerts: the recovery signal above already resolves the incident.
        !incidentOnly &&
        ((monitorAlertConfig?.alertOnRecovery as boolean) || false);
      shouldSendAlert = recoveryDue && alertsSentForRecovery === 0;
      if (
        !shouldSendAlert &&
        recoveryDue &&
        options.retryDelivery &&
        !isMultiLocationEvaluation &&
        alertsSentForRecovery === 1
      ) {
        shouldSendAlert = true;
        resumedSlot = true;
      }

      if (!shouldSendAlert) {
        if (
          consecutiveSuccessCount <
          ((monitorAlertConfig?.recoveryThreshold as number) || 1)
        ) {
          this.logger.debug(
            `[ALERT] Recovery threshold not yet met for monitor ${monitorId}: ${consecutiveSuccessCount}/${(monitorAlertConfig?.recoveryThreshold as number) || 1}`,
          );
        } else if (alertsSentForRecovery >= 1) {
          this.logger.debug(
            `[ALERT] Skipping recovery alert for monitor ${monitorId} - already sent one alert for this recovery sequence`,
          );
        }
      }
    }

    if (!shouldSendAlert || !alertType) {
      if (
        isMultiLocationEvaluation &&
        aggregatedAlertState &&
        !options.preparedAlertState
      ) {
        await this.persistAggregatedAlertState(monitorId, aggregatedAlertState);
      }

      return { alertSent: false };
    }

    // The counter is recorded BEFORE the send and rolled back when nothing was delivered, so a delivered
    // alert can never go unrecorded and repeat. If recording fails nothing is sent (the cycle retries). A
    // crash between record and send costs one alert but never adds one, like the job alert slots.
    const previousSent =
      alertType === 'failure' ? alertsSentForFailure : alertsSentForRecovery;
    const field =
      alertType === 'failure'
        ? ('alertsSentForFailure' as const)
        : ('alertsSentForRecovery' as const);
    // Returns false when nothing matched: a newer cycle owns the counter, so this attempt is stale.
    // `onlyIfSent` makes a release compare-and-set: it never wipes a record a later attempt wrote.
    const writeSent = async (
      sent: number,
      onlyIfSent?: number,
    ): Promise<boolean> => {
      if (isMultiLocationEvaluation && aggregatedAlertState) {
        return this.writeAggregatedAlertState(
          monitorId,
          { ...aggregatedAlertState, [field]: sent },
          onlyIfSent === undefined ? undefined : { field, value: onlyIfSent },
        );
      }
      if (!latestResult) return true;
      const rows = await this.dbService.db
        .update(schema.monitorResults)
        .set({ [field]: sent })
        .where(
          and(
            eq(schema.monitorResults.id, latestResult.id),
            ...(onlyIfSent === undefined
              ? []
              : [sql`${schema.monitorResults[field]} = ${onlyIfSent}`]),
          ),
        )
        .returning({ id: schema.monitorResults.id });
      return rows.length > 0;
    };
    const releaseSent = async (): Promise<void> => {
      // A resumed slot belongs to the earlier attempt that may already have delivered: never release it.
      if (resumedSlot) return;
      try {
        await writeSent(previousSent, previousSent + 1);
      } catch (error) {
        this.logger.error(
          `Failed to release the ${alertType} alert slot for monitor ${monitorId}: ${getErrorMessage(error)}`,
        );
      }
    };

    let recorded = false;
    let delivered = false;
    try {
      if (!resumedSlot && !(await writeSent(previousSent + 1))) {
        // A newer cycle owns the state. If it already sent for this sequence, this is a stale retry whose
        // alert would repeat it. Otherwise (e.g. a failure reported after a newer recovery cycle closed) the
        // alert is still owed; it goes out unrecorded, as before.
        if (!isMultiLocationEvaluation) return { alertSent: false };
        const owner = await this.dbService.db.query.monitors.findFirst({
          where: eq(schema.monitors.id, monitorId),
          columns: { config: true },
        });
        if (
          (this.readAggregatedAlertState(owner?.config)[field] ?? 0) >
          previousSent
        ) {
          this.logger.warn(
            `[ALERT] Skipping ${alertType} alert for monitor ${monitorId}: a newer check cycle already alerted`,
          );
          return { alertSent: false };
        }
      }
      recorded = true;

      this.logger.log(
        `Sending ${alertType} notification for monitor ${monitorId}`,
      );

      const alertMetadata = {
        ...metadata,
        consecutiveFailureCount,
        consecutiveSuccessCount,
        alertsSentForFailure,
        alertsSentForRecovery,
        ...(options.observedAt
          ? { observedAt: options.observedAt.toISOString() }
          : {}),
      };

      // Without alerts there is nothing to deliver: the failure only reaches the incident queue.
      const notification = incidentOnly
        ? await this.monitorAlertService.signalFailure(
            monitorId,
            reason,
            options.observedAt,
          )
        : await this.monitorAlertService.sendNotification(
            monitorId,
            alertType,
            reason,
            alertMetadata,
          );

      // Only a maintenance-suppressed recovery is consumed; anything else (no providers) retries within
      // the bounded window, as a suppressed failure does.
      const suppressed =
        notification?.suppressed === true &&
        alertType === 'recovery' &&
        (notification as { reason?: string }).reason === 'maintenance';
      // The incident was opened or updated and no channel exists: count it as sent so reminders keep their cadence.
      const incidentSignalled =
        notification?.suppressed === true &&
        alertType === 'failure' &&
        (notification as { reason?: string }).reason === 'incident_only';
      if (!suppressed && !incidentSignalled && notification?.suppressed) {
        await releaseSent();
        return { alertSent: false };
      }
      if (
        !suppressed &&
        !incidentSignalled &&
        notification?.delivered === false
      ) {
        await releaseSent();
        return { alertSent: false, deliveryFailed: true };
      }
      delivered = true;

      if (suppressed) return { alertSent: false };
      // Some channel still failed: the slot stays used (the others got the alert) and the caller retries
      // only the failed channels, which sendNotification finds from alert_history.
      const retryFailedChannels =
        (notification as { retryFailedChannels?: boolean })
          .retryFailedChannels === true;
      return retryFailedChannels
        ? { alertSent: true, alertType, deliveryFailed: true }
        : { alertSent: true, alertType };
    } catch (error) {
      if (recorded && !delivered) await releaseSent();

      this.logger.error(
        `Failed to send ${alertType} alert for monitor ${monitorId}: ${getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { alertSent: false, deliveryFailed: !delivered };
    }
  }

  isMultiLocationEvaluation(
    config: MonitorConfig | null | undefined,
    resultCount: number,
  ): boolean {
    return (
      Boolean(
        config?.locationConfig?.enabled &&
        new Set(config.locationConfig.locations ?? []).size > 1,
      ) || resultCount > 1
    );
  }

  async prepareGroupEvaluation(
    monitorId: string,
    executionGroupId: string,
    currentStatus: 'up' | 'down',
    checkedAt: Date,
    resultCount: number,
  ) {
    return this.dbService.db.transaction(async (tx) => {
      const [monitor] = await tx
        .select()
        .from(schema.monitors)
        .where(eq(schema.monitors.id, monitorId))
        .limit(1)
        .for('update');
      if (!monitor) return null;
      const rows = await tx
        .select({
          id: schema.monitorResults.id,
          details: schema.monitorResults.details,
        })
        .from(schema.monitorResults)
        .where(
          and(
            eq(schema.monitorResults.monitorId, monitorId),
            eq(schema.monitorResults.executionGroupId, executionGroupId),
          ),
        );
      const applied = rows.find((row) => row.details?.aggregationEvaluation);
      if (applied) {
        if (applied.details?.aggregationNotificationProcessed === true)
          return null;
        return {
          monitor,
          resultId: applied.id,
          evaluation: applied.details!
            .aggregationEvaluation as GroupAlertEvaluation,
        };
      }
      const row = rows[0];
      if (!row) throw new Error('Persisted aggregation group is missing');
      const previousStatus = monitor.status;
      const evaluation: GroupAlertEvaluation = {
        previousStatus,
        currentStatus,
      };
      if (this.isMultiLocationEvaluation(monitor.config, resultCount)) {
        evaluation.alertState = {
          ...this.advanceAggregatedAlertState(
            tracksAlertState(monitor.alertConfig),
            monitor.config,
            previousStatus,
            currentStatus,
          ),
          executionGroupId,
        };
      }
      // Commit cycle counters and its receipt together; a Redis marker cannot do this.
      await tx
        .update(schema.monitors)
        .set({
          // A monitor paused mid-cycle stays paused.
          status: previousStatus === 'paused' ? 'paused' : currentStatus,
          lastCheckAt: checkedAt,
          lastStatusChangeAt:
            previousStatus !== 'paused' && previousStatus !== currentStatus
              ? checkedAt
              : undefined,
          ...(evaluation.alertState
            ? {
                config: {
                  ...(monitor.config ?? {}),
                  aggregatedAlertState: evaluation.alertState,
                },
              }
            : {}),
        })
        .where(eq(schema.monitors.id, monitorId));
      await tx
        .update(schema.monitorResults)
        .set({
          details: {
            ...(row.details ?? {}),
            aggregationEvaluation: evaluation,
            aggregationNotificationProcessed: false,
          },
        })
        .where(eq(schema.monitorResults.id, row.id));
      return { monitor, resultId: row.id, evaluation };
    });
  }

  /**
   * Checks for SSL expiration warnings and sends alerts independently of status changes
   */
  async checkSslExpirationAlert(
    resultData: MonitorExecutionResult,
    monitor: Monitor | null,
  ): Promise<void> {
    try {
      if (
        !monitor?.alertConfig?.enabled ||
        !monitor.alertConfig.alertOnSslExpiration
      ) {
        return;
      }
      // Removed debug log

      // Check if SSL certificate info is available and has warning
      const sslCertificate = resultData.details?.sslCertificate;
      const sslWarning =
        resultData.details?.sslWarning || resultData.details?.warningMessage;

      // Removed debug logs

      if (!sslCertificate && !sslWarning) {
        return; // No SSL info to check
      }

      let shouldAlert = false;
      let alertReason = '';

      // Check for SSL expiration warning
      if (sslCertificate?.daysRemaining !== undefined) {
        const daysUntilExpiration = sslCertificate.daysRemaining;
        const warningThreshold =
          ((monitor?.config as Record<string, unknown> | undefined)
            ?.sslDaysUntilExpirationWarning as number | undefined) ??
          SECURITY.SSL_DEFAULT_WARNING_DAYS;

        // Removed debug logs

        if (
          daysUntilExpiration <= warningThreshold &&
          daysUntilExpiration > 0
        ) {
          shouldAlert = true;
          alertReason = `SSL certificate expires in ${daysUntilExpiration} days`;
        } else if (daysUntilExpiration <= 0) {
          shouldAlert = true;
          alertReason = 'SSL certificate has expired';
        }
      }

      // Check for SSL warning messages
      if (sslWarning && typeof sslWarning === 'string') {
        shouldAlert = true;
        alertReason = alertReason || sslWarning;
      }

      if (shouldAlert) {
        // Check if we've already sent an SSL alert recently to avoid spam
        const lastSslAlert = await this.getLastSslAlert(resultData.monitorId);
        const now = new Date();
        const hoursSinceLastAlert = lastSslAlert
          ? (now.getTime() - lastSslAlert.getTime()) / (1000 * 60 * 60)
          : Infinity;

        // Only send SSL alerts once per day to avoid spam
        if (hoursSinceLastAlert >= 24) {
          const sent =
            await this.monitorAlertService.sendSslExpirationNotification(
              resultData.monitorId,
              alertReason,
              {
                sslCertificate,
                daysRemaining: sslCertificate?.daysRemaining,
                responseTime: resultData.responseTimeMs,
              },
            );

          // Only log important SSL alerts
          if (sent)
            this.logger.log(
              `Sent SSL expiration alert for monitor ${resultData.monitorId}: ${alertReason}`,
            );
        }
        // Removed debug log for skipped alerts
      }
    } catch (error) {
      this.logger.error(
        `Error checking SSL expiration alert for monitor ${resultData.monitorId}:`,
        error,
      );
    }
  }

  /**
   * Gets the timestamp of the last SSL alert sent for a monitor
   */
  async getLastSslAlert(monitorId: string): Promise<Date | null> {
    try {
      const lastAlert = await this.dbService.db.query.alertHistory.findFirst({
        where: and(
          eq(schema.alertHistory.monitorId, monitorId),
          eq(schema.alertHistory.type, 'ssl_expiring'),
          // Only delivered alerts throttle: failed deliveries must be retried
          // on the next check instead of being suppressed for 24 hours.
          eq(schema.alertHistory.status, 'sent'),
        ),
        orderBy: [desc(schema.alertHistory.sentAt)],
      });

      return lastAlert?.sentAt ? new Date(lastAlert.sentAt) : null;
    } catch (error) {
      this.logger.error(
        `Error getting last SSL alert for monitor ${monitorId}:`,
        error,
      );
      return null;
    }
  }

  async getMonitorById(monitorId: string): Promise<Monitor | undefined> {
    return this.dbService.db.query.monitors.findFirst({
      where: eq(schema.monitors.id, monitorId),
    });
  }
}
