import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
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

/** A certificate probe failing this long while the site is up raises an SSL alert. */
const SSL_PROBE_FAILURE_ALERT_MS = 24 * 60 * 60 * 1000;

/** Host the stored certificate belongs to; a target edit to another host makes it stale. */
export function sslHost(target: string): string | undefined {
  try {
    return new URL(target).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Monitor = z.infer<typeof monitorsSelectSchema>;
type MonitorResult = z.infer<typeof monitorResultsSelectSchema>;

/** First failure alert plus two reminders per failure sequence. */
const MAX_FAILURE_ALERTS = 3;

export type AggregatedAlertState = {
  consecutiveFailureCount: number;
  consecutiveSuccessCount: number;
  alertsSentForFailure: number;
  alertsSentForRecovery: number;
  /** `consecutiveFailureCount` at the last delivered failure alert of this sequence; keeps reminder gaps. */
  lastAlertCount?: number;
  /**
   * 2 = `alertsSentForFailure` counts alert windows used (see evaluateAndSendAlert); absent = an older
   * worker's delivered count. `lastAlertCount` is trusted only together with `lastAlertWindows`, the counter
   * value it was written with, so an older worker bumping the counter invalidates it.
   */
  alertCounterVersion?: 2;
  lastAlertWindows?: number;
  recoverySequence?: boolean;
  /** Failure count of the outage this recovery follows, when that outage sent no failure alert. */
  priorFailureCount?: number;
  /** Some cycles of the current failure sequence were not counted (alerts off or paused). */
  failureCountUnknown?: boolean;
  executionGroupId?: string;
  /**
   * Id of the current failure sequence (and of the recovery that follows it), minted where the sequence starts.
   * Alert claims in alert_history are keyed by it, so every evaluator of the same alert shares one claim.
   * Absent on state written before claims existed or by an older worker: such alerts are sent unclaimed.
   */
  outageKey?: string;
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
 * Retries and late regions end within about 80 minutes, and receipts are kept at least two days
 * (telemetry-retention.ts). A receipt-less group older than this is stale: it is dropped only when the monitor
 * already holds an equal or newer check, since applying it would then overwrite current status with an old one.
 */
export const GROUP_EVALUATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How long a claim on a group's alerts blocks other senders before it can be taken over. */
export const GROUP_NOTIFICATION_LEASE_MS = 2 * 60 * 1000;

/** Where a group's alert receipt lives: its own row, or (groups from older workers) a result row's details. */
export type GroupReceipt =
  { kind: 'group' } | { kind: 'legacy'; resultId: string };

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
      ...(typeof rawAlertState?.lastAlertCount === 'number'
        ? { lastAlertCount: toSafeCounter(rawAlertState.lastAlertCount) }
        : {}),
      ...(rawAlertState?.alertCounterVersion === 2
        ? { alertCounterVersion: 2 as const }
        : {}),
      ...(typeof rawAlertState?.lastAlertWindows === 'number'
        ? { lastAlertWindows: toSafeCounter(rawAlertState.lastAlertWindows) }
        : {}),
      ...(typeof rawAlertState?.priorFailureCount === 'number'
        ? { priorFailureCount: toSafeCounter(rawAlertState.priorFailureCount) }
        : {}),
      ...(rawAlertState?.failureCountUnknown === true
        ? { failureCountUnknown: true }
        : {}),
      ...(typeof rawAlertState?.outageKey === 'string' &&
      UUID_PATTERN.test(rawAlertState.outageKey)
        ? { outageKey: rawAlertState.outageKey }
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
        ...(continuingFailureSequence &&
        previousState.lastAlertCount !== undefined
          ? {
              lastAlertCount: previousState.lastAlertCount,
              ...(previousState.alertCounterVersion
                ? { alertCounterVersion: previousState.alertCounterVersion }
                : {}),
              ...(previousState.lastAlertWindows !== undefined
                ? { lastAlertWindows: previousState.lastAlertWindows }
                : {}),
            }
          : {}),
        ...(continuingFailureSequence && previousState.failureCountUnknown
          ? { failureCountUnknown: true }
          : {}),
        // A sequence without a key (older state, or counting resumed mid-outage) gets one here, where the
        // counters are committed; a new sequence always starts a new key.
        // The count must be > 0: an up-state frozen with an old key (counting paused, location config toggled)
        // is not a failure sequence, and reusing its key would find the new outage's first alert already claimed.
        outageKey:
          continuingFailureSequence && previousState.consecutiveFailureCount > 0
            ? (previousState.outageKey ?? randomUUID())
            : randomUUID(),
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
      // The recovery is claimed under the key of the outage it ends.
      ...((previousStatus === 'down' || continuingRecoverySequence) &&
      previousState.outageKey
        ? { outageKey: previousState.outageKey }
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
      : // Uncounted cycles leave the outage length unknown, so a later recovery is not gated on it. The key
        // goes too: counting may resume in a later outage, which must not reuse this one's claims.
        { ...previousState, outageKey: undefined, failureCountUnknown: true };
  }

  /**
   * Writes only `aggregatedAlertState`, atomically (jsonb_set), so worker-owned config keys written
   * concurrently (SSL check times, certificate) are never overwritten by a stale read of the config.
   */
  async persistAggregatedAlertState(
    monitorId: string,
    aggregatedAlertState: AggregatedAlertState,
    options: { monotonicFailureCounter?: boolean } = {},
  ): Promise<boolean> {
    try {
      await this.dbService.db
        .update(schema.monitors)
        .set({
          config: options.monotonicFailureCounter
            ? sql`jsonb_set(coalesce(${schema.monitors.config}, '{}'::jsonb), '{aggregatedAlertState}', ${JSON.stringify(aggregatedAlertState)}::jsonb || jsonb_build_object('alertsSentForFailure', GREATEST(coalesce((${schema.monitors.config}->'aggregatedAlertState'->>'alertsSentForFailure')::int, 0), ${aggregatedAlertState.alertsSentForFailure}::int)))`
            : sql`jsonb_set(coalesce(${schema.monitors.config}, '{}'::jsonb), '{aggregatedAlertState}', ${JSON.stringify(aggregatedAlertState)}::jsonb)`,
        })
        .where(
          and(
            eq(schema.monitors.id, monitorId),
            ...(aggregatedAlertState.executionGroupId
              ? [
                  sql`${schema.monitors.config}->'aggregatedAlertState'->>'executionGroupId' = ${aggregatedAlertState.executionGroupId}`,
                ]
              : []),
          ),
        );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to persist aggregated alert state for monitor ${monitorId}: ${getErrorMessage(error)}`,
      );
      return false;
    }
  }

  /** Single-location monitors keep the last alert count in `config.aggregatedAlertState` too. */
  private async persistSingleLocationLastAlertCount(
    monitorId: string,
    count: number,
    windows: number,
  ): Promise<void> {
    try {
      await this.dbService.db
        .update(schema.monitors)
        .set({
          config: sql`jsonb_set(coalesce(${schema.monitors.config}, '{}'::jsonb), '{aggregatedAlertState}', coalesce(${schema.monitors.config}->'aggregatedAlertState', '{}'::jsonb) || jsonb_build_object('lastAlertCount', ${count}::int, 'lastAlertWindows', ${windows}::int, 'alertCounterVersion', 2))`,
        })
        .where(eq(schema.monitors.id, monitorId));
    } catch (error) {
      this.logger.error(
        `Failed to persist last alert count for monitor ${monitorId}: ${getErrorMessage(error)}`,
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
  }): Promise<{
    alertSent: boolean;
    alertType?: string;
    /** An alert was due and attempted but no channel accepted it (not the same as suppressed). */
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
    // Failure alerts: the window index this check's alert uses. A delivery consumes that window, so
    // `alertsSentForFailure` stores the windows used (window + 1): an alert delivered late in window 1
    // leaves window 2 as the next one, not the rest of window 1. At most 3 windows, so at most 3 alerts.
    let currentWindow = alertsSentForFailure;
    let alertType: 'recovery' | 'failure' | null = null;

    if (currentStatus === 'down') {
      alertType = 'failure';
      const failureThreshold =
        (monitorAlertConfig?.failureThreshold as number) || 1;

      const failureAlertWanted =
        incidentOnly ||
        (monitorAlertConfig?.alertOnFailure as boolean) ||
        false;
      // With N = max(5, 2 * threshold), alert window j (0, 1, 2) opens N * (2^j - 1) failures after the
      // threshold and lasts N checks: the first alert, then reminders after gaps of N and 2N. An alert that
      // failed to deliver stays due (the counter only moves after a delivery) until its window closes, and an
      // alert still unsent may use any later window, so at most 3 are delivered. Consecutive deliveries are
      // always more than N failures apart.
      const windowSize = Math.max(5, failureThreshold * 2);
      const failuresAfterThreshold = consecutiveFailureCount - failureThreshold;
      // A delivered alert is followed by at least the scheduled gap N * 2^(k-1) (k = windows used), counted
      // from the count it was actually delivered at, so a late alert cannot be followed by an immediate one.
      const lastState = isMultiLocationEvaluation
        ? aggregatedAlertState
        : this.readAggregatedAlertState(monitorConfig);
      // Only a count written with the current counter value (by a worker that knows windows) is trusted;
      // otherwise the stored value is an older worker's delivered count, whose schedule is never earlier.
      const lastAlertCount =
        lastState?.alertCounterVersion === 2 &&
        lastState.lastAlertWindows === alertsSentForFailure
          ? lastState.lastAlertCount
          : undefined;
      const lastFailures =
        alertsSentForFailure >= 1 &&
        lastAlertCount !== undefined &&
        lastAlertCount >= failureThreshold &&
        lastAlertCount <= consecutiveFailureCount
          ? lastAlertCount - failureThreshold
          : undefined;
      const earliestAfterLast =
        lastFailures === undefined
          ? 0
          : lastFailures + windowSize * 2 ** (alertsSentForFailure - 1);
      // The window this check falls in, if it is one an alert may still use.
      for (let j = alertsSentForFailure; j < MAX_FAILURE_ALERTS; j++) {
        const start = Math.max(windowSize * (2 ** j - 1), earliestAfterLast);
        if (
          failureAlertWanted &&
          failuresAfterThreshold >= start &&
          failuresAfterThreshold < start + windowSize
        ) {
          currentWindow = j;
          shouldSendAlert = true;
          break;
        }
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

    // The key of the outage this alert belongs to: from the counters' own state (aggregated state, or the
    // result row for a single location). Without one the alert is sent unclaimed, as before claims existed.
    const storedOutageKey = (
      latestResult?.details as { outageKey?: unknown } | null | undefined
    )?.outageKey;
    const outageKey = isMultiLocationEvaluation
      ? aggregatedAlertState?.outageKey
      : typeof storedOutageKey === 'string' &&
          UUID_PATTERN.test(storedOutageKey)
        ? storedOutageKey
        : undefined;
    const claim =
      outageKey && !incidentOnly
        ? {
            outageKey,
            ordinal: alertType === 'failure' ? currentWindow : 0,
          }
        : undefined;
    // A key minted by this evaluation (manual run: no group-owned state) must be durable before anything is
    // sent under it, or a second evaluation would mint another and claim the same alert again.
    if (
      claim &&
      isMultiLocationEvaluation &&
      aggregatedAlertState &&
      !options.preparedAlertState &&
      this.readAggregatedAlertState(monitorConfig).outageKey !== outageKey
    ) {
      // Not durable: sending under it could be repeated under another key, so defer the alert (retried).
      if (
        (await this.persistAggregatedAlertState(
          monitorId,
          aggregatedAlertState,
        )) === false
      ) {
        return { alertSent: false, deliveryFailed: true };
      }
    }

    // Set once the provider accepted the alert: later persistence errors are not delivery failures.
    let delivered = false;
    try {
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
            claim,
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
        // A recovery has one claim and no later window to fall back on, so one held by an evaluator that may
        // have died is retried (the claim goes stale); a failure alert is retried by the next window anyway.
        return (notification as { reason?: string }).reason === 'claimed' &&
          alertType === 'recovery'
          ? { alertSent: false, deliveryFailed: true }
          : { alertSent: false };
      }
      // Every channel used up its attempts: terminal for this window. The window is consumed below like a
      // delivery, so later checks stop re-reading the same dead claims, but it is not reported as sent.
      const gaveUp =
        (notification as { gaveUp?: boolean } | undefined)?.gaveUp === true;
      if (
        !suppressed &&
        !incidentSignalled &&
        !gaveUp &&
        notification?.delivered === false
      )
        return { alertSent: false, deliveryFailed: true };
      delivered = true;
      // Every provider already had this alert (an earlier evaluation sent it and its counter write was lost):
      // the counters below catch up, nothing was sent now.
      const alreadySent =
        (notification as { alreadySent?: boolean } | undefined)?.alreadySent ===
        true;

      if (isMultiLocationEvaluation && aggregatedAlertState) {
        const updatedAggregatedAlertState =
          alertType === 'failure'
            ? {
                ...aggregatedAlertState,
                alertsSentForFailure: currentWindow + 1,
                lastAlertCount: consecutiveFailureCount,
                lastAlertWindows: currentWindow + 1,
                alertCounterVersion: 2 as const,
              }
            : {
                ...aggregatedAlertState,
                alertsSentForRecovery:
                  aggregatedAlertState.alertsSentForRecovery + 1,
              };

        await this.persistAggregatedAlertState(
          monitorId,
          updatedAggregatedAlertState,
          // Only a group-owned state is monotonic: a manual run has no prepared state, so an old outage's
          // counter (left by a suppressed recovery) must not outlast a new outage.
          {
            monotonicFailureCounter:
              alertType === 'failure' &&
              Boolean(aggregatedAlertState.executionGroupId),
          },
        );
      }

      // Preserve existing single-location behavior
      if (!isMultiLocationEvaluation && latestResult) {
        if (alertType === 'failure') {
          await this.dbService.db
            .update(schema.monitorResults)
            // GREATEST: a stale retry (or a changed threshold) must never lower the windows used.
            .set({
              alertsSentForFailure: sql`GREATEST(${schema.monitorResults.alertsSentForFailure}, ${currentWindow + 1})`,
            })
            .where(eq(schema.monitorResults.id, latestResult.id));
          await this.persistSingleLocationLastAlertCount(
            monitorId,
            consecutiveFailureCount,
            currentWindow + 1,
          );
        } else if (alertType === 'recovery') {
          await this.dbService.db
            .update(schema.monitorResults)
            .set({
              alertsSentForRecovery: alertsSentForRecovery + 1,
            })
            .where(eq(schema.monitorResults.id, latestResult.id));
        }
      }

      return suppressed || alreadySent || gaveUp
        ? { alertSent: false }
        : { alertSent: true, alertType };
    } catch (error) {
      if (isMultiLocationEvaluation && aggregatedAlertState) {
        await this.persistAggregatedAlertState(monitorId, aggregatedAlertState);
      }

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
      // The monitor row lock serializes preparers, so the receipt read below cannot race its insert.
      const [receipt] = await tx
        .select({
          evaluation: schema.monitorGroupEvaluations.evaluation,
          processedAt: schema.monitorGroupEvaluations.notificationProcessedAt,
        })
        .from(schema.monitorGroupEvaluations)
        .where(
          and(
            eq(schema.monitorGroupEvaluations.monitorId, monitorId),
            eq(
              schema.monitorGroupEvaluations.executionGroupId,
              executionGroupId,
            ),
          ),
        )
        .limit(1);
      if (receipt) {
        if (receipt.processedAt) return null;
        return {
          monitor,
          receipt: { kind: 'group' } as GroupReceipt,
          evaluation: receipt.evaluation as GroupAlertEvaluation,
        };
      }
      // A group evaluated by a worker that predates monitor_group_evaluations keeps its receipt in
      // one result row's details; honour it so a rollout neither re-advances counters nor re-alerts.
      const [legacy] = await tx
        .select({
          id: schema.monitorResults.id,
          evaluation: sql<GroupAlertEvaluation>`${schema.monitorResults.details} -> 'aggregationEvaluation'`,
          // Exact JSON true, as older workers wrote it; no cast, so an odd value cannot fail the job.
          processed: sql<boolean>`coalesce(${schema.monitorResults.details} -> 'aggregationNotificationProcessed' = 'true'::jsonb, false)`,
        })
        .from(schema.monitorResults)
        .where(
          and(
            eq(schema.monitorResults.monitorId, monitorId),
            eq(schema.monitorResults.executionGroupId, executionGroupId),
            sql`jsonb_typeof(${schema.monitorResults.details} -> 'aggregationEvaluation') = 'object'`,
          ),
        )
        .limit(1);
      if (legacy) {
        if (legacy.processed) return null;
        return {
          monitor,
          receipt: { kind: 'legacy', resultId: legacy.id } as GroupReceipt,
          evaluation: legacy.evaluation,
        };
      }
      const [row] = await tx
        .select({ id: schema.monitorResults.id })
        .from(schema.monitorResults)
        .where(
          and(
            eq(schema.monitorResults.monitorId, monitorId),
            eq(schema.monitorResults.executionGroupId, executionGroupId),
          ),
        )
        .limit(1);
      if (!row) throw new Error('Persisted aggregation group is missing');
      // A stale group is dropped only when the monitor already holds an equal or newer check (a duplicate
      // whose receipt aged out, or one superseded by a later cycle). Otherwise it is the latest news the
      // monitor has, so it is evaluated normally and alerts follow the usual rules.
      if (Date.now() - checkedAt.getTime() > GROUP_EVALUATION_MAX_AGE_MS) {
        const superseded =
          monitor.lastCheckAt != null &&
          monitor.lastCheckAt.getTime() >= checkedAt.getTime();
        // Structured so log-based alerting can match `monitor_group_evaluation_stale`.
        this.logger.warn(
          JSON.stringify({
            event: 'monitor_group_evaluation_stale',
            action: superseded ? 'dropped_superseded' : 'evaluated',
            monitorId,
            executionGroupId,
            checkedAt: checkedAt.toISOString(),
          }),
        );
        if (superseded) return null;
      }
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
      await tx.insert(schema.monitorGroupEvaluations).values({
        monitorId,
        executionGroupId,
        evaluation,
      });
      return {
        monitor,
        receipt: { kind: 'group' } as GroupReceipt,
        evaluation,
      };
    });
  }

  /**
   * Leases the right to send the group's alerts. Returns a claim token, or null when another writer holds a
   * live lease (callers must not send). A lease older than GROUP_NOTIFICATION_LEASE_MS with no processed marker
   * is taken over, so a crash between claim and send still delivers after the lease; that window can duplicate.
   */
  async claimGroupNotification(
    monitorId: string,
    executionGroupId: string,
    receipt: GroupReceipt,
  ): Promise<string | null> {
    // Groups from older workers keep their receipt in a result row, which has no lease: no claim to take.
    if (receipt.kind === 'legacy') return 'legacy';
    const token = randomUUID();
    const won = await this.dbService.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          processedAt: schema.monitorGroupEvaluations.notificationProcessedAt,
          claimedAt: schema.monitorGroupEvaluations.notificationClaimedAt,
        })
        .from(schema.monitorGroupEvaluations)
        .where(
          and(
            eq(schema.monitorGroupEvaluations.monitorId, monitorId),
            eq(
              schema.monitorGroupEvaluations.executionGroupId,
              executionGroupId,
            ),
          ),
        )
        .limit(1)
        .for('update');
      if (!row || row.processedAt) return 'lost' as const;
      const leased =
        row.claimedAt &&
        Date.now() - row.claimedAt.getTime() < GROUP_NOTIFICATION_LEASE_MS;
      if (leased) return 'lost' as const;
      await tx
        .update(schema.monitorGroupEvaluations)
        .set({
          notificationClaimedAt: new Date(),
          notificationClaimToken: token,
        })
        .where(
          and(
            eq(schema.monitorGroupEvaluations.monitorId, monitorId),
            eq(
              schema.monitorGroupEvaluations.executionGroupId,
              executionGroupId,
            ),
          ),
        );
      return row.claimedAt ? ('took_over' as const) : ('claimed' as const);
    });
    if (won === 'lost') {
      this.logger.warn(
        JSON.stringify({
          event: 'monitor_group_notification_claim_lost',
          monitorId,
          executionGroupId,
        }),
      );
      return null;
    }
    if (won === 'took_over')
      this.logger.warn(
        JSON.stringify({
          event: 'monitor_group_notification_lease_expired',
          note: 'previous sender never finished; alert may duplicate',
          monitorId,
          executionGroupId,
        }),
      );
    return token;
  }

  /** Frees a lease after a failed send so the retry can claim at once. Best effort; the lease expires anyway. */
  async releaseGroupNotification(
    monitorId: string,
    executionGroupId: string,
    receipt: GroupReceipt,
    token: string,
  ): Promise<void> {
    if (receipt.kind === 'legacy') return;
    await this.dbService.db
      .update(schema.monitorGroupEvaluations)
      .set({ notificationClaimedAt: null, notificationClaimToken: null })
      .where(
        and(
          eq(schema.monitorGroupEvaluations.monitorId, monitorId),
          eq(schema.monitorGroupEvaluations.executionGroupId, executionGroupId),
          eq(schema.monitorGroupEvaluations.notificationClaimToken, token),
          isNull(schema.monitorGroupEvaluations.notificationProcessedAt),
        ),
      );
  }

  /** Records that the group's alerts were sent, so no retry or late sibling sends them again. */
  async markGroupNotified(
    monitorId: string,
    executionGroupId: string,
    receipt: GroupReceipt,
  ): Promise<void> {
    if (receipt.kind === 'legacy') {
      await this.dbService.db
        .update(schema.monitorResults)
        .set({
          details: sql`jsonb_set(coalesce(${schema.monitorResults.details}, '{}'::jsonb), '{aggregationNotificationProcessed}', 'true'::jsonb)`,
        })
        .where(eq(schema.monitorResults.id, receipt.resultId));
      return;
    }
    // TODO(remove next release): the second statement writes the legacy receipt (one result-row update per
    // group) so a rollback to a worker that predates monitor_group_evaluations neither re-counts nor
    // re-alerts it. Both statements commit together. Tracked in the CHANGELOG upgrade note.
    await this.dbService.db.transaction(async (tx) => {
      const [done] = await tx
        .update(schema.monitorGroupEvaluations)
        .set({ notificationProcessedAt: new Date() })
        .where(
          and(
            eq(schema.monitorGroupEvaluations.monitorId, monitorId),
            eq(
              schema.monitorGroupEvaluations.executionGroupId,
              executionGroupId,
            ),
            isNull(schema.monitorGroupEvaluations.notificationProcessedAt),
          ),
        )
        .returning({ evaluation: schema.monitorGroupEvaluations.evaluation });
      if (!done) return;
      await tx
        .update(schema.monitorResults)
        .set({
          details: sql`jsonb_set(jsonb_set(coalesce(${schema.monitorResults.details}, '{}'::jsonb), '{aggregationEvaluation}', ${JSON.stringify(done.evaluation)}::jsonb), '{aggregationNotificationProcessed}', 'true'::jsonb)`,
        })
        .where(
          eq(
            schema.monitorResults.id,
            sql`(select id from monitor_results where monitor_id = ${monitorId} and execution_group_id = ${executionGroupId} limit 1)`,
          ),
        );
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
      // SSL alerts or SSL Check turned off: a warning sent earlier must not leave a stale "renewed" notice
      // that fires when they are turned back on.
      const warnedId = monitor?.config?.sslAlertState?.id;
      const alertsOff =
        !monitor?.alertConfig?.enabled ||
        !monitor.alertConfig.alertOnSslExpiration;
      const sslCheckOff = monitor?.config?.enableSslCheck !== true;
      if (
        monitor &&
        typeof warnedId === 'string' &&
        (alertsOff || sslCheckOff)
      ) {
        await this.clearSslWarning(monitor.id, warnedId);
      }
      // SSL Check off: an in-flight read from before it was disabled must not send any SSL alert either.
      if (alertsOff || sslCheckOff) {
        return;
      }
      // Removed debug log

      // Alert from certificate data only: a probe that read no certificate (timeout,
      // reset) is not an expiring certificate and must not send one.
      const sslCertificate = resultData.details?.sslCertificate;
      let shouldAlert = false;
      let alertReason = '';

      // A certificate that was warned about is healthy again: say so once, instead of leaving the warning open.
      if (await this.notifySslRenewed(resultData, monitor)) return;

      if (!sslCertificate) {
        // The site answers but the certificate probe keeps failing: after a day, say so.
        // A site that is down already alerts as down; don't add an SSL warning to it.
        if (!resultData.isUp) {
          return;
        }
        const since = resultData.details?.sslProbeFailedSince;
        const sinceMs = typeof since === 'string' ? Date.parse(since) : NaN;
        if (
          Number.isNaN(sinceMs) ||
          Date.now() - sinceMs < SSL_PROBE_FAILURE_ALERT_MS
        ) {
          return;
        }
        shouldAlert = true;
        alertReason = `SSL certificate could not be read for ${Math.floor(
          (Date.now() - sinceMs) / 3_600_000,
        )} hours`;
      }

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
                observedAt: resultData.checkedAt,
              },
            );

          // Only log important SSL alerts
          if (sent) {
            this.logger.log(
              `Sent SSL expiration alert for monitor ${resultData.monitorId}: ${alertReason}`,
            );
            await this.recordSslWarning(
              resultData.monitorId,
              monitor.target,
              sslCertificate?.validTo,
            );
          }
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
   * Remembers that an SSL warning was delivered for this host, until the renewed notice is sent. Keeps the
   * first warning's id and certificate expiry while the host stays the same (daily repeats are the same episode).
   */
  private async recordSslWarning(
    monitorId: string,
    target: string,
    validTo: string | undefined,
  ): Promise<void> {
    const host = sslHost(target) ?? null;
    const state = JSON.stringify({
      id: randomUUID(),
      host,
      ...(validTo ? { validTo } : {}),
      warnedAt: new Date().toISOString(),
    });
    try {
      await this.dbService.db
        .update(schema.monitors)
        .set({
          config: sql`coalesce(${schema.monitors.config}, '{}'::jsonb) || jsonb_build_object('sslAlertState', CASE WHEN ${schema.monitors.config}->'sslAlertState'->>'id' IS NOT NULL AND ${schema.monitors.config}->'sslAlertState'->>'host' IS NOT DISTINCT FROM ${host}::text THEN ${schema.monitors.config}->'sslAlertState' ELSE ${state}::jsonb END)`,
        })
        .where(eq(schema.monitors.id, monitorId));
    } catch (error) {
      this.logger.warn(
        `Failed to record SSL warning state for monitor ${monitorId}: ${getErrorMessage(error)}`,
      );
    }
  }

  private async clearSslWarning(
    monitorId: string,
    warningId: string,
  ): Promise<void> {
    try {
      await this.dbService.db
        .update(schema.monitors)
        .set({
          config: sql`coalesce(${schema.monitors.config}, '{}'::jsonb) - 'sslAlertState'`,
        })
        .where(
          and(
            eq(schema.monitors.id, monitorId),
            // Only the episode being closed: a newer warning keeps its own state.
            sql`${schema.monitors.config}->'sslAlertState'->>'id' = ${warningId}`,
          ),
        );
    } catch (error) {
      this.logger.warn(
        `Failed to clear SSL warning state for monitor ${monitorId}: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Sends "SSL certificate renewed" when a warning was delivered for this host and a later read shows a valid
   * certificate with more days left than the warning window, or a later expiry than the warned one. Once per
   * warning episode: the notice is claimed under the episode's id, so regions, retries and workers share it.
   * Returns true when this read was consumed by the renewal (sent, or already sent earlier).
   */
  private async notifySslRenewed(
    resultData: MonitorExecutionResult,
    monitor: Monitor,
  ): Promise<boolean> {
    const state = monitor.config?.sslAlertState;
    const certificate = resultData.details?.sslCertificate;
    if (
      !state ||
      typeof state.id !== 'string' ||
      !UUID_PATTERN.test(state.id) ||
      !certificate
    ) {
      return false;
    }
    if (state.host !== (sslHost(monitor.target) ?? null)) {
      // The target moved to another host: that warning is about a certificate we no longer watch.
      await this.clearSslWarning(monitor.id, state.id);
      return false;
    }
    const days = certificate.daysRemaining;
    const validToMs = certificate.validTo
      ? Date.parse(certificate.validTo)
      : NaN;
    const warnedToMs = state.validTo ? Date.parse(state.validTo) : NaN;
    const warningDays =
      monitor.config?.sslDaysUntilExpirationWarning ??
      SECURITY.SSL_DEFAULT_WARNING_DAYS;
    // "Renewed" only when the expiry actually moved later than the warned certificate's (the warning window
    // being edited since does not make the same certificate new). A warning with no recorded expiry (the
    // certificate could not be read) has nothing to compare: the notice then says it is readable again,
    // once the certificate is outside the warning window.
    const hasWarnedExpiry = !Number.isNaN(warnedToMs);
    const healthy =
      certificate.valid !== false &&
      days !== undefined &&
      days > 0 &&
      (hasWarnedExpiry ? validToMs > warnedToMs : days > warningDays);
    if (!healthy) return false;

    const validUntil = Number.isNaN(validToMs)
      ? undefined
      : new Date(validToMs).toISOString().slice(0, 10);
    // The warning was that no certificate could be read (nothing recorded to renew): say it is readable again.
    const readableAgain = !hasWarnedExpiry;
    const noun = readableAgain
      ? 'SSL certificate readable again'
      : 'SSL certificate renewed';
    const result = await this.monitorAlertService.sendSslRenewedNotification(
      monitor.id,
      validUntil ? `${noun} (valid until ${validUntil})` : noun,
      {
        sslCertificate: certificate,
        daysRemaining: days,
        observedAt: resultData.checkedAt,
        ...(readableAgain ? { readableAgain: true } : {}),
      },
      { outageKey: state.id, ordinal: 0 },
    );
    if (result.delivered) {
      this.logger.log(
        `Sent SSL ${readableAgain ? 'readable again' : 'renewed'} notice for monitor ${monitor.id}${validUntil ? ` (valid until ${validUntil})` : ''}`,
      );
    } else if (result.gaveUp) {
      // Every channel used up its attempts: stop claiming it on every check.
      this.logger.warn(
        `Giving up the SSL ${readableAgain ? 'readable again' : 'renewed'} notice for monitor ${monitor.id}: delivery failed on every attempt`,
      );
    }
    if (result.delivered || result.gaveUp) {
      await this.clearSslWarning(monitor.id, state.id);
    }
    return result.delivered;
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
