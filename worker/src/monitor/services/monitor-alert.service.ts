import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, lte, gt, ne, sql } from 'drizzle-orm';
import { liveMonitor } from '../../db/deletion-visibility';
import { DbService } from '../../db/db.service';
import * as schema from '../../db/schema';
import {
  AlertDeliveryMetadata,
  AlertStatus,
  AlertType,
  NotificationProviderConfig,
  NotificationProviderType,
} from '../../db/schema';
import {
  NotificationService,
  NotificationPayload,
  NotificationProvider,
  ProviderDeliveryResult,
} from '../../notification/notification.service';
import { decryptNotificationProviderConfig } from '../../common/notification-provider-crypto';
import {
  AlertHistoryTriageCandidate,
  SreAlertTriageQueueService,
} from './sre-alert-triage-queue.service';
import { getErrorMessage } from '../../common/validation';
import { redactUrlsInText } from '../../common/validation/data-sanitizer';

type ProviderRow = {
  id: string;
  type: NotificationProviderType;
  config: NotificationProviderConfig;
  projectId: string | null;
};

/** Redacts URLs inside free text before it is persisted to alert history. */
export function redactAlertText(text: string | undefined | null) {
  return text ? redactUrlsInText(text) : undefined;
}

const SSL_ALERT_THROTTLE_MS = 24 * 60 * 60 * 1000;

/** One alert of one outage: the failure alert's window number (0-2), or 0 for the recovery. */
export type AlertClaim = { outageKey: string; ordinal: number };

/** A failed provider is re-claimed (and re-sent) at most this many times per alert. */
export const MAX_CLAIM_ATTEMPTS = 5;
/** A claim still 'pending' after this long (longer than any provider's delivery attempts) belongs to a process that died before it recorded the outcome. */
export const STALE_PENDING_CLAIM_SECONDS = 120;
const HISTORY_FINISH_ATTEMPTS = 5;

/** What is written to a claimed row once its provider's send has settled. */
type ClaimOutcome = {
  status: AlertStatus;
  errorMessage: string | null;
  deliveryMetadata: AlertDeliveryMetadata | null;
  sentAt: Date;
};

@Injectable()
export class MonitorAlertService {
  /**
   * Last SSL alert delivered per monitor by this process. Backs the 24h throttle when the alert_history
   * row could not be written (the evaluator throttles from that row). Per process: best effort.
   */
  private readonly sslAlertDeliveredAt = new Map<string, number>();

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

  /**
   * Reserves one alert_history row per provider for this alert of this outage, before anything is sent.
   * A provider whose row already exists is not returned, unless that row is 'failed' with attempts left or a
   * 'pending' claim abandoned by a dead process; those are taken over in the same statement, so two
   * evaluators can never both hold a provider. Provider ids are sorted so concurrent multi-row upserts
   * lock rows in one order. Throws when the database cannot be used; the caller then sends unreserved.
   */
  private async claimProviders(input: {
    monitorId: string;
    monitorName: string;
    type: AlertType;
    claim: AlertClaim;
    providerIds: string[];
    message: string;
  }): Promise<{
    claimed: Map<string, { id: string; attempts: number }>;
    alreadySent: number;
    inFlight: number;
  }> {
    const { monitorId, type, claim } = input;
    const providerIds = [...new Set(input.providerIds)].sort();
    const message = redactAlertText(input.message) ?? '';
    const db = this.dbService.db;
    const taken = await db
      .insert(schema.alertHistory)
      .values(
        providerIds.map((provider) => ({
          type,
          message,
          target: input.monitorName,
          targetType: 'monitor',
          monitorId,
          provider,
          status: 'pending' as const,
          // The claim time, not the alert time: staleness is judged from it. Finishing the row restores sentAt.
          sentAt: sql`now()`,
          outageKey: claim.outageKey,
          alertOrdinal: claim.ordinal,
          claimAttempts: 1,
        })),
      )
      .onConflictDoUpdate({
        target: [
          schema.alertHistory.monitorId,
          schema.alertHistory.outageKey,
          schema.alertHistory.type,
          schema.alertHistory.alertOrdinal,
          schema.alertHistory.provider,
        ],
        targetWhere: sql`${schema.alertHistory.outageKey} IS NOT NULL AND ${schema.alertHistory.alertOrdinal} IS NOT NULL`,
        set: {
          status: 'pending',
          sentAt: sql`now()`,
          claimAttempts: sql`coalesce(${schema.alertHistory.claimAttempts}, 0) + 1`,
          message,
          errorMessage: null,
          deliveryMetadata: null,
        },
        setWhere: sql`(${schema.alertHistory.status} = 'failed' AND coalesce(${schema.alertHistory.claimAttempts}, 0) < ${MAX_CLAIM_ATTEMPTS}) OR (${schema.alertHistory.status} = 'pending' AND ${schema.alertHistory.sentAt} < now() - make_interval(secs => ${STALE_PENDING_CLAIM_SECONDS}))`,
      })
      .returning({
        id: schema.alertHistory.id,
        provider: schema.alertHistory.provider,
        attempts: schema.alertHistory.claimAttempts,
      });
    const claimed = new Map(
      taken.map((row) => [
        row.provider,
        { id: row.id, attempts: row.attempts ?? 1 },
      ]),
    );
    const others = providerIds.filter((provider) => !claimed.has(provider));
    let alreadySent = 0;
    let inFlight = 0;
    if (others.length > 0) {
      try {
        const existing = await db
          .select({ status: schema.alertHistory.status })
          .from(schema.alertHistory)
          .where(
            and(
              eq(schema.alertHistory.monitorId, monitorId),
              eq(schema.alertHistory.outageKey, claim.outageKey),
              eq(schema.alertHistory.type, type),
              eq(schema.alertHistory.alertOrdinal, claim.ordinal),
              inArray(schema.alertHistory.provider, others),
            ),
          );
        // 'failed' here has used up its attempts: given up, neither sent nor pending.
        alreadySent = existing.filter((row) => row.status === 'sent').length;
        inFlight = existing.filter((row) => row.status === 'pending').length;
      } catch (error) {
        // The rows above are already claimed, so this must not discard them (they would sit 'pending' and
        // the alert would go out unreserved). The others' state is unknown: treat them as held by someone.
        this.logger.error(
          `Failed to read the other claims of monitor ${monitorId}: ${getErrorMessage(error)}`,
        );
        inFlight = others.length;
      }
    }
    return { claimed, alreadySent, inFlight };
  }

  /**
   * Sends one alert and records it in alert_history. With a `claim`, only the providers this call claimed are
   * sent to (see claimProviders) and their reserved rows are finished; without one (an outage with no key,
   * SSL warnings) rows are inserted after sending, as before. `delivered` means no provider is still owed the
   * alert: every one has it (now or earlier) or has used up its attempts. A provider that failed while another
   * succeeded therefore keeps the alert due, and the next evaluation sends to that provider alone.
   */
  private async deliver(input: {
    monitorId: string;
    monitorName: string;
    historyType: AlertType;
    payload: NotificationPayload;
    providers: NotificationProvider[];
    sentAt: Date;
    claim?: AlertClaim;
    logTag: string;
  }): Promise<{
    delivered: boolean;
    /** Another evaluator holds a claim for this alert and has not finished it. */
    inFlight?: boolean;
    /** Nothing sent: every provider already had this alert. */
    alreadySent?: boolean;
    /** Every provider used up its attempts without the alert reaching any: it will never be sent. */
    gaveUp?: boolean;
    suppressed?: undefined;
    reason?: undefined;
  }> {
    const { monitorId, historyType, payload, logTag } = input;
    const db = this.dbService.db;
    let sendTo = input.providers;
    let claimed = new Map<string, { id: string; attempts: number }>();
    let alreadySent = 0;
    let inFlight = 0;
    if (input.claim) {
      await this.flushUnrecordedOutcomes();
      try {
        ({ claimed, alreadySent, inFlight } = await this.claimProviders({
          monitorId,
          monitorName: input.monitorName,
          type: historyType,
          claim: input.claim,
          providerIds: input.providers.map((provider) => provider.id),
          message: payload.message,
        }));
        sendTo = input.providers.filter((provider) => claimed.has(provider.id));
      } catch (error) {
        // Better a possible duplicate than a missed alert: send unreserved, as job alerts do.
        this.logger.error(
          `${logTag} Failed to claim ${historyType} for monitor ${monitorId}; sending unreserved: ${getErrorMessage(error)}`,
        );
        claimed = new Map();
      }
      if (claimed.size === 0 && sendTo.length === 0) {
        this.logger.debug(
          `${logTag} ${historyType} for monitor ${monitorId} not sent: ${inFlight > 0 ? 'another evaluator holds the claim' : 'already delivered or out of attempts'}`,
        );
        return inFlight > 0
          ? { delivered: false, inFlight: true }
          : alreadySent > 0
            ? { delivered: true, alreadySent: true }
            : { delivered: false, gaveUp: true };
      }
    }

    this.logger.log(
      `${logTag} Sending ${payload.type} notifications to ${sendTo.length} providers`,
    );

    // A provider that reached some recipients (partial email) counts as delivered: a retry would resend to them.
    const isDelivered = (result: { success: boolean; partial?: boolean }) =>
      result.success || Boolean(result.partial);
    const created: AlertHistoryTriageCandidate[] = [];
    // Delivered alerts whose row could not be updated: they stay 'pending' in the database.
    const unrecorded: Array<{ id: string; status: AlertStatus }> = [];
    const finished = new Set<string>();
    let stillOwed = 0;
    // Each provider's row is finished as soon as its own send settles, so a slow provider never leaves a
    // delivered one 'pending' long enough to be taken over (and sent again) as abandoned.
    const finishRow = async (result: ProviderDeliveryResult) => {
      const row = claimed.get(result.provider.id);
      if (!row || finished.has(result.provider.id)) return;
      finished.add(result.provider.id);
      const status: AlertStatus = isDelivered(result) ? 'sent' : 'failed';
      if (status === 'failed' && row.attempts < MAX_CLAIM_ATTEMPTS) stillOwed++;
      const values = {
        status,
        errorMessage: redactAlertText(result.error) ?? null,
        deliveryMetadata: result.deliveryMetadata ?? null,
        sentAt: input.sentAt,
      };
      try {
        await this.finishClaimedRow(row.id, values);
        created.push({ id: row.id, status });
      } catch (error) {
        unrecorded.push({ id: row.id, status });
        this.rememberUnrecorded(row.id, values);
        this.logger.error(
          `${logTag} Failed to record ${historyType} outcome for monitor ${monitorId}: ${getErrorMessage(error)}`,
        );
      }
    };

    const deliveryResults =
      await this.notificationService.sendNotificationToMultipleProviders(
        sendTo,
        payload,
        claimed.size > 0 ? finishRow : undefined,
      );
    this.logger.log(
      `${logTag} Notification results: ${deliveryResults.success} success, ${deliveryResults.failed} failed`,
    );
    const anyDelivered = deliveryResults.results.some(isDelivered);

    // Delivery already happened: a bookkeeping failure must not be reported as a failed delivery.
    try {
      if (claimed.size > 0) {
        // Results the sender did not hand over one by one.
        for (const result of deliveryResults.results) await finishRow(result);
      } else if (deliveryResults.results.length > 0) {
        const rows = await db
          .insert(schema.alertHistory)
          .values(
            deliveryResults.results.map((result) => ({
              type: historyType,
              message: redactAlertText(payload.message) ?? '',
              target: input.monitorName,
              targetType: 'monitor',
              monitorId,
              provider: result.provider.id,
              status: isDelivered(result)
                ? ('sent' as const)
                : ('failed' as const),
              errorMessage: redactAlertText(result.error),
              deliveryMetadata: result.deliveryMetadata,
              sentAt: input.sentAt,
            })),
          )
          .returning({
            id: schema.alertHistory.id,
            status: schema.alertHistory.status,
          });
        created.push(...rows);
      }
      // Renewal notices are informational: they never open or resolve an incident.
      if (historyType !== 'ssl_renewed') {
        await this.sreAlertTriageQueueService.enqueueAlertHistoryRows(created);
        // The rows above are still 'pending' for the app, which skips them: open the incident from the
        // delivery we know happened. (A recovery resolves its incident through signalRecovery instead.)
        if (
          historyType === 'monitor_failure' &&
          unrecorded.some((row) => row.status === 'sent')
        ) {
          await this.sreAlertTriageQueueService.enqueueSourceFailure({
            sourceType: 'monitor',
            sourceId: monitorId,
            type: 'monitor_failure',
            message: (redactAlertText(payload.message) ?? '').slice(0, 2000),
            firedAt: input.sentAt.toISOString(),
          });
        }
      }
    } catch (error) {
      this.logger.error(
        `${logTag} Failed to record alert history for monitor ${monitorId}: ${getErrorMessage(error)}`,
      );
    }

    if (claimed.size === 0) return { delivered: anyDelivered };
    // A provider another evaluator is still sending to: it finishes (or its claim goes stale) on its own.
    if (inFlight > 0) return { delivered: false, inFlight: true };
    const delivered = stillOwed === 0 && (anyDelivered || alreadySent > 0);
    return {
      delivered,
      ...(stillOwed === 0 && !delivered ? { gaveUp: true } : {}),
    };
  }

  /** Outcomes this process could not write: retried before the next claim, while the row is still not stale. */
  private readonly unrecordedOutcomes = new Map<string, ClaimOutcome>();

  private rememberUnrecorded(id: string, values: ClaimOutcome) {
    // Bounded: oldest entries go first.
    if (this.unrecordedOutcomes.size >= 200) {
      for (const oldest of this.unrecordedOutcomes.keys()) {
        this.unrecordedOutcomes.delete(oldest);
        break;
      }
    }
    this.unrecordedOutcomes.set(id, values);
  }

  private async flushUnrecordedOutcomes(): Promise<void> {
    for (const [id, values] of [...this.unrecordedOutcomes]) {
      try {
        await this.dbService.db
          .update(schema.alertHistory)
          .set(values)
          .where(eq(schema.alertHistory.id, id));
        this.unrecordedOutcomes.delete(id);
      } catch {
        return; // still down: the next claim tries again
      }
    }
  }

  private async finishClaimedRow(
    id: string,
    values: ClaimOutcome,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.dbService.db
          .update(schema.alertHistory)
          .set(values)
          .where(eq(schema.alertHistory.id, id));
        return;
      } catch (error) {
        if (attempt >= HISTORY_FINISH_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
  }

  async sendNotification(
    monitorId: string,
    type: 'recovery' | 'failure',
    reason: string,
    metadata: Record<string, unknown> = {},
    /** Identifies this alert of its outage, so concurrent or retried evaluations send it once per provider. */
    claim?: AlertClaim,
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
    // Being deleted: no notifications for a monitor the user already removed.
    if (monitor.deletingAt) return { delivered: false, suppressed: true };

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

    // One per failure: per-channel rows share it, and a failure keeps the cycle's observation time.
    const sentAt = type === 'failure' && observedAt ? observedAt : new Date();
    const result = await this.deliver({
      monitorId: monitor.id,
      monitorName: monitor.name,
      historyType: notificationType,
      payload: notificationPayload,
      providers: decryptedProviders,
      sentAt,
      claim,
      logTag: '[NOTIFY]',
    });
    // Another evaluator is sending it: not a failure to retry from here, and not delivered by this call.
    if (result.inFlight)
      return {
        delivered: false,
        suppressed: true,
        reason: 'claimed' as const,
      };
    return result;
  }

  /** Warns that the certificate is expiring, expired, or unreadable. Throttled to one per day. */
  async sendSslExpirationNotification(
    monitorId: string,
    reason: string,
    metadata: Record<string, unknown> = {},
  ): Promise<boolean> {
    const deliveredAt = this.sslAlertDeliveredAt.get(monitorId);
    if (deliveredAt && Date.now() - deliveredAt < SSL_ALERT_THROTTLE_MS) {
      return false;
    }
    const { delivered } = await this.sendSslNotice(
      'ssl_expiring',
      monitorId,
      reason,
      metadata,
    );
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

  /**
   * Tells the user a certificate they were warned about is fine again. `claim.outageKey` is the id of the
   * warning episode, so the notice goes out once per episode however many regions or retries see the renewal.
   */
  sendSslRenewedNotification(
    monitorId: string,
    reason: string,
    metadata: Record<string, unknown>,
    claim: AlertClaim,
  ): Promise<{ delivered: boolean; gaveUp?: boolean }> {
    return this.sendSslNotice(
      'ssl_renewed',
      monitorId,
      reason,
      metadata,
      claim,
    );
  }

  private async sendSslNotice(
    type: 'ssl_expiring' | 'ssl_renewed',
    monitorId: string,
    reason: string,
    metadata: Record<string, unknown>,
    claim?: AlertClaim,
  ): Promise<{ delivered: boolean; gaveUp?: boolean }> {
    this.logger.log(
      `[SSL-NOTIFY] ${type} notification for monitor ${monitorId}`,
    );

    const db = this.dbService.db;

    // Get monitor details
    const monitor = await db.query.monitors.findFirst({
      where: and(eq(schema.monitors.id, monitorId), liveMonitor()),
    });

    if (!monitor) {
      this.logger.error(`[SSL-NOTIFY] Monitor not found: ${monitorId}`);
      return { delivered: false };
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
      return { delivered: false };
    }

    // Same rule as status alerts. Nothing is recorded as sent, so the next check after the window alerts again.
    if (await this.isUnderScheduledMaintenance(monitorId)) {
      this.logger.log(
        `[SSL-NOTIFY] Suppressing monitor ${monitorId} SSL notice during scheduled maintenance`,
      );
      return { delivered: false };
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
      return { delivered: false };
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
    const renewed = type === 'ssl_renewed';

    const notificationPayload: NotificationPayload = {
      type,
      title: renewed
        ? metadata.readableAgain === true
          ? `SSL Certificate Readable Again - ${monitor.name}`
          : `SSL Certificate Renewed - ${monitor.name}`
        : `SSL Certificate Warning - ${monitor.name}`,
      // The custom message describes a failure: a renewed or readable-again notice always states what happened.
      message: renewed
        ? reason
        : monitor.alertConfig.customMessage ||
          `SSL certificate issue detected: ${reason}`,
      targetName: monitor.name,
      targetId: monitor.id,
      severity: renewed ? 'success' : 'warning',
      timestamp: sslObservedAt,
      projectId: monitor.projectId || undefined,
      projectName: projectName,
      metadata: {
        target: monitor.target,
        type: monitor.type,
        status: renewed ? 'ssl_renewed' : 'ssl_warning',
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

    const result = await this.deliver({
      monitorId: monitor.id,
      monitorName: monitor.name,
      historyType: type,
      payload: notificationPayload,
      providers: decryptedProviders,
      sentAt: new Date(), // one per alert: per-channel rows must share it
      claim,
      logTag: '[SSL-NOTIFY]',
    });
    return { delivered: result.delivered, gaveUp: result.gaveUp };
  }
}
