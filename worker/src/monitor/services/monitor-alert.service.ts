import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, lte, gt, ne } from 'drizzle-orm';
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

@Injectable()
export class MonitorAlertService {
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

  /** Lets an open incident for this monitor auto-resolve, whether or not a recovery alert goes out. */
  async signalRecovery(monitorId: string, recoveredAt: Date): Promise<void> {
    await this.sreAlertTriageQueueService.enqueueSourceRecovery({
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
  async signalFailure(monitorId: string, reason: string) {
    if (await this.isUnderScheduledMaintenance(monitorId)) {
      return {
        delivered: false,
        suppressed: true,
        reason: 'maintenance' as const,
      };
    }
    // The failing check's time, not now: a failure signalled after a recovery must still read as older than it.
    const failing = await this.dbService.db.query.monitorResults.findFirst({
      where: and(
        eq(schema.monitorResults.monitorId, monitorId),
        ne(schema.monitorResults.status, 'up'),
      ),
      orderBy: [desc(schema.monitorResults.checkedAt)],
      columns: { checkedAt: true },
    });
    const firedAt = failing?.checkedAt
      ? new Date(failing.checkedAt)
      : new Date();
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
        return this.signalFailure(monitorId, reason);
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
      timestamp: new Date(),
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
      },
    };

    this.logger.log(
      `[NOTIFY] Sending ${notificationType} notifications to ${decryptedProviders.length} providers`,
    );

    const deliveryResults =
      await this.notificationService.sendNotificationToMultipleProviders(
        decryptedProviders,
        notificationPayload,
      );

    const successCount = deliveryResults.success;
    const failedCount = deliveryResults.failed;

    this.logger.log(
      `[NOTIFY] Notification results: ${successCount} success, ${failedCount} failed`,
    );

    if (deliveryResults.results.length > 0) {
      const sentAt = new Date(); // one per failure: per-channel rows must share it
      const historyRecords = deliveryResults.results.map((result) => ({
        type: notificationType,
        message: notificationPayload.message,
        target: monitor.name,
        targetType: 'monitor',
        monitorId: monitor.id,
        provider: result.provider.id,
        status:
          result.success || result.partial
            ? ('sent' as const)
            : ('failed' as const),
        errorMessage: result.error,
        deliveryMetadata: result.deliveryMetadata,
        sentAt,
      }));

      // Delivery already happened: a bookkeeping failure must not be reported as a failed delivery.
      try {
        const createdRows = await db
          .insert(schema.alertHistory)
          .values(historyRecords)
          .returning({
            id: schema.alertHistory.id,
            status: schema.alertHistory.status,
          });
        await this.sreAlertTriageQueueService.enqueueAlertHistoryRows(
          createdRows,
        );
      } catch (error) {
        this.logger.error(
          `[NOTIFY] Failed to record alert history for monitor ${monitorId}: ${getErrorMessage(error)}`,
        );
      }
    }
    // A provider that reached some recipients (partial email) counts as delivered: a retry would resend to them.
    return {
      delivered:
        successCount > 0 || deliveryResults.results.some((r) => r.partial),
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

    const notificationPayload: NotificationPayload = {
      type: 'ssl_expiring',
      title: `SSL Certificate Warning - ${monitor.name}`,
      message:
        monitor.alertConfig.customMessage ||
        `SSL certificate issue detected: ${reason}`,
      targetName: monitor.name,
      targetId: monitor.id,
      severity: 'warning',
      timestamp: new Date(),
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
        message: notificationPayload.message,
        target: monitor.name,
        targetType: 'monitor',
        monitorId: monitor.id,
        provider: result.provider.id,
        status:
          result.success || result.partial
            ? ('sent' as const)
            : ('failed' as const),
        errorMessage: result.error,
        deliveryMetadata: result.deliveryMetadata,
        sentAt,
      }));

      const createdRows = await db
        .insert(schema.alertHistory)
        .values(historyRecords)
        .returning({
          id: schema.alertHistory.id,
          status: schema.alertHistory.status,
        });
      await this.sreAlertTriageQueueService.enqueueAlertHistoryRows(
        createdRows,
      );
    }
    // A partial email delivery reached recipients, as in sendNotification.
    return successCount > 0 || deliveryResults.results.some((r) => r.partial);
  }
}
