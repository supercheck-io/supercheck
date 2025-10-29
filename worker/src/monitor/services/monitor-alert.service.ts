import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { DbService } from 'src/db/db.service';
import * as schema from '../../db/schema';
import {
  AlertType,
  NotificationProviderConfig,
  NotificationProviderType,
} from '../../db/schema';
import {
  NotificationService,
  NotificationPayload,
  NotificationProvider,
} from 'src/notification/notification.service';
import { decryptNotificationProviderConfig } from '../../common/notification-provider-crypto';

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
  ) {}

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
    const monitor = (await db.query.monitors.findFirst({
      where: eq(schema.monitors.id, monitorId),
    })) as typeof schema.monitors.$inferSelect | undefined;

    if (!monitor) {
      this.logger.error(`[NOTIFY] Monitor not found: ${monitorId}`);
      return;
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
      return;
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

    const decryptedProviders = providers.map(
      (provider): NotificationProvider => {
        const decryptedConfig = decryptNotificationProviderConfig(
          provider.config,
          provider.projectId ?? undefined,
        );

        return {
          id: provider.id,
          type: provider.type,
          config: decryptedConfig,
        };
      },
    );

    if (decryptedProviders.length === 0) {
      this.logger.log(
        `[NOTIFY] No notification providers configured for monitor ${monitorId}`,
      );
      return;
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
          return;
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
          return;
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
      const historyRecords = deliveryResults.results.map((result) => ({
        type: notificationType as AlertType,
        message: notificationPayload.message,
        target: monitor.name,
        targetType: 'monitor',
        monitorId: monitor.id,
        provider: result.provider.id,
        status: result.success ? ('sent' as const) : ('failed' as const),
        errorMessage: result.error,
        sentAt: new Date(),
      }));

      await db.insert(schema.alertHistory).values(historyRecords);
    }
  }

  async sendSslExpirationNotification(
    monitorId: string,
    reason: string,
    metadata: Record<string, unknown> = {},
  ) {
    this.logger.log(
      `[SSL-NOTIFY] SSL expiration notification for monitor ${monitorId}`,
    );

    const db = this.dbService.db;

    // Get monitor details
    const monitor = (await db.query.monitors.findFirst({
      where: eq(schema.monitors.id, monitorId),
    })) as typeof schema.monitors.$inferSelect | undefined;

    if (!monitor) {
      this.logger.error(`[SSL-NOTIFY] Monitor not found: ${monitorId}`);
      return;
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
      return;
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

    const decryptedProviders = providers.map(
      (provider): NotificationProvider => {
        const decryptedConfig = decryptNotificationProviderConfig(
          provider.config,
          provider.projectId ?? undefined,
        );

        return {
          id: provider.id,
          type: provider.type,
          config: decryptedConfig,
        };
      },
    );

    if (decryptedProviders.length === 0) {
      this.logger.log(
        `[SSL-NOTIFY] No notification providers configured for monitor ${monitorId}`,
      );
      return;
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
      const historyRecords = deliveryResults.results.map((result) => ({
        type: 'ssl_expiring' as AlertType,
        message: notificationPayload.message,
        target: monitor.name,
        targetType: 'monitor',
        monitorId: monitor.id,
        provider: result.provider.id,
        status: result.success ? ('sent' as const) : ('failed' as const),
        errorMessage: result.error,
        sentAt: new Date(),
      }));

      await db.insert(schema.alertHistory).values(historyRecords);
    }
  }
}
