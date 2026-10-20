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

export type AggregatedAlertState = {
  consecutiveFailureCount: number;
  consecutiveSuccessCount: number;
  alertsSentForFailure: number;
  alertsSentForRecovery: number;
  recoverySequence?: boolean;
  executionGroupId?: string;
};

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
        .where(eq(schema.monitors.id, monitorId));

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
    };
  }

  async persistAggregatedAlertState(
    monitorId: string,
    monitorConfig: MonitorConfig | null | undefined,
    aggregatedAlertState: AggregatedAlertState,
  ): Promise<void> {
    try {
      const nextConfig: MonitorConfig = {
        ...(monitorConfig ?? {}),
        aggregatedAlertState,
      };

      await this.dbService.db
        .update(schema.monitors)
        .set({
          config: aggregatedAlertState.executionGroupId
            ? sql`jsonb_set(coalesce(${schema.monitors.config}, '{}'::jsonb), '{aggregatedAlertState}', ${JSON.stringify(aggregatedAlertState)}::jsonb)`
            : nextConfig,
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
   * Threshold behavior (aligned with single-location saveMonitorResult path):
   * - failureThreshold: Number of consecutive failures before first alert (default: 1)
   * - recoveryThreshold: Number of consecutive successes before recovery alert (default: 1)
   * - Max 3 failure alerts with exponential reminders and one recovery alert
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
  }): Promise<{ alertSent: boolean; alertType?: string }> {
    const { monitorId, previousStatus, currentStatus, reason, metadata } =
      options;

    const monitor = options.monitor;

    // Don't send alerts if alerts are disabled
    const monitorAlertConfig = (monitor as Record<string, unknown> | null)
      ?.alertConfig as Record<string, unknown> | undefined;
    if (!monitorAlertConfig?.enabled) {
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
    let alertType: 'recovery' | 'failure' | null = null;

    if (currentStatus === 'down') {
      alertType = 'failure';
      const failureThreshold =
        (monitorAlertConfig?.failureThreshold as number) || 1;

      if (
        consecutiveFailureCount === failureThreshold &&
        alertsSentForFailure === 0
      ) {
        // First alert: threshold just reached
        shouldSendAlert =
          (monitorAlertConfig?.alertOnFailure as boolean) || false;
      } else if (
        consecutiveFailureCount > failureThreshold &&
        alertsSentForFailure < 3
      ) {
        // Subsequent alerts: exponential intervals (max 3 total)
        const subsequentInterval = Math.max(5, failureThreshold * 2);
        const failuresAfterThreshold =
          consecutiveFailureCount - failureThreshold;
        const expectedAlerts = Math.floor(
          failuresAfterThreshold / subsequentInterval,
        );
        shouldSendAlert =
          (monitorAlertConfig?.alertOnFailure as boolean) &&
          expectedAlerts >= alertsSentForFailure &&
          failuresAfterThreshold % subsequentInterval === 0;
      }

      if (!shouldSendAlert) {
        if (consecutiveFailureCount > 0 && alertsSentForFailure >= 3) {
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

      shouldSendAlert =
        consecutiveSuccessCount >= recoveryThreshold &&
        alertsSentForRecovery === 0 &&
        ((monitorAlertConfig?.alertOnRecovery as boolean) || false);

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
        await this.persistAggregatedAlertState(
          monitorId,
          monitorConfig,
          aggregatedAlertState,
        );
      }

      return { alertSent: false };
    }

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
      };

      const notification = await this.monitorAlertService.sendNotification(
        monitorId,
        alertType,
        reason,
        alertMetadata,
      );

      if (notification?.suppressed || notification?.delivered === false)
        return { alertSent: false };

      if (isMultiLocationEvaluation && aggregatedAlertState) {
        const updatedAggregatedAlertState =
          alertType === 'failure'
            ? {
                ...aggregatedAlertState,
                alertsSentForFailure:
                  aggregatedAlertState.alertsSentForFailure + 1,
              }
            : {
                ...aggregatedAlertState,
                alertsSentForRecovery:
                  aggregatedAlertState.alertsSentForRecovery + 1,
              };

        await this.persistAggregatedAlertState(
          monitorId,
          monitorConfig,
          updatedAggregatedAlertState,
        );
      }

      // Preserve existing single-location behavior
      if (!isMultiLocationEvaluation && latestResult) {
        if (alertType === 'failure') {
          await this.dbService.db
            .update(schema.monitorResults)
            .set({ alertsSentForFailure: alertsSentForFailure + 1 })
            .where(eq(schema.monitorResults.id, latestResult.id));
        } else if (alertType === 'recovery') {
          await this.dbService.db
            .update(schema.monitorResults)
            .set({
              alertsSentForRecovery: alertsSentForRecovery + 1,
            } as Partial<typeof schema.monitorResults.$inferInsert>)
            .where(eq(schema.monitorResults.id, latestResult.id));
        }
      }

      return { alertSent: true, alertType };
    } catch (error) {
      if (isMultiLocationEvaluation && aggregatedAlertState) {
        await this.persistAggregatedAlertState(
          monitorId,
          monitorConfig,
          aggregatedAlertState,
        );
      }

      this.logger.error(
        `Failed to send ${alertType} alert for monitor ${monitorId}: ${getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { alertSent: false };
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
        const previousState = this.readAggregatedAlertState(monitor.config);
        evaluation.alertState = {
          ...(monitor.alertConfig?.enabled &&
          !['pending', 'paused'].includes(previousStatus)
            ? this.getNextAggregatedAlertState(
                previousState,
                previousStatus,
                currentStatus,
              )
            : previousState),
          executionGroupId,
        };
      }
      // Commit cycle counters and its receipt together; a Redis marker cannot do this.
      await tx
        .update(schema.monitors)
        .set({
          status: currentStatus,
          lastCheckAt: checkedAt,
          lastStatusChangeAt:
            previousStatus !== currentStatus ? checkedAt : undefined,
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
    }) as Promise<Monitor | undefined>;
  }
}
