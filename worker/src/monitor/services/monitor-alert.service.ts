import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, lte, gt, ne } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import * as schema from '../../db/schema';
import {
  NotificationProviderConfig,
  NotificationProviderType,
} from '../../db/schema';
import {
  NotificationService,
  NotificationPayload,
  NotificationProvider,
} from '../../notification/notification.service';
import { decryptNotificationProviderConfig } from '../../common/notification-provider-crypto';
import { SreAlertTriageQueueService } from './sre-alert-triage-queue.service';
import { getErrorMessage } from '../../common/validation';

type ProviderRow = {
  id: string;
  type: NotificationProviderType;
  config: NotificationProviderConfig;
  projectId: string | null;
};

/**
 * Strips credentials and query values from URLs inside free text before it is persisted.
 * Local on purpose: the shared worker helper lands in a separate PR; swap to it after both merge.
 */
export function redactUrlsInText(text: string | undefined | null) {
  if (!text) return undefined;
  return text.replace(/https?:\/\/[^\s"'<>)\]]+/gi, (raw) => {
    try {
      const url = new URL(raw);
      url.username = '';
      url.password = '';
      for (const key of [...url.searchParams.keys()])
        url.searchParams.set(key, 'REDACTED');
      url.hash = '';
      return url.toString();
    } catch {
      return '[redacted-url]';
    }
  });
}

const SSL_ALERT_THROTTLE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MonitorAlertService {
  /**
   * Last SSL alert delivered per monitor by this process. Backs the 24h throttle when the alert_history
   * row could not be written (the evaluator throttles from that row). Per process: best effort.
   */
  private readonly sslAlertDeliveredAt = new Map<string, number>();

  /**
   * History rows of delivered alerts whose insert failed, by `<monitorId>:<status|ssl>`. They are retried
   * before the next alert of that kind, and a retry reads them to skip channels that already got the alert.
   * Per process and bounded: best effort, lost on restart.
   */
  private readonly pendingHistory = new Map<
    string,
    Array<typeof schema.alertHistory.$inferInsert>
  >();

  /** Inserts the rows (plus any pending ones for `key`); on failure keeps them pending. */
  private async recordHistory(
    key: string,
    rows: Array<typeof schema.alertHistory.$inferInsert>,
    label: string,
  ): Promise<void> {
    const all = [...(this.pendingHistory.get(key) ?? []), ...rows];
    if (all.length === 0) return;
    let createdRows: Array<{
      id: string;
      status: 'pending' | 'sent' | 'failed';
    }>;
    try {
      createdRows = await this.dbService.db
        .insert(schema.alertHistory)
        .values(all)
        .returning({
          id: schema.alertHistory.id,
          status: schema.alertHistory.status,
        });
      this.pendingHistory.delete(key);
    } catch (error) {
      this.pendingHistory.delete(key);
      this.pendingHistory.set(key, all.slice(-50));
      if (this.pendingHistory.size > 200) {
        for (const oldest of this.pendingHistory.keys()) {
          this.pendingHistory.delete(oldest);
          break;
        }
      }
      this.logger.error(
        `[${label}] Failed to record alert history (kept for retry): ${getErrorMessage(error)}`,
      );
      return;
    }
    try {
      await this.sreAlertTriageQueueService.enqueueAlertHistoryRows(
        createdRows,
      );
    } catch (error) {
      this.logger.error(
        `[${label}] Failed to queue alert history for triage: ${getErrorMessage(error)}`,
      );
    }
  }
  private readonly logger = new Logger(MonitorAlertService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
    private readonly sreAlertTriageQueueService: SreAlertTriageQueueService,
  ) {}

  /** One channel whose config cannot be decrypted must not block delivery to the others. */
  private decryptProviders(providers: ProviderRow[]): NotificationProvider[] {
    return providers.flatMap((provider): NotificationProvider[] => {
      try {
        const config = decryptNotificationProviderConfig(
          provider.config,
          provider.projectId ?? undefined,
        );
        return [{ id: provider.id, type: provider.type, config }];
      } catch (error) {
        this.logger.error(
          `[NOTIFY] Skipping notification provider ${provider.id}: config could not be decrypted (${getErrorMessage(error)})`,
        );
        return [];
      }
    });
  }

  /**
   * Lets an open incident for this monitor auto-resolve, whether or not a recovery alert goes out.
   * False when the enqueue still failed after its in-place retries (already logged).
   */
  async signalRecovery(monitorId: string, recoveredAt: Date): Promise<boolean> {
    return this.sreAlertTriageQueueService.enqueueSourceRecovery({
      sourceType: 'monitor',
      sourceId: monitorId,
      recoveredAt: recoveredAt.toISOString(),
    });
  }

  /** An unresolved scheduled-maintenance incident covers the monitor right now. */
  private async isUnderScheduledMaintenance(
    monitorId: string,
  ): Promise<boolean> {
    const now = new Date();
    const rows = await this.dbService.db
      .select({ id: schema.incidents.id })
      .from(schema.statusPageComponentMonitors)
      .innerJoin(
        schema.incidentComponents,
        eq(
          schema.incidentComponents.componentId,
          schema.statusPageComponentMonitors.componentId,
        ),
      )
      .innerJoin(
        schema.incidents,
        eq(schema.incidents.id, schema.incidentComponents.incidentId),
      )
      .where(
        and(
          eq(schema.statusPageComponentMonitors.monitorId, monitorId),
          ne(schema.incidents.status, 'resolved'),
          lte(schema.incidents.scheduledFor, now),
          gt(schema.incidents.scheduledUntil, now),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Opens or updates the monitor's incident without notifying anyone: for a monitor with no channel or with
   * alerts off. Held back during scheduled maintenance like an alert, so the next failing check retries.
   */
  async signalFailure(monitorId: string, reason: string, observedAt?: Date) {
    if (await this.isUnderScheduledMaintenance(monitorId)) {
      return {
        delivered: false,
        suppressed: true,
        reason: 'maintenance' as const,
      };
    }
    // The failing cycle's own observation time, not the send time: a delayed send must not outrun a recovery.
    const firedAt = observedAt ?? new Date();
    const queued = await this.sreAlertTriageQueueService.enqueueSourceFailure({
      sourceType: 'monitor',
      sourceId: monitorId,
      type: 'monitor_failure',
      message: (reason || 'Monitor is down').slice(0, 2000),
      firedAt: firedAt.toISOString(),
    });
    // A rejected enqueue is a delivery failure: the evaluator retries within its bounded window.
    if (!queued) return { delivered: false };
    return {
      delivered: false,
      suppressed: true,
      reason: 'incident_only' as const,
    };
  }

  async sendNotification(
    monitorId: string,
    type: 'recovery' | 'failure',
    reason: string,
    metadata: Record<string, unknown> = {},
  ) {
    const observed = new Date(String(metadata.observedAt));
    const observedAt = Number.isNaN(observed.getTime()) ? undefined : observed;
    this.logger.log(
      `[NOTIFY] Manual notification trigger for monitor ${monitorId}, type: ${type}`,
    );

    const db = this.dbService.db;

    // Get monitor details
    const monitor = await db.query.monitors.findFirst({
      where: eq(schema.monitors.id, monitorId),
    });

    if (!monitor) {
      this.logger.error(`[NOTIFY] Monitor not found: ${monitorId}`);
      return { delivered: false, suppressed: true };
    }

    // Get project information
    let projectName: string | undefined;
    if (monitor.projectId) {
      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, monitor.projectId),
        columns: { name: true },
      });
      projectName = project?.name ?? projectName;
    }

    // Check if alerts are enabled
    if (!monitor.alertConfig?.enabled) {
      this.logger.log(`[NOTIFY] Alerts not enabled for monitor ${monitorId}`);
      return { delivered: false };
    }

    if (await this.isUnderScheduledMaintenance(monitorId)) {
      this.logger.log(
        `[NOTIFY] Suppressing monitor ${monitorId} alert during scheduled maintenance`,
      );
      return {
        delivered: false,
        suppressed: true,
        reason: 'maintenance' as const,
      };
    }

    // Get notification providers
    const providers = (await db
      .select({
        id: schema.notificationProviders.id,
        type: schema.notificationProviders.type,
        config: schema.notificationProviders.config,
        projectId: schema.notificationProviders.projectId,
      })
      .from(schema.notificationProviders)
      .innerJoin(
        schema.monitorNotificationSettings,
        eq(
          schema.monitorNotificationSettings.notificationProviderId,
          schema.notificationProviders.id,
        ),
      )
      .where(
        and(
          eq(schema.monitorNotificationSettings.monitorId, monitorId),
          eq(schema.notificationProviders.isEnabled, true),
        ),
      )) as ProviderRow[];

    const decryptedProviders = this.decryptProviders(providers);

    // Channels exist but none could be decrypted: a delivery failure, not an empty channel list.
    if (providers.length > 0 && decryptedProviders.length === 0) {
      return { delivered: false };
    }

    if (decryptedProviders.length === 0) {
      this.logger.log(
        `[NOTIFY] No notification providers configured for monitor ${monitorId}`,
      );
      // No channel still tracks the failure: incidents do not depend on a delivered alert.
      if (
        type === 'failure' &&
        providers.length === 0 &&
        monitor.alertConfig?.incidentEnabled !== false
      ) {
        return this.signalFailure(monitorId, reason, observedAt);
      }
      // Nothing to deliver to: not a failure, so the cycle is receipted instead of retried 5 times.
      return {
        delivered: false,
        suppressed: true,
        reason: 'no_providers' as const,
      };
    }

    // Determine notification details
    let notificationType: NotificationPayload['type'];
    let severity: 'info' | 'warning' | 'error' | 'success';
    let title: string;
    let message: string;

    switch (type) {
      case 'recovery':
        notificationType = 'monitor_recovery';
        severity = 'success';
        title = `Monitor Recovered - ${monitor.name}`;
        message = `Monitor "${monitor.name}" has recovered and is now operational.`;
        if (!monitor.alertConfig.alertOnRecovery) {
          this.logger.log(
            `[NOTIFY] Recovery notifications disabled for monitor ${monitorId}`,
          );
          return { delivered: false };
        }
        break;
      case 'failure':
        notificationType = 'monitor_failure';
        severity = 'error';
        title = `Monitor Down - ${monitor.name}`;
        message = `Monitor "${monitor.name}" is down. ${reason || 'No ping received within expected interval'}`;
        if (!monitor.alertConfig.alertOnFailure) {
          this.logger.log(
            `[NOTIFY] Failure notifications disabled for monitor ${monitorId}`,
          );
          return { delivered: false };
        }
        break;
      default: {
        const _exhaustiveCheck: never = type;
        this.logger.error(
          `[NOTIFY] Invalid notification type: ${String(type)}`,
        );
        return _exhaustiveCheck;
      }
    }

    const baseUrl =
      this.configService.get<string>('NEXT_PUBLIC_APP_URL') ||
      this.configService.get<string>('APP_URL') ||
      'http://localhost:3000';

    // Debug logging for URL issues
    if (
      !this.configService.get<string>('NEXT_PUBLIC_APP_URL') &&
      !this.configService.get<string>('APP_URL')
    ) {
      this.logger.warn(
        `[MONITOR-ALERT] No APP_URL configured, using fallback: ${baseUrl}`,
      );
    }

    const dashboardUrl = `${baseUrl}/monitors/${monitor.id}`;

    const notificationPayload: NotificationPayload = {
      type: notificationType,
      title: title,
      message: monitor.alertConfig.customMessage || message,
      targetName: monitor.name,
      targetId: monitor.id,
      severity: severity,
      timestamp: observedAt ?? new Date(),
      projectId: monitor.projectId || undefined,
      projectName: projectName,
      metadata: {
        target: monitor.target,
        type: monitor.type,
        status: type === 'recovery' ? 'up' : 'down',
        dashboardUrl,
        targetUrl: monitor.target,
        trigger: 'runner',
        reason: reason || 'Automated status change detection',
        monitorType: monitor.type,
        checkFrequency: monitor.frequencyMinutes
          ? `${monitor.frequencyMinutes}m`
          : undefined,
        lastCheckTime: monitor.lastCheckAt
          ? new Date(monitor.lastCheckAt).toISOString()
          : undefined,
        ...metadata,
        // The check's own time, so the alert shows when the check ran, not when it was sent.
        ...(observedAt ? { observedAt: observedAt.toISOString() } : {}),
      },
    };

    // A retry of the same alert (same observation time) skips channels that already got it.
    let recipients = decryptedProviders;
    let alreadyDelivered = false;
    if (observedAt) {
      const sentAtMs = observedAt.getTime();
      const doneIds = new Set(
        (this.pendingHistory.get(`${monitorId}:status`) ?? [])
          .filter(
            (row) =>
              row.type === notificationType &&
              row.status === 'sent' &&
              row.sentAt instanceof Date &&
              row.sentAt.getTime() === sentAtMs,
          )
          .map((row) => row.provider),
      );
      try {
        const done = await db
          .select({ provider: schema.alertHistory.provider })
          .from(schema.alertHistory)
          .where(
            and(
              eq(schema.alertHistory.monitorId, monitorId),
              eq(schema.alertHistory.type, notificationType),
              eq(schema.alertHistory.status, 'sent'),
              eq(schema.alertHistory.sentAt, observedAt),
            ),
          );
        for (const row of done) doneIds.add(row.provider);
      } catch (error) {
        // Unknown which channels already got it: sending to all could repeat it, so defer (keep the slot).
        this.logger.error(
          `[NOTIFY] Could not read delivered channels for monitor ${monitorId}, deferring the retry: ${getErrorMessage(error)}`,
        );
        return { delivered: true, retryFailedChannels: true };
      }
      alreadyDelivered = doneIds.size > 0;
      recipients = decryptedProviders.filter(
        (provider) => !doneIds.has(provider.id),
      );
      if (recipients.length === 0) return { delivered: true };
    }

    this.logger.log(
      `[NOTIFY] Sending ${notificationType} notifications to ${recipients.length} providers`,
    );

    const deliveryResults =
      await this.notificationService.sendNotificationToMultipleProviders(
        recipients,
        notificationPayload,
      );

    const successCount = deliveryResults.success;
    const failedCount = deliveryResults.failed;

    this.logger.log(
      `[NOTIFY] Notification results: ${successCount} success, ${failedCount} failed`,
    );

    if (deliveryResults.results.length > 0) {
      // One per alert: per-channel rows share it, and it is the cycle's observation time, which identifies a retry.
      const sentAt = observedAt ?? new Date();
      const historyRecords = deliveryResults.results.map((result) => ({
        type: notificationType,
        message: redactUrlsInText(notificationPayload.message) ?? '',
        target: monitor.name,
        targetType: 'monitor',
        monitorId: monitor.id,
        provider: result.provider.id,
        status:
          result.success || result.partial
            ? ('sent' as const)
            : ('failed' as const),
        errorMessage: redactUrlsInText(result.error),
        deliveryMetadata: result.deliveryMetadata,
        sentAt,
      }));

      // Delivery already happened: a bookkeeping failure must not be reported as a failed delivery.
      await this.recordHistory(`${monitorId}:status`, historyRecords, 'NOTIFY');
    }
    // A provider that reached some recipients (partial email) counts as delivered: a retry would resend to them.
    // Channels that got it on an earlier attempt count too, so a failing retry keeps the slot.
    const delivered =
      successCount > 0 ||
      deliveryResults.results.some((r) => r.partial) ||
      alreadyDelivered;
    return {
      delivered,
      // Only with an observation time can a retry tell which channels already got the alert.
      ...(delivered &&
      observedAt &&
      deliveryResults.results.some((r) => !r.success && !r.partial)
        ? { retryFailedChannels: true }
        : {}),
    };
  }

  async sendSslExpirationNotification(
    monitorId: string,
    reason: string,
    metadata: Record<string, unknown> = {},
  ): Promise<boolean> {
    this.logger.log(
      `[SSL-NOTIFY] SSL expiration notification for monitor ${monitorId}`,
    );

    // A delivered alert whose history row was not written must still open its incident: retry the insert.
    await this.recordHistory(`${monitorId}:ssl`, [], 'SSL-NOTIFY');
    const deliveredAt = this.sslAlertDeliveredAt.get(monitorId);
    if (deliveredAt && Date.now() - deliveredAt < SSL_ALERT_THROTTLE_MS) {
      return false;
    }

    const db = this.dbService.db;

    // Get monitor details
    const monitor = await db.query.monitors.findFirst({
      where: eq(schema.monitors.id, monitorId),
    });

    if (!monitor) {
      this.logger.error(`[SSL-NOTIFY] Monitor not found: ${monitorId}`);
      return false;
    }

    // Get project information
    let projectName: string | undefined;
    if (monitor.projectId) {
      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, monitor.projectId),
        columns: { name: true },
      });
      projectName = project?.name ?? projectName;
    }

    // Check if SSL alerts are enabled
    if (
      !monitor.alertConfig?.enabled ||
      !monitor.alertConfig?.alertOnSslExpiration
    ) {
      this.logger.log(
        `[SSL-NOTIFY] SSL alerts not enabled for monitor ${monitorId}`,
      );
      return false;
    }

    // Same rule as status alerts. Nothing is recorded as sent, so the next check after the window alerts again.
    if (await this.isUnderScheduledMaintenance(monitorId)) {
      this.logger.log(
        `[SSL-NOTIFY] Suppressing monitor ${monitorId} SSL alert during scheduled maintenance`,
      );
      return false;
    }

    // Get notification providers
    const providers = (await db
      .select({
        id: schema.notificationProviders.id,
        type: schema.notificationProviders.type,
        config: schema.notificationProviders.config,
        projectId: schema.notificationProviders.projectId,
      })
      .from(schema.notificationProviders)
      .innerJoin(
        schema.monitorNotificationSettings,
        eq(
          schema.monitorNotificationSettings.notificationProviderId,
          schema.notificationProviders.id,
        ),
      )
      .where(
        and(
          eq(schema.monitorNotificationSettings.monitorId, monitorId),
          eq(schema.notificationProviders.isEnabled, true),
        ),
      )) as ProviderRow[];

    const decryptedProviders = this.decryptProviders(providers);

    if (decryptedProviders.length === 0) {
      this.logger.log(
        providers.length > 0
          ? `[SSL-NOTIFY] Not delivered for monitor ${monitorId}: no provider config could be decrypted`
          : `[SSL-NOTIFY] No notification providers configured for monitor ${monitorId}`,
      );
      return false;
    }

    const baseUrl =
      this.configService.get<string>('NEXT_PUBLIC_APP_URL') ||
      this.configService.get<string>('APP_URL') ||
      'http://localhost:3000';

    // Debug logging for URL issues
    if (
      !this.configService.get<string>('NEXT_PUBLIC_APP_URL') &&
      !this.configService.get<string>('APP_URL')
    ) {
      this.logger.warn(
        `[MONITOR-ALERT] No APP_URL configured, using fallback: ${baseUrl}`,
      );
    }

    const dashboardUrl = `${baseUrl}/monitors/${monitor.id}`;
    const sslObserved = new Date(String(metadata.observedAt));
    const sslObservedAt = Number.isNaN(sslObserved.getTime())
      ? new Date()
      : sslObserved;

    const notificationPayload: NotificationPayload = {
      type: 'ssl_expiring',
      title: `SSL Certificate Warning - ${monitor.name}`,
      message:
        monitor.alertConfig.customMessage ||
        `SSL certificate issue detected: ${reason}`,
      targetName: monitor.name,
      targetId: monitor.id,
      severity: 'warning',
      timestamp: sslObservedAt,
      projectId: monitor.projectId || undefined,
      projectName: projectName,
      metadata: {
        target: monitor.target,
        type: monitor.type,
        status: 'ssl_warning',
        dashboardUrl,
        targetUrl: monitor.target,
        trigger: 'ssl_expiration_check',
        reason: reason,
        monitorType: monitor.type,
        checkFrequency: monitor.frequencyMinutes
          ? `${monitor.frequencyMinutes}m`
          : undefined,
        lastCheckTime: monitor.lastCheckAt
          ? new Date(monitor.lastCheckAt).toISOString()
          : undefined,
        ...metadata,
        observedAt: sslObservedAt.toISOString(),
      },
    };

    this.logger.log(
      `[SSL-NOTIFY] Sending SSL expiration notifications to ${decryptedProviders.length} providers`,
    );

    const deliveryResults =
      await this.notificationService.sendNotificationToMultipleProviders(
        decryptedProviders,
        notificationPayload,
      );

    const successCount = deliveryResults.success;
    const failedCount = deliveryResults.failed;

    this.logger.log(
      `[SSL-NOTIFY] Notification results: ${successCount} success, ${failedCount} failed`,
    );

    if (deliveryResults.results.length > 0) {
      const sentAt = new Date(); // one per alert: per-channel rows must share it
      const historyRecords = deliveryResults.results.map<
        typeof schema.alertHistory.$inferInsert
      >((result) => ({
        type: 'ssl_expiring',
        message: redactUrlsInText(notificationPayload.message) ?? '',
        target: monitor.name,
        targetType: 'monitor',
        monitorId: monitor.id,
        provider: result.provider.id,
        status:
          result.success || result.partial
            ? ('sent' as const)
            : ('failed' as const),
        errorMessage: redactUrlsInText(result.error),
        deliveryMetadata: result.deliveryMetadata,
        sentAt,
      }));

      // Delivery already happened: a bookkeeping failure is retried later, never an error or a resend.
      await this.recordHistory(
        `${monitorId}:ssl`,
        historyRecords,
        'SSL-NOTIFY',
      );
    }
    // A partial email delivery reached recipients, as in sendNotification.
    const delivered =
      successCount > 0 || deliveryResults.results.some((r) => r.partial);
    // Without its 'sent' row the 24h throttle in the evaluator cannot see this alert, so keep it here too.
    if (delivered) {
      const now = Date.now();
      for (const [id, at] of this.sslAlertDeliveredAt)
        if (now - at >= SSL_ALERT_THROTTLE_MS)
          this.sslAlertDeliveredAt.delete(id);
      this.sslAlertDeliveredAt.set(monitorId, now);
    }
    return delivered;
  }
}
