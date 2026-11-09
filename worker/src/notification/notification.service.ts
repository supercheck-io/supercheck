import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  closeSmtpTransport,
  sendMailToRecipients,
  type SmtpDeliveryResult,
} from '../common/utils/smtp-transport';
import {
  AlertDeliveryMetadata,
  AlertType,
  AlertStatus,
  NotificationProviderType,
  PlainNotificationProviderConfig,
} from '../db/schema';
import {
  EmailTemplateService,
  formatDuration,
} from '../email-template/email-template.service';
import { fetchWithRetry, createRetryConfig } from '../common/utils/retry.util';
import {
  isValidTeamsWebhookDomain,
  getTeamsWebhookDomainError,
} from './notification.constants';
import {
  allowInternalWebhookTargets,
  isUrlSafeForOutbound,
} from '../common/utils/url-validator';
import { fetchPublicEndpoint } from '../common/utils/pinned-public-fetch';
import { isUndeliverableRecipient } from '../common/utils/email-recipient-policy';
import {
  redactTargetUrl,
  redactUrlsInText,
} from '../common/validation/data-sanitizer';

// Utility function to safely get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Utility function to safely get error stack
function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

export interface NotificationProvider {
  id: string;
  type: NotificationProviderType;
  config: PlainNotificationProviderConfig;
}

// Specific provider configuration interfaces for better type safety
interface EmailConfig {
  emails?: string;
  to?: string;
}

interface SlackConfig {
  webhookUrl?: string;
}

interface TelegramConfig {
  botToken?: string;
  chatId?: string;
}

interface DiscordConfig {
  discordWebhookUrl?: string;
}

interface TeamsConfig {
  teamsWebhookUrl?: string;
}

interface WebhookConfig {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}

/** Notifications about a monitor: its status alerts and its SSL notices. */
function isMonitorNotificationType(type: AlertType): boolean {
  return (
    type.includes('monitor') ||
    type === 'ssl_expiring' ||
    type === 'ssl_renewed'
  );
}

export interface ProviderDeliveryResult {
  provider: NotificationProvider;
  success: boolean;
  partial?: boolean;
  error?: string;
  deliveryMetadata?: AlertDeliveryMetadata;
}

export interface NotificationPayload {
  type: AlertType;
  title: string;
  message: string;
  targetName: string;
  targetId: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  timestamp: Date;
  projectId?: string;
  projectName?: string;
  metadata?: {
    responseTime?: number;
    status?: string;
    target?: string;
    type?: string;
    sslCertificate?: any;
    errorMessage?: string;
    dashboardUrl?: string;
    targetUrl?: string;
    timestamp?: string;
    monitorType?: string;
    checkFrequency?: string;
    lastCheckTime?: string;
    duration?: number;
    details?: any;
    totalTests?: number;
    passedTests?: number;
    failedTests?: number;
    skippedTests?: number;
    runId?: string;
    trigger?: string;
    [key: string]: any; // Allow any additional properties
  };
}

interface FormattedNotification {
  title: string;
  message: string;
  fields: Array<{
    title: string;
    value: string;
    short?: boolean;
    /** URL values: shown as-is, never markdown-escaped. */
    raw?: boolean;
  }>;
  color: string;
  footer: string;
  timestamp: number;
}

const DISCORD_HOSTS = [
  'discord.com',
  'discordapp.com',
  'canary.discord.com',
  'ptb.discord.com',
];

// Send-time re-check of the per-provider host allowlist enforced when saving.
function assertAllowedHost(url: string, hosts: string[], label: string): void {
  if (!hosts.includes(new URL(url).hostname.toLowerCase())) {
    throw new Error(`${label} webhook URL host is not allowed`);
  }
}

interface NotificationSendResult {
  success: boolean;
  /** Some, not all, recipients were reached (email). */
  partial?: boolean;
  error?: string;
  deliveryMetadata?: AlertDeliveryMetadata;
}

type ProviderDeliveryDetails = {
  attempts?: number;
  responseStatus?: number;
  responseBody?: string;
  dedupKey?: string;
  eventAction?: string;
  externalIncidentKey?: string;
  externalUrl?: string;
};

const WEBHOOK_TEMPLATE_PATTERN = /\{\{(\w+)\}\}/g;
const WEBHOOK_ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT']);
const WEBHOOK_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const WEBHOOK_MAX_HEADERS = 20;
const WEBHOOK_MAX_HEADER_VALUE_LENGTH = 1000;
const WEBHOOK_BLOCKED_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
]);

/** Teams and Discord render markdown, so user text must not become links or formatting. */
function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_~|<>[\]()]/g, '\\$&');
}

/** Discord descriptions also render line-leading # as headings. */
function escapeDiscordDescription(value: string): string {
  return escapeMarkdown(value).replace(/^(#+)/gm, '\\$1');
}

/** Slack mrkdwn treats & < > as control characters (<!channel>, <url|text>). */
function escapeSlack(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** When the problem was observed, if the payload carries it; otherwise the payload time. */
function observedTime(payload: NotificationPayload): Date {
  const raw: unknown = payload.metadata?.observedAt;
  const d =
    typeof raw === 'string' || typeof raw === 'number'
      ? new Date(raw)
      : undefined;
  return d && !Number.isNaN(d.getTime()) ? d : payload.timestamp;
}

const EMAIL_ERROR_MAX = 1000;

const sentenceCase = (v: string) =>
  v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();

/**
 * Email detail rows for monitor and job alerts alike: the shared formatted
 * fields (emoji link labels and SHOUTING status normalised), then duration,
 * run id and a clipped error, then the links.
 */
export function buildEmailFields(
  fields: FormattedNotification['fields'],
  payload: NotificationPayload,
): Array<{ title: string; value: string }> {
  const rows = fields.map((f) => ({
    title: f.title.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, ''),
    value: f.title === 'Status' ? sentenceCase(f.value) : f.value,
    raw: f.raw,
  }));
  const extras: Array<{ title: string; value: string }> = [];
  const md = payload.metadata;
  if (typeof md?.duration === 'number') {
    extras.push({ title: 'Duration', value: formatDuration(md.duration) });
  }
  if (md?.runId) extras.push({ title: 'Run ID', value: md.runId });
  if (md?.errorMessage) {
    extras.push({
      title: 'Error',
      value: clip(String(md.errorMessage), EMAIL_ERROR_MAX),
    });
  }
  const strip = ({ title, value }: { title: string; value: string }) => ({
    title,
    value,
  });
  return [
    ...rows.filter((r) => !r.raw).map(strip),
    ...extras,
    ...rows.filter((r) => r.raw).map(strip),
  ];
}

@Injectable()
export class NotificationService implements OnApplicationShutdown {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly emailTemplateService: EmailTemplateService) {
    this.logger.log('NotificationService initialized');
  }

  async sendNotification(
    provider: NotificationProvider,
    payload: NotificationPayload,
  ): Promise<boolean> {
    const result = await this.sendNotificationDetailed(provider, payload);
    return result.success;
  }

  private async sendNotificationDetailed(
    provider: NotificationProvider,
    payload: NotificationPayload,
  ): Promise<NotificationSendResult> {
    this.logger.log(
      `Sending notification via ${provider.type} for ${payload.type}: ${payload.title}`,
    );

    let result: NotificationSendResult = { success: false };

    try {
      // Validate provider configuration
      if (!this.validateProviderConfig(provider)) {
        const error = `Invalid configuration for provider ${provider.id} (${provider.type})`;
        this.logger.error(error);
        return this.withDeliveryMetadata(provider, payload, {
          success: false,
          error,
        });
      }

      // Enhanced payload with standardized formatting
      const enhancedPayload = this.enhancePayload(payload);
      const formattedNotification = this.formatNotification(enhancedPayload);

      // Send the actual notification
      switch (provider.type) {
        case 'email':
          result = this.withDeliveryMetadata(
            provider,
            enhancedPayload,
            await this.sendEmailNotification(
              provider.config,
              formattedNotification,
              enhancedPayload,
            ),
          );
          break;
        case 'slack':
          result = this.withDeliveryMetadata(
            provider,
            enhancedPayload,
            await this.sendSlackNotification(
              provider.config,
              formattedNotification,
            ),
          );
          break;
        case 'webhook':
          result = await this.sendWebhookNotification(
            provider,
            provider.config,
            formattedNotification,
            enhancedPayload,
          );
          break;
        case 'telegram':
          result = this.withDeliveryMetadata(
            provider,
            enhancedPayload,
            await this.sendTelegramNotification(
              provider.config,
              formattedNotification,
            ),
          );
          break;
        case 'discord':
          result = this.withDeliveryMetadata(
            provider,
            enhancedPayload,
            await this.sendDiscordNotification(
              provider.config,
              formattedNotification,
            ),
          );
          break;
        case 'teams':
          result = this.withDeliveryMetadata(
            provider,
            enhancedPayload,
            await this.sendTeamsNotification(
              provider.config,
              formattedNotification,
            ),
          );
          break;
        default: {
          const _exhaustiveCheck: never = provider.type;
          const error = `Unsupported notification provider type: ${String(provider.type)}`;
          this.logger.error(error);
          result = { success: false, error };
          // Use exhaustive check to ensure all cases are handled
          return _exhaustiveCheck;
        }
      }

      if (result.success) {
        this.logger.log(
          `Successfully sent notification via ${provider.type} for ${payload.type}`,
        );
      } else {
        const errorSuffix = result.error ? `: ${result.error}` : '';
        this.logger.error(
          `Failed to send notification via ${provider.type} for ${payload.type}${errorSuffix}`,
        );
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(
        `Failed to send notification via ${provider.type}:`,
        error,
      );
      result = this.withDeliveryMetadata(provider, payload, {
        success: false,
        error: errorMessage,
      });
    }

    return result.success
      ? result
      : {
          success: false,
          partial: result.partial,
          error: result.error ?? 'Notification send returned false',
          deliveryMetadata: result.deliveryMetadata,
        };
  }

  private withDeliveryMetadata(
    provider: NotificationProvider,
    payload: NotificationPayload,
    result: Omit<NotificationSendResult, 'deliveryMetadata'>,
    details: ProviderDeliveryDetails = {},
  ): NotificationSendResult {
    const providerPreset =
      typeof provider.config.preset === 'string'
        ? provider.config.preset
        : undefined;
    const targetType = this.getAlertTargetType(payload);
    const deliveryStatus: AlertStatus =
      result.success || result.partial ? 'sent' : 'failed';
    const responseHash =
      details.responseBody !== undefined
        ? this.sha256(details.responseBody)
        : undefined;
    const errorHash = result.error ? this.sha256(result.error) : undefined;

    return {
      ...result,
      deliveryMetadata: {
        version: 1,
        provider: {
          id: provider.id,
          type: provider.type,
          preset: providerPreset,
        },
        source: {
          alertType: payload.type,
          targetType,
          targetId: payload.targetId,
          projectId: payload.projectId,
          monitorId: targetType === 'monitor' ? payload.targetId : undefined,
          jobId: targetType === 'job' ? payload.targetId : undefined,
          runId:
            typeof payload.metadata?.runId === 'string'
              ? payload.metadata.runId
              : undefined,
        },
        correlation: this.compactObject({
          dedupKey: details.dedupKey,
          eventAction: details.eventAction,
          externalIncidentKey: details.externalIncidentKey,
          externalUrl: details.externalUrl,
        }),
        delivery: this.compactObject({
          status: deliveryStatus,
          sentAt: new Date().toISOString(),
          attempts: details.attempts,
          responseStatus: details.responseStatus,
          responseHash,
          errorHash,
        }) as AlertDeliveryMetadata['delivery'],
      },
    };
  }

  private compactObject<T extends Record<string, unknown>>(
    value: T,
  ): T | undefined {
    const compacted = Object.fromEntries(
      Object.entries(value).filter(
        ([, entryValue]) => entryValue !== undefined,
      ),
    ) as T;

    return Object.keys(compacted).length > 0 ? compacted : undefined;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private getAlertTargetType(payload: NotificationPayload): 'monitor' | 'job' {
    return payload.type === 'job_failed' ||
      payload.type === 'job_success' ||
      payload.type === 'job_timeout'
      ? 'job'
      : 'monitor';
  }

  private enhancePayload(payload: NotificationPayload): NotificationPayload {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      'http://localhost:3000';

    // Debug logging for URL issues
    if (!process.env.NEXT_PUBLIC_APP_URL && !process.env.APP_URL) {
      this.logger.warn(
        `[NOTIFICATION] No APP_URL configured, using fallback: ${baseUrl}`,
      );
      this.logger.debug(
        `[NOTIFICATION] Environment variables: NEXT_PUBLIC_APP_URL=${process.env.NEXT_PUBLIC_APP_URL}, APP_URL=${process.env.APP_URL}`,
      );
    }

    // Generate dashboard URLs for easy navigation - use notification pages for clean view
    let dashboardUrl: string;
    if (isMonitorNotificationType(payload.type)) {
      dashboardUrl = `${baseUrl}/notification-monitor/${payload.targetId}`;
    } else if (payload.type.includes('job')) {
      dashboardUrl = `${baseUrl}/jobs`;
      if (payload.metadata?.runId) {
        dashboardUrl = `${baseUrl}/notification-run/${payload.metadata.runId}`;
      }
    } else {
      dashboardUrl = `${baseUrl}/incidents?tab=alerts`;
    }

    // Every channel (and the webhook's originalPayload) reads the target from here.
    const target = payload.metadata?.target;
    const targetUrl =
      target === undefined ? undefined : redactTargetUrl(target);

    return {
      ...payload,
      message: redactUrlsInText(payload.message),
      metadata: {
        ...payload.metadata,
        ...(target === undefined ? {} : { target: targetUrl }),
        ...(payload.metadata?.errorMessage
          ? {
              errorMessage: clip(
                redactUrlsInText(String(payload.metadata.errorMessage)),
                EMAIL_ERROR_MAX,
              ),
            }
          : {}),
        dashboardUrl,
        targetUrl,
        timestamp: payload.timestamp.toISOString(),
      },
    };
  }

  private formatNotification(
    payload: NotificationPayload,
  ): FormattedNotification {
    // Standardized formatting with professional appearance - no emojis for consistency
    const isMonitor = isMonitorNotificationType(payload.type);
    // const __isJob = payload.type.includes('job');

    // Consistent title format without emojis for professional appearance
    const title = payload.title;

    // Enhanced message with context
    let enhancedMessage = payload.message;
    if (payload.metadata?.errorMessage) {
      enhancedMessage += `\n\nError Details: ${clip(String(payload.metadata.errorMessage), EMAIL_ERROR_MAX)}`;
    }

    // Build standardized fields
    const fields: FormattedNotification['fields'] = [];

    // Project info
    if (payload.projectName) {
      fields.push({
        title: 'Project',
        value: payload.projectName,
        short: true,
      });
    }

    // Basic info
    fields.push({
      title: isMonitor ? 'Monitor' : 'Job',
      value: payload.targetName,
      short: true,
    });

    if (payload.metadata?.type) {
      fields.push({
        title: 'Type',
        value: payload.metadata.type
          .replace('_', ' ')
          .replace(/\b\w/g, (l: string) => l.toUpperCase()),
        short: true,
      });
    }

    // Status info
    if (payload.metadata?.status) {
      fields.push({
        title: 'Status',
        value: payload.metadata.status.toUpperCase(),
        short: true,
      });
    }

    // Time
    fields.push({
      title: 'Time',
      value: observedTime(payload).toUTCString(),
      short: true,
    });

    // Response Time
    if (payload.metadata?.responseTime !== undefined) {
      const responseTimeSeconds = (
        payload.metadata.responseTime / 1000
      ).toFixed(2);
      fields.push({
        title: 'Response Time',
        value: `${responseTimeSeconds}s`,
        short: true,
      });
    }

    // Target URL
    if (payload.metadata?.targetUrl) {
      fields.push({
        title: 'Target URL',
        value: payload.metadata.targetUrl,
        short: false,
        raw: true,
      });
    }

    // Dashboard link
    if (payload.metadata?.dashboardUrl) {
      // Determine the appropriate label based on the payload type
      const dashboardLabel = isMonitorNotificationType(payload.type)
        ? '🔗 Monitor Details'
        : payload.type.includes('job')
          ? '🔗 Job Details'
          : '🔗 Dashboard';

      fields.push({
        title: dashboardLabel,
        value: payload.metadata.dashboardUrl,
        short: false,
        raw: true,
      });
    }

    // Removed: Trigger field - not required in notifications

    return {
      title,
      message: enhancedMessage,
      fields,
      color: this.getColorForSeverity(payload.severity),
      footer: '',
      timestamp: Math.floor(payload.timestamp.getTime() / 1000),
    };
  }

  private validateProviderConfig(provider: NotificationProvider): boolean {
    try {
      switch (provider.type) {
        case 'email': {
          const emailConfig = provider.config as EmailConfig;
          // Check if emails field exists and has valid email addresses
          if (emailConfig.emails) {
            const emails = String(emailConfig.emails).trim();
            if (!emails) return false;

            const emailList = emails.split(',').map((email) => email.trim());
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return emailList.every((email) => emailRegex.test(email));
          }
          return false;
        }
        case 'slack': {
          const slackConfig = provider.config as SlackConfig;
          if (!slackConfig.webhookUrl) return false;
          // SSRF defense-in-depth: re-validate URL at send-time
          const slackCheck = isUrlSafeForOutbound(slackConfig.webhookUrl);
          if (!slackCheck.safe) {
            this.logger.warn(
              `Blocked unsafe Slack webhook URL for provider ${provider.id}: ${slackCheck.reason}`,
            );
            return false;
          }
          return true;
        }
        case 'webhook': {
          const webhookConfig = provider.config as WebhookConfig;
          if (!webhookConfig.url) return false;
          // SSRF defense-in-depth: re-validate URL at send-time
          const webhookCheck = isUrlSafeForOutbound(webhookConfig.url, {
            allowInternal: allowInternalWebhookTargets(),
          });
          if (!webhookCheck.safe) {
            this.logger.warn(
              `Blocked unsafe webhook URL for provider ${provider.id}: ${webhookCheck.reason}`,
            );
            return false;
          }
          this.normalizeWebhookHeaders(webhookConfig.headers);
          return true;
        }
        case 'telegram': {
          const telegramConfig = provider.config as TelegramConfig;
          return !!(telegramConfig.botToken && telegramConfig.chatId);
        }
        case 'discord': {
          const discordConfig = provider.config as DiscordConfig;
          if (!discordConfig.discordWebhookUrl) return false;
          // SSRF defense-in-depth: re-validate URL at send-time
          const discordCheck = isUrlSafeForOutbound(
            discordConfig.discordWebhookUrl,
          );
          if (!discordCheck.safe) {
            this.logger.warn(
              `Blocked unsafe Discord webhook URL for provider ${provider.id}: ${discordCheck.reason}`,
            );
            return false;
          }
          return true;
        }
        case 'teams': {
          const teamsConfig = provider.config as TeamsConfig;
          if (!teamsConfig.teamsWebhookUrl) return false;
          // SSRF defense-in-depth: re-validate URL at send-time
          const teamsCheck = isUrlSafeForOutbound(teamsConfig.teamsWebhookUrl);
          if (!teamsCheck.safe) {
            this.logger.warn(
              `Blocked unsafe Teams webhook URL for provider ${provider.id}: ${teamsCheck.reason}`,
            );
            return false;
          }
          return true;
        }
        default:
          return false;
      }
    } catch (error) {
      this.logger.error(
        `Error validating provider config: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async sendNotificationToMultipleProviders(
    providers: NotificationProvider[],
    payload: NotificationPayload,
    /**
     * Called as each provider's own send settles, before the slower ones finish, so a caller can record a
     * delivery without waiting for the others. A throwing callback is logged and does not affect delivery.
     */
    onSettled?: (entry: ProviderDeliveryResult) => Promise<void>,
  ): Promise<{
    success: number;
    failed: number;
    results: ProviderDeliveryResult[];
  }> {
    if (!providers || providers.length === 0) {
      this.logger.warn('No providers to send notifications to');
      return { success: 0, failed: 0, results: [] };
    }

    this.logger.log(`Sending notifications to ${providers.length} providers`);

    const detailedResults = await Promise.all(
      providers.map(async (provider): Promise<ProviderDeliveryResult> => {
        let entry: ProviderDeliveryResult;
        try {
          const value = await this.sendNotificationDetailed(provider, payload);
          const success = value.success;
          entry = {
            provider,
            success,
            partial: value.partial,
            error: success
              ? undefined
              : (value.error ?? 'Notification send returned false'),
            deliveryMetadata: value.deliveryMetadata,
          };
        } catch (reason) {
          entry = {
            provider,
            success: false,
            error: getErrorMessage(reason),
            deliveryMetadata: this.withDeliveryMetadata(provider, payload, {
              success: false,
              error: getErrorMessage(reason),
            }).deliveryMetadata,
          };
        }
        if (onSettled) {
          try {
            await onSettled(entry);
          } catch (error) {
            this.logger.error(
              `Delivery callback failed for provider ${provider.id}: ${getErrorMessage(error)}`,
            );
          }
        }
        return entry;
      }),
    );

    const success = detailedResults.filter((entry) => entry.success).length;
    const failed = detailedResults.length - success;

    this.logger.log(`Notification sent: ${success} success, ${failed} failed`);

    // Log detailed results for debugging
    detailedResults.forEach((entry) => {
      if (entry.success) {
        this.logger.debug(
          `Provider ${entry.provider.id} (${entry.provider.type}): Success`,
        );
        return;
      }

      const errorMessage = entry.error
        ? ` - ${entry.error}`
        : ' - delivery failed';
      this.logger.warn(
        `Provider ${entry.provider.id} (${entry.provider.type}): Failed${errorMessage}`,
      );
    });

    return { success, failed, results: detailedResults };
  }

  private async sendEmailNotification(
    config: any,
    formatted: FormattedNotification,
    payload: NotificationPayload,
  ): Promise<NotificationSendResult> {
    try {
      // Parse email addresses from config
      const parsedAddresses = this.parseEmailAddresses(
        config as Record<string, unknown>,
      );
      if (parsedAddresses.length === 0) {
        throw new Error('No valid email addresses found');
      }
      // Reserved/blocked domains only bounce; skip them so they never reach SMTP or the retry path.
      const emailAddresses = parsedAddresses.filter(
        (email) => !isUndeliverableRecipient(email),
      );
      if (emailAddresses.length === 0) {
        this.logger.warn(
          `Skipped email for ${payload.type}: every recipient is on a domain that does not accept email`,
        );
        return {
          success: false,
          error:
            'No deliverable email recipients: every address is on a domain that does not accept email',
        };
      }

      // Render email using centralized template service (React Email templates)
      // Use appropriate template based on alert type
      // Same env the dashboard links use; omitted (no button) if unset rather than linking to localhost.
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;

      // Monitors and jobs share one path: the payload's title/message (including a
      // custom message) and the shared field builder.
      const rendered = await this.emailTemplateService.renderMonitorAlertEmail({
        title: formatted.title,
        message: payload.message,
        fields: buildEmailFields(formatted.fields, payload),
        footer: formatted.footer,
        type: this.emailAlertType(payload),
        appUrl,
      });

      const emailContent = {
        html: rendered.html,
        text: rendered.text,
        subject: rendered.subject,
      };
      this.logger.debug(
        `Email template rendered successfully for ${payload.type}`,
      );

      // Send via SMTP
      const smtpResult = await this.trySMTPDelivery(
        config,
        formatted,
        emailContent,
        emailAddresses,
      );
      if (smtpResult.failedRecipients.length === 0) {
        this.logger.log(
          `Email notification sent successfully via SMTP to ${smtpResult.sentCount} recipient(s)`,
        );
        return { success: true };
      }

      if (smtpResult.sentCount === 0) {
        const firstError =
          smtpResult.errors[emailAddresses[0]] ?? 'SMTP delivery failed';
        return {
          success: false,
          error: `SMTP delivery failed for all ${emailAddresses.length} recipient(s): ${firstError}`,
        };
      }

      return {
        success: false,
        partial: true,
        error: `SMTP delivery reached ${smtpResult.sentCount}/${emailAddresses.length} recipient(s); failed for: ${smtpResult.failedRecipients.join(', ')}`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to send email notification: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /** Email template tone: recovery and job outcomes are explicit, the rest follows severity. */
  private emailAlertType(
    payload: NotificationPayload,
  ): 'failure' | 'success' | 'recovery' | 'warning' | 'info' {
    switch (payload.type) {
      case 'monitor_recovery':
        return 'recovery';
      case 'ssl_renewed':
        return 'success';
      case 'job_success':
        return 'success';
      case 'job_failed':
        return 'failure';
      case 'job_timeout':
        return 'warning';
    }
    switch (payload.severity) {
      case 'error':
        return 'failure';
      case 'success':
        return 'success';
      case 'info':
        return 'info';
      default:
        return 'warning';
    }
  }

  private parseEmailAddresses(config: Record<string, unknown>): string[] {
    if (!config.emails || typeof config.emails !== 'string') {
      return [];
    }

    // Case-insensitive dedupe so one address is not mailed twice.
    const seen = new Set<string>();
    return config.emails
      .split(',')
      .map((email: string) => email.trim())
      .filter((email: string) => {
        const key = email.toLowerCase();
        if (!email || !this.isValidEmail(email) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private async trySMTPDelivery(
    _config: any,
    _formatted: FormattedNotification,
    emailContent: { html: string; text: string; subject: string },
    emailAddresses: string[],
  ): Promise<SmtpDeliveryResult> {
    const result = await sendMailToRecipients(
      emailAddresses,
      emailContent,
      (msg) => this.logger.warn(msg),
    );
    if (result.sentCount === 0) {
      this.logger.error(
        `SMTP delivery failed: ${Object.values(result.errors)[0] ?? 'unknown error'}`,
      );
    } else if (result.failedRecipients.length > 0) {
      this.logger.warn(
        `SMTP delivery: ${result.sentCount}/${emailAddresses.length} sent, failed for: ${result.failedRecipients.join(', ')}`,
      );
    }
    return result;
  }

  // After the shutdown drain: in-flight runs still send their completion notifications.
  onApplicationShutdown(): void {
    closeSmtpTransport();
  }

  private async sendSlackNotification(
    config: Record<string, unknown>,
    formatted: FormattedNotification,
    // ___payload: NotificationPayload,
  ): Promise<{ success: boolean; error?: string }> {
    const secrets: string[] = [];
    try {
      const webhookUrl = config.webhookUrl as string | undefined;
      if (!webhookUrl) {
        throw new Error('Slack webhook URL is required');
      }
      secrets.push(webhookUrl);
      assertAllowedHost(webhookUrl, ['hooks.slack.com'], 'Slack');

      this.logger.debug(
        `Sending Slack notification to: ${webhookUrl.substring(0, 50)}...`,
      );

      const retryConfig = createRetryConfig();

      const result = await fetchWithRetry(
        webhookUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Supercheck-Monitor/1.0',
          },
          body: JSON.stringify({
            text: escapeSlack(formatted.title),
            attachments: [
              {
                color: formatted.color,
                text: escapeSlack(formatted.message),
                fields: formatted.fields.map((f) => ({
                  ...f,
                  title: escapeSlack(f.title),
                  value: escapeSlack(f.value),
                })),
                footer: escapeSlack(formatted.footer),
                ts: formatted.timestamp,
              },
            ],
          }),
        },
        retryConfig,
        this.logger,
        fetchPublicEndpoint,
      );

      if (result.success) {
        this.logger.debug(
          `Slack notification sent successfully after ${result.attempts} attempt(s)`,
        );
        return { success: true };
      }

      this.logger.error(
        `Failed to send Slack notification after ${result.attempts} attempts: ${this.safeSendError('Slack', result.error, secrets)}`,
      );
      return {
        success: false,
        error: this.safeSendError('Slack', result.error, secrets),
      };
    } catch (error) {
      this.logger.error(
        `Failed to send Slack notification: ${this.safeSendError('Slack', getErrorMessage(error), secrets)}`,
      );
      return {
        success: false,
        error: this.safeSendError('Slack', getErrorMessage(error), secrets),
      };
    }
  }

  private async sendWebhookNotification(
    provider: NotificationProvider,
    config: Record<string, unknown>,
    formatted: FormattedNotification,
    payload: NotificationPayload,
  ): Promise<NotificationSendResult> {
    const deliveryDetails = this.getWebhookDeliveryDetails(config, payload);
    // Endpoint URL and custom header values (often auth tokens) must never reach delivery history.
    const secrets: string[] = [];

    try {
      const webhookUrl = config.url as string | undefined;
      if (!webhookUrl) {
        throw new Error('Webhook URL is required');
      }
      secrets.push(webhookUrl);

      const method = this.normalizeWebhookMethod(config.method);

      const customHeaders = this.normalizeWebhookHeaders(config.headers) ?? {};
      for (const v of Object.values(customHeaders)) {
        // Also the credential after an auth scheme ("Bearer x"): endpoints may echo only that.
        for (const part of [v, v.split(/\s+/).pop() ?? '']) {
          if (part.length >= 4) secrets.push(part);
        }
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Supercheck-Monitor/1.0',
        ...customHeaders,
      };

      const body = this.buildWebhookRequestBody(config, formatted, payload);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      // The timer stays armed through the body read, so a trickling response cannot stall delivery.
      let response: Awaited<ReturnType<typeof fetchPublicEndpoint>>;
      let responseText: string;
      try {
        response = await fetchPublicEndpoint(
          webhookUrl,
          {
            method,
            headers,
            body: method === 'GET' ? undefined : body,
            signal: controller.signal,
          },
          { allowInternal: allowInternalWebhookTargets() },
        );
        responseText = await response
          .text()
          .catch(() => 'Unable to read response');
      } finally {
        clearTimeout(timeoutId);
      }
      const responseDetails: ProviderDeliveryDetails = {
        ...deliveryDetails,
        attempts: 1,
        responseStatus: response.status,
        responseBody: responseText,
      };

      if (!response.ok) {
        return this.withDeliveryMetadata(
          provider,
          payload,
          {
            success: false,
            error: this.safeSendError(
              'Webhook',
              `Webhook returned ${response.status}: ${response.statusText}. Response: ${clip(responseText, 1024)}`,
              secrets,
            ),
          },
          responseDetails,
        );
      }

      return this.withDeliveryMetadata(
        provider,
        payload,
        { success: true },
        responseDetails,
      );
    } catch (error) {
      const errorMessage = this.safeSendError(
        'Webhook',
        error instanceof Error && error.name === 'AbortError'
          ? 'timed out after 10 seconds'
          : getErrorMessage(error),
        secrets,
      );
      this.logger.error(errorMessage);

      return this.withDeliveryMetadata(
        provider,
        payload,
        {
          success: false,
          error: errorMessage,
        },
        {
          ...deliveryDetails,
          attempts: 1,
        },
      );
    }
  }

  private getWebhookDeliveryDetails(
    config: Record<string, unknown>,
    payload: NotificationPayload,
  ): ProviderDeliveryDetails {
    const eventAction = this.getWebhookAlertAction(payload);
    const dedupKey = this.getWebhookDedupKey(payload);
    const preset = typeof config.preset === 'string' ? config.preset : '';

    return {
      dedupKey,
      eventAction,
      externalIncidentKey: preset && preset !== 'custom' ? dedupKey : undefined,
    };
  }

  private normalizeWebhookMethod(method: unknown): 'GET' | 'POST' | 'PUT' {
    if (typeof method !== 'string' || method.trim().length === 0) {
      return 'POST';
    }

    const normalizedMethod = method.trim().toUpperCase();
    if (!WEBHOOK_ALLOWED_METHODS.has(normalizedMethod)) {
      throw new Error('Webhook method must be one of: GET, POST, PUT');
    }

    return normalizedMethod as 'GET' | 'POST' | 'PUT';
  }

  private normalizeWebhookHeaders(
    headers: unknown,
  ): Record<string, string> | undefined {
    if (headers === undefined || headers === null) {
      return undefined;
    }

    if (typeof headers !== 'object' || Array.isArray(headers)) {
      throw new Error('Webhook headers must be a JSON object');
    }

    const normalizedEntries = Object.entries(headers as Record<string, unknown>)
      .map(([rawName, rawValue]) => {
        const name = rawName.trim();
        const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
        return [name, value] as const;
      })
      .filter(([name, value]) => {
        return (
          name.length > 0 || (typeof value === 'string' && value.length > 0)
        );
      });

    if (normalizedEntries.length > WEBHOOK_MAX_HEADERS) {
      throw new Error(
        `Webhook headers cannot exceed ${WEBHOOK_MAX_HEADERS} entries`,
      );
    }

    const normalizedHeaders: Record<string, string> = {};
    const seenHeaderNames = new Set<string>();

    for (const [name, value] of normalizedEntries) {
      const lowerName = name.toLowerCase();

      if (!WEBHOOK_HEADER_NAME_PATTERN.test(name)) {
        throw new Error(`Webhook header "${name}" has an invalid name`);
      }

      if (WEBHOOK_BLOCKED_HEADERS.has(lowerName)) {
        throw new Error(`Webhook header "${name}" is managed by Supercheck`);
      }

      if (seenHeaderNames.has(lowerName)) {
        throw new Error(`Webhook header "${name}" is duplicated`);
      }

      if (typeof value !== 'string') {
        throw new Error(`Webhook header "${name}" value must be a string`);
      }

      if (value.length > WEBHOOK_MAX_HEADER_VALUE_LENGTH) {
        throw new Error(
          `Webhook header "${name}" cannot exceed ${WEBHOOK_MAX_HEADER_VALUE_LENGTH} characters`,
        );
      }

      seenHeaderNames.add(lowerName);
      normalizedHeaders[name] = value;
    }

    return Object.keys(normalizedHeaders).length > 0
      ? normalizedHeaders
      : undefined;
  }

  private buildWebhookRequestBody(
    config: Record<string, unknown>,
    formatted: FormattedNotification,
    payload: NotificationPayload,
  ): string {
    if (
      typeof config.bodyTemplate !== 'string' ||
      config.bodyTemplate.trim().length === 0
    ) {
      return JSON.stringify({
        ...formatted,
        originalPayload: payload,
        provider: 'webhook',
        version: '1.0',
      });
    }

    const renderedTemplate = this.renderWebhookTemplateValue(
      this.parseWebhookTemplate(config.bodyTemplate),
      this.getWebhookTemplateVariables(formatted, payload),
    );

    return JSON.stringify(renderedTemplate);
  }

  private getWebhookTemplateVariables(
    formatted: FormattedNotification,
    payload: NotificationPayload,
  ): Record<string, string> {
    const alertAction = this.getWebhookAlertAction(payload);

    return {
      title: formatted.title,
      message: formatted.message,
      severity: payload.severity,
      normalizedSeverity: this.normalizeWebhookSeverity(payload.severity),
      status: payload.metadata?.status || payload.severity,
      monitorName: payload.targetName,
      targetName: payload.targetName,
      targetUrl: payload.metadata?.targetUrl || '',
      targetId: payload.targetId,
      timestamp: payload.timestamp.toISOString(),
      type: payload.type,
      projectName: payload.projectName || '',
      projectId: payload.projectId || '',
      responseTime: String(payload.metadata?.responseTime ?? ''),
      errorMessage: clip(
        String(payload.metadata?.errorMessage ?? ''),
        EMAIL_ERROR_MAX,
      ),
      monitorType: payload.metadata?.monitorType || '',
      dashboardUrl: payload.metadata?.dashboardUrl || '',
      alertAction,
      eventAction: alertAction,
      pagerDutyEventAction: alertAction,
      victorOpsMessageType: this.getVictorOpsMessageType(alertAction),
      splunkOnCallMessageType: this.getVictorOpsMessageType(alertAction),
      dedupKey: this.getWebhookDedupKey(payload),
    };
  }

  private getVictorOpsMessageType(
    alertAction: string,
  ): 'CRITICAL' | 'RECOVERY' {
    return alertAction === 'resolve' ? 'RECOVERY' : 'CRITICAL';
  }

  private getWebhookAlertAction(payload: NotificationPayload): string {
    const explicitAction = this.getExplicitWebhookAlertAction(payload);
    if (explicitAction) {
      return explicitAction;
    }

    switch (payload.type) {
      // A renewed certificate closes the SSL warning (same dedup key, see getWebhookDedupScope).
      case 'monitor_recovery':
      case 'ssl_renewed':
        return 'resolve';
      case 'monitor_failure':
      case 'job_failed':
      case 'job_success':
      case 'job_timeout':
      case 'ssl_expiring':
        return 'trigger';
      default:
        // Backward compatibility for older payload names used in tests and
        // previous monitor status paths.
        if (payload.type === ('monitor_up' as AlertType)) {
          return 'resolve';
        }
        return 'trigger';
    }
  }

  private getExplicitWebhookAlertAction(
    payload: NotificationPayload,
  ): 'trigger' | 'resolve' | undefined {
    const action: unknown =
      payload.metadata?.pagerDutyEventAction ??
      payload.metadata?.eventAction ??
      payload.metadata?.alertAction;

    if (typeof action !== 'string') {
      return undefined;
    }

    const normalizedAction = action.trim().toLowerCase();
    return normalizedAction === 'trigger' || normalizedAction === 'resolve'
      ? normalizedAction
      : undefined;
  }

  private getWebhookDedupKey(payload: NotificationPayload): string {
    if (typeof payload.metadata?.dedupKey === 'string') {
      const dedupKey = payload.metadata.dedupKey.trim();
      if (dedupKey.length > 0) {
        return dedupKey;
      }
    }

    return `${this.getWebhookDedupScope(payload)}:${payload.targetId}`;
  }

  private getWebhookDedupScope(payload: NotificationPayload): string {
    if (
      payload.type === 'job_failed' ||
      payload.type === 'job_success' ||
      payload.type === 'job_timeout'
    ) {
      return 'job';
    }

    if (payload.type === 'ssl_expiring' || payload.type === 'ssl_renewed') {
      return 'ssl';
    }

    return 'monitor';
  }

  private normalizeWebhookSeverity(
    severity: NotificationPayload['severity'],
  ): 'critical' | 'error' | 'warning' | 'info' {
    switch (severity) {
      case 'success':
        return 'info';
      case 'info':
      case 'warning':
      case 'error':
        return severity;
      default: {
        const exhaustiveCheck: never = severity;
        return exhaustiveCheck;
      }
    }
  }

  private parseWebhookTemplate(template: string): unknown {
    try {
      return JSON.parse(template);
    } catch {
      throw new Error('Webhook body template must be valid JSON');
    }
  }

  private renderWebhookTemplateValue(
    value: unknown,
    templateVariables: Record<string, string>,
  ): unknown {
    if (typeof value === 'string') {
      return this.renderWebhookTemplateString(value, templateVariables);
    }

    if (Array.isArray(value)) {
      return value.map((item) =>
        this.renderWebhookTemplateValue(item, templateVariables),
      );
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [
          this.renderWebhookTemplateString(key, templateVariables),
          this.renderWebhookTemplateValue(child, templateVariables),
        ]),
      );
    }

    return value;
  }

  private renderWebhookTemplateString(
    value: string,
    templateVariables: Record<string, string>,
  ): string {
    return value.replace(
      WEBHOOK_TEMPLATE_PATTERN,
      (match, key: string) => templateVariables[key] ?? match,
    );
  }

  private async sendTelegramNotification(
    config: Record<string, unknown>,
    formatted: FormattedNotification,
    // ___payload: NotificationPayload,
  ): Promise<{ success: boolean; error?: string }> {
    const secrets: string[] = [];
    try {
      const botToken = config.botToken as string | undefined;
      const chatId = config.chatId as string | undefined;
      if (!botToken || !chatId) {
        throw new Error('Telegram bot token and chat ID are required');
      }
      secrets.push(botToken);
      // Token is interpolated into the URL path: reject anything that could alter it.
      if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(botToken)) {
        throw new Error('Telegram bot token has an invalid format');
      }

      const telegramMessage = this.formatTelegramMessage(formatted);
      const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

      const retryConfig = createRetryConfig();

      const result = await fetchWithRetry(
        telegramUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Supercheck-Monitor/1.0',
          },
          body: JSON.stringify({
            chat_id: chatId,
            // Plain text: monitor names and errors often contain _ or *, which break
            // Telegram Markdown parsing and make the API reject the whole alert.
            text: telegramMessage,
          }),
        },
        retryConfig,
        this.logger,
        fetchPublicEndpoint,
      );

      if (result.success) {
        this.logger.debug(
          `Telegram notification sent successfully after ${result.attempts} attempt(s)`,
        );
        return { success: true };
      }

      this.logger.error(
        `Failed to send Telegram notification after ${result.attempts} attempts: ${this.safeSendError('Telegram', result.error, secrets)}`,
      );
      return {
        success: false,
        error: this.safeSendError('Telegram', result.error, secrets),
      };
    } catch (error) {
      this.logger.error(
        `Failed to send Telegram notification: ${this.safeSendError('Telegram', getErrorMessage(error), secrets)}`,
        getErrorStack(error),
      );
      return {
        success: false,
        error: this.safeSendError('Telegram', getErrorMessage(error), secrets),
      };
    }
  }

  private async sendDiscordNotification(
    config: Record<string, unknown>,
    formatted: FormattedNotification,
    // ___payload: NotificationPayload,
  ): Promise<{ success: boolean; error?: string }> {
    const secrets: string[] = [];
    try {
      const webhookUrl = config.discordWebhookUrl as string | undefined;
      if (!webhookUrl) {
        throw new Error('Discord webhook URL is required');
      }
      secrets.push(webhookUrl);
      assertAllowedHost(webhookUrl, DISCORD_HOSTS, 'Discord');

      const retryConfig = createRetryConfig();

      const result = await fetchWithRetry(
        webhookUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Supercheck-Monitor/1.0',
          },
          body: JSON.stringify({
            // Discord rejects the whole message when a field is over its limit
            // or the footer text is empty.
            content: clip(escapeMarkdown(formatted.title), 2000),
            embeds: [
              {
                title: clip(escapeMarkdown(formatted.title), 256),
                description: clip(
                  escapeDiscordDescription(formatted.message),
                  4096,
                ),
                color: parseInt(formatted.color.replace('#', ''), 16),
                fields: formatted.fields.slice(0, 25).map((field) => ({
                  name: clip(escapeMarkdown(field.title), 256),
                  value: clip(
                    field.raw
                      ? field.value || '-'
                      : escapeMarkdown(field.value || '-'),
                    1024,
                  ),
                  inline: field.short || false,
                })),
                footer: { text: formatted.footer?.trim() || 'Supercheck' },
                timestamp: new Date(formatted.timestamp * 1000).toISOString(),
              },
            ],
            // Monitor names and errors are user text; never ping @everyone or roles.
            allowed_mentions: { parse: [] },
          }),
        },
        retryConfig,
        this.logger,
        fetchPublicEndpoint,
      );

      if (result.success) {
        this.logger.debug(
          `Discord notification sent successfully after ${result.attempts} attempt(s)`,
        );
        return { success: true };
      }

      this.logger.error(
        `Failed to send Discord notification after ${result.attempts} attempts: ${this.safeSendError('Discord', result.error, secrets)}`,
      );
      return {
        success: false,
        error: this.safeSendError('Discord', result.error, secrets),
      };
    } catch (error) {
      this.logger.error(
        `Failed to send Discord notification: ${this.safeSendError('Discord', getErrorMessage(error), secrets)}`,
      );
      return {
        success: false,
        error: this.safeSendError('Discord', getErrorMessage(error), secrets),
      };
    }
  }

  /**
   * Send notification to Microsoft Teams using Incoming Webhook with Adaptive Cards
   * @see https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook
   */
  private async sendTeamsNotification(
    config: Record<string, unknown>,
    formatted: FormattedNotification,
  ): Promise<{ success: boolean; error?: string }> {
    const secrets: string[] = [];
    try {
      const webhookUrl = config.teamsWebhookUrl as string | undefined;
      if (webhookUrl) secrets.push(webhookUrl);

      // Input validation
      if (!webhookUrl || typeof webhookUrl !== 'string') {
        this.logger.error('Teams webhook URL is missing or invalid');
        return {
          success: false,
          error: 'Teams webhook URL is missing or invalid',
        };
      }

      // Validate URL is parseable
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(webhookUrl);
      } catch {
        this.logger.error('Teams webhook URL is not a valid URL');
        return {
          success: false,
          error: 'Teams webhook URL is not a valid URL',
        };
      }

      // Security: Ensure HTTPS only
      if (parsedUrl.protocol !== 'https:') {
        this.logger.error('Teams webhook URL must use HTTPS');
        return { success: false, error: 'Teams webhook URL must use HTTPS' };
      }

      // Check against allowed Microsoft domains (shared constant for DRY)
      const hostname = parsedUrl.hostname.toLowerCase();
      const isValidDomain = isValidTeamsWebhookDomain(hostname);
      if (!isValidDomain) {
        this.logger.error(
          `Invalid Teams webhook URL domain: ${hostname}. ${getTeamsWebhookDomainError()}`,
        );
        return { success: false, error: getTeamsWebhookDomainError() };
      }

      // Map severity color to Teams Adaptive Card color
      const getTeamsColor = (hexColor: string): string => {
        switch (hexColor) {
          case '#ef4444': // Red - error
            return 'attention';
          case '#22c55e': // Green - success
            return 'good';
          case '#f59e0b': // Amber - warning
            return 'warning';
          default:
            return 'default';
        }
      };

      // Sanitize input fields to prevent injection
      const sanitizeText = (
        text: string | undefined | null,
        raw = false,
      ): string => {
        if (!text) return '';
        // Remove control characters (keeping line breaks) and limit length
        const clean = text
          // eslint-disable-next-line no-control-regex
          .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '')
          .substring(0, 5000);
        return raw ? clean : escapeMarkdown(clean);
      };

      // Build Adaptive Card payload for Teams
      const adaptiveCardPayload = {
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
              $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
              type: 'AdaptiveCard',
              version: '1.4',
              body: [
                {
                  type: 'TextBlock',
                  text: sanitizeText(formatted.title),
                  weight: 'bolder',
                  size: 'large',
                  color: getTeamsColor(formatted.color),
                  wrap: true,
                },
                {
                  type: 'TextBlock',
                  text: sanitizeText(formatted.message),
                  wrap: true,
                  spacing: 'medium',
                },
                {
                  type: 'FactSet',
                  facts: (formatted.fields || [])
                    .filter(
                      (f) =>
                        f?.value &&
                        typeof f.value === 'string' &&
                        f.value.trim() !== '',
                    )
                    .slice(0, 10) // Teams limits FactSet items
                    .map((f) => ({
                      title: sanitizeText(f.title),
                      value: f.raw
                        ? sanitizeText(f.value, true)
                        : sanitizeText(f.value),
                    })),
                  spacing: 'medium',
                },
              ],
            },
          },
        ],
      };

      const retryConfig = createRetryConfig();

      const result = await fetchWithRetry(
        webhookUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Supercheck-Monitor/1.0',
          },
          body: JSON.stringify(adaptiveCardPayload),
        },
        retryConfig,
        this.logger,
        fetchPublicEndpoint,
      );

      if (result.success) {
        this.logger.debug(
          `Teams notification sent successfully after ${result.attempts} attempt(s)`,
        );
        return { success: true };
      }

      this.logger.error(
        `Failed to send Teams notification after ${result.attempts} attempts: ${this.safeSendError('Teams', result.error, secrets)}`,
      );
      return {
        success: false,
        error: this.safeSendError('Teams', result.error, secrets),
      };
    } catch (error) {
      this.logger.error(
        `Failed to send Teams notification: ${this.safeSendError('Teams', getErrorMessage(error), secrets)}`,
      );
      return {
        success: false,
        error: this.safeSendError('Teams', getErrorMessage(error), secrets),
      };
    }
  }

  /** Failure text for delivery history; strips webhook URLs and bot tokens. */
  private safeSendError(
    label: string,
    message: string | undefined,
    secrets: string[],
  ): string {
    let text = message ?? 'Unknown error';
    const variants = new Set(secrets);
    for (const secret of secrets) {
      try {
        const parsed = new URL(secret);
        variants.add(parsed.href);
        if (parsed.pathname.length > 1) variants.add(parsed.pathname);
        // Providers can echo just one component, so redact each long path segment and query value too.
        for (const part of [
          ...parsed.pathname.split('/'),
          ...parsed.searchParams.values(),
          // Raw (percent-encoded) values, as providers may echo them unchanged.
          ...parsed.search
            .slice(1)
            .split('&')
            .map((pair) => pair.slice(pair.indexOf('=') + 1)),
        ])
          if (part.length >= 8) variants.add(part);
      } catch {
        // not a URL (e.g. bot token)
      }
    }
    // Longest first so href is redacted before its pathname substring.
    for (const secret of [...variants].sort((a, b) => b.length - a.length))
      text = text.split(secret).join('[redacted]');
    return `${label} delivery failed: ${clip(text, 300)}`;
  }

  private formatTelegramMessage(formatted: FormattedNotification): string {
    const fieldsText = formatted.fields
      .map((field) => `${field.title}: ${field.value}`)
      .join('\n');
    // Telegram rejects messages over 4096 characters.
    return clip(
      `${formatted.title}\n\n${formatted.message}\n\n${fieldsText}`,
      4096,
    );
  }

  private getColorForSeverity(severity: string): string {
    switch (severity) {
      case 'error':
        return '#ef4444'; // Red
      case 'warning':
        return '#f59e0b'; // Amber
      case 'success':
        return '#22c55e'; // Green
      case 'info':
        return '#3b82f6'; // Blue
      default:
        return '#6b7280'; // Gray
    }
  }
}
