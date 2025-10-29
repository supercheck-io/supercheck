import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import {
  AlertType,
  NotificationProviderType,
  PlainNotificationProviderConfig,
} from '../db/schema';

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

interface WebhookConfig {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
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
  }>;
  color: string;
  footer: string;
  timestamp: number;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor() {
    this.logger.log('NotificationService initialized');
  }

  async sendNotification(
    provider: NotificationProvider,
    payload: NotificationPayload,
  ): Promise<boolean> {
    this.logger.log(
      `Sending notification via ${provider.type} for ${payload.type}: ${payload.title}`,
    );

    let success = false;

    try {
      // Validate provider configuration
      if (!this.validateProviderConfig(provider)) {
        this.logger.error(
          `Invalid configuration for provider ${provider.id} (${provider.type})`,
        );
        return false;
      }

      // Enhanced payload with standardized formatting
      const enhancedPayload = this.enhancePayload(payload);
      const formattedNotification = this.formatNotification(enhancedPayload);

      // Send the actual notification
      switch (provider.type) {
        case 'email':
          success = await this.sendEmailNotification(
            provider.config,
            formattedNotification,
            enhancedPayload,
          );
          break;
        case 'slack':
          success = await this.sendSlackNotification(
            provider.config,
            formattedNotification,
          );
          break;
        case 'webhook':
          success = await this.sendWebhookNotification(
            provider.config,
            formattedNotification,
            enhancedPayload,
          );
          break;
        case 'telegram':
          success = await this.sendTelegramNotification(
            provider.config,
            formattedNotification,
          );
          break;
        case 'discord':
          success = await this.sendDiscordNotification(
            provider.config,
            formattedNotification,
          );
          break;
        default: {
          const _exhaustiveCheck: never = provider.type;
          this.logger.error(
            `Unsupported notification provider type: ${String(provider.type)}`,
          );
          success = false;
          // Use exhaustive check to ensure all cases are handled
          return _exhaustiveCheck;
        }
      }

      if (success) {
        this.logger.log(
          `Successfully sent notification via ${provider.type} for ${payload.type}`,
        );
      } else {
        this.logger.error(
          `Failed to send notification via ${provider.type} for ${payload.type}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to send notification via ${provider.type}:`,
        error,
      );
      success = false;
    }

    return success;
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
    if (payload.type.includes('monitor') || payload.type === 'ssl_expiring') {
      dashboardUrl = `${baseUrl}/notification-monitor/${payload.targetId}`;
    } else if (payload.type.includes('job')) {
      dashboardUrl = `${baseUrl}/jobs`;
      if (payload.metadata?.runId) {
        dashboardUrl = `${baseUrl}/notification-run/${payload.metadata.runId}`;
      }
    } else {
      dashboardUrl = `${baseUrl}/alerts`;
    }

    const targetUrl = payload.metadata?.target;

    return {
      ...payload,
      metadata: {
        ...payload.metadata,
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
    const isMonitor =
      payload.type.includes('monitor') || payload.type === 'ssl_expiring';
    // const __isJob = payload.type.includes('job');

    // Consistent title format without emojis for professional appearance
    const title = payload.title;

    // Enhanced message with context
    let enhancedMessage = payload.message;
    if (payload.metadata?.errorMessage) {
      enhancedMessage += `\n\n**Error Details:** ${payload.metadata.errorMessage}`;
    }

    // Build standardized fields
    const fields: Array<{ title: string; value: string; short?: boolean }> = [];

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
      value: payload.timestamp.toUTCString(),
      short: true,
    });

    // Response time
    if (payload.metadata?.responseTime !== undefined) {
      fields.push({
        title: 'Response Time',
        value: `${payload.metadata.responseTime}ms`,
        short: true,
      });
    }

    // Target URL
    if (payload.metadata?.targetUrl) {
      fields.push({
        title: 'Target URL',
        value: payload.metadata.targetUrl,
        short: false,
      });
    }

    // Dashboard link
    if (payload.metadata?.dashboardUrl) {
      // Determine the appropriate label based on the payload type
      const dashboardLabel =
        payload.type.includes('monitor') || payload.type === 'ssl_expiring'
          ? '🔗 Monitor Details'
          : payload.type.includes('job')
            ? '🔗 Job Details'
            : '🔗 Dashboard';

      fields.push({
        title: dashboardLabel,
        value: payload.metadata.dashboardUrl,
        short: false,
      });
    }

    // Removed: Trigger field - not required in notifications

    return {
      title,
      message: enhancedMessage,
      fields,
      color: this.getColorForSeverity(payload.severity),
      footer: 'sent by supercheck',
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
          return !!slackConfig.webhookUrl;
        }
        case 'webhook': {
          const webhookConfig = provider.config as WebhookConfig;
          return !!webhookConfig.url;
        }
        case 'telegram': {
          const telegramConfig = provider.config as TelegramConfig;
          return !!(telegramConfig.botToken && telegramConfig.chatId);
        }
        case 'discord': {
          const discordConfig = provider.config as DiscordConfig;
          return !!discordConfig.discordWebhookUrl;
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
  ): Promise<{
    success: number;
    failed: number;
    results: Array<{
      provider: NotificationProvider;
      success: boolean;
      error?: string;
    }>;
  }> {
    if (!providers || providers.length === 0) {
      this.logger.warn('No providers to send notifications to');
      return { success: 0, failed: 0, results: [] };
    }

    this.logger.log(`Sending notifications to ${providers.length} providers`);

    const settledResults = await Promise.allSettled(
      providers.map((provider) => this.sendNotification(provider, payload)),
    );

    const detailedResults = settledResults.map((result, index) => {
      const provider = providers[index];

      if (result.status === 'fulfilled') {
        const success = Boolean(result.value);
        return {
          provider,
          success,
          error: success ? undefined : 'Notification send returned false',
        };
      }

      return {
        provider,
        success: false,
        error: getErrorMessage(result.reason),
      };
    });

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
  ): Promise<boolean> {
    try {
      // Parse email addresses from config
      const emailAddresses = this.parseEmailAddresses(config);
      if (emailAddresses.length === 0) {
        throw new Error('No valid email addresses found');
      }

      const emailContent = this.formatEmailContent(formatted, payload);

      // Send via SMTP
      const smtpSuccess = await this.trySMTPDelivery(
        config,
        formatted,
        emailContent,
        emailAddresses,
      );
      if (smtpSuccess) {
        this.logger.log(
          `Email notification sent successfully via SMTP to ${emailAddresses.length} recipient(s)`,
        );
        return true;
      }

      this.logger.error('SMTP email delivery failed');
      return false;
    } catch (error) {
      this.logger.error(
        `Failed to send email notification: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  private parseEmailAddresses(config: any): string[] {
    if (!config.emails) {
      return [];
    }

    return config.emails
      .split(',')
      .map((email: string) => email.trim())
      .filter((email: string) => email && this.isValidEmail(email));
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private async trySMTPDelivery(
    config: any,
    formatted: FormattedNotification,
    emailContent: { html: string; text: string },
    emailAddresses: string[],
  ): Promise<boolean> {
    try {
      // Use environment variables for SMTP configuration
      const smtpConfig = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
        tls: {
          rejectUnauthorized: false, // For development
        },
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 5000, // 5 seconds
      };

      // Check if all required SMTP environment variables are present
      if (!smtpConfig.host || !smtpConfig.auth.user || !smtpConfig.auth.pass) {
        this.logger.error(
          'SMTP environment variables not configured (missing SMTP_HOST, SMTP_USER, or SMTP_PASSWORD)',
        );
        return false;
      }

      const transporter = nodemailer.createTransport(smtpConfig);

      // Verify SMTP connection
      await transporter.verify();
      this.logger.debug('SMTP connection verified successfully');

      // Send to all email addresses
      const fromEmail =
        process.env.SMTP_FROM_EMAIL ||
        process.env.SMTP_USER ||
        smtpConfig.auth.user;

      const sendPromises = emailAddresses.map((email) =>
        transporter.sendMail({
          from: fromEmail,
          to: email,
          subject: formatted.title,
          html: emailContent.html,
          text: emailContent.text,
        }),
      );

      await Promise.all(sendPromises);
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`SMTP delivery failed: ${errorMessage}`);
      return false;
    }
  }

  private async sendSlackNotification(
    config: any,
    formatted: FormattedNotification,
    // ___payload: NotificationPayload,
  ): Promise<boolean> {
    try {
      const webhookUrl = config.webhookUrl;
      if (!webhookUrl) {
        throw new Error('Slack webhook URL is required');
      }

      this.logger.debug(
        `Sending Slack notification to: ${(webhookUrl as string).substring(0, 50)}...`,
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(webhookUrl as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Supercheck-Monitor/1.0',
        },
        body: JSON.stringify({
          text: formatted.title,
          attachments: [
            {
              color: formatted.color,
              text: formatted.message,
              fields: formatted.fields,
              footer: formatted.footer,
              ts: formatted.timestamp,
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const responseText = await response
          .text()
          .catch(() => 'Unable to read response');
        throw new Error(
          `Slack API returned ${response.status}: ${response.statusText}. Response: ${responseText}`,
        );
      }

      this.logger.debug(`Slack notification sent successfully`);
      return true;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error(`Slack notification timed out after 10 seconds`);
      } else if (error.cause?.code === 'ECONNREFUSED') {
        this.logger.error(
          `Failed to connect to Slack webhook URL - connection refused`,
        );
      } else if (error.cause?.code === 'ENOTFOUND') {
        this.logger.error(
          `Failed to resolve Slack webhook URL - DNS lookup failed`,
        );
      } else {
        this.logger.error(
          `Failed to send Slack notification: ${getErrorMessage(error)}`,
        );
      }
      return false;
    }
  }

  private async sendWebhookNotification(
    config: any,
    formatted: FormattedNotification,
    payload: NotificationPayload,
  ): Promise<boolean> {
    try {
      const webhookUrl = config.url;
      if (!webhookUrl) {
        throw new Error('Webhook URL is required');
      }

      const webhookPayload = {
        ...formatted,
        originalPayload: payload,
        provider: 'webhook',
        version: '1.0',
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(webhookUrl as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Supercheck-Monitor/1.0',
        },
        body: JSON.stringify(webhookPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const responseText = await response
          .text()
          .catch(() => 'Unable to read response');
        throw new Error(
          `Webhook returned ${response.status}: ${response.statusText}. Response: ${responseText}`,
        );
      }

      return true;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error(`Webhook notification timed out after 10 seconds`);
      } else {
        this.logger.error(
          `Failed to send webhook notification: ${getErrorMessage(error)}`,
        );
      }
      return false;
    }
  }

  private async sendTelegramNotification(
    config: any,
    formatted: FormattedNotification,
    // ___payload: NotificationPayload,
  ): Promise<boolean> {
    try {
      const { botToken, chatId } = config;
      if (!botToken || !chatId) {
        throw new Error('Telegram bot token and chat ID are required');
      }

      const telegramMessage = this.formatTelegramMessage(formatted);
      const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

      const response = await fetch(telegramUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: telegramMessage,
          parse_mode: 'Markdown',
        }),
      });

      return response.ok;
    } catch (error) {
      this.logger.error(
        `Failed to send Telegram notification: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );
      return false;
    }
  }

  private async sendDiscordNotification(
    config: any,
    formatted: FormattedNotification,
    // ___payload: NotificationPayload,
  ): Promise<boolean> {
    try {
      const webhookUrl = config.discordWebhookUrl;
      if (!webhookUrl) {
        throw new Error('Discord webhook URL is required');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(webhookUrl as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Supercheck-Monitor/1.0',
        },
        body: JSON.stringify({
          content: formatted.title,
          embeds: [
            {
              title: formatted.title,
              description: formatted.message,
              color: parseInt(formatted.color.replace('#', ''), 16),
              fields: formatted.fields.map((field) => ({
                name: field.title,
                value: field.value,
                inline: field.short || false,
              })),
              footer: {
                text: formatted.footer,
              },
              timestamp: new Date(formatted.timestamp * 1000).toISOString(),
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const responseText = await response
          .text()
          .catch(() => 'Unable to read response');
        throw new Error(
          `Discord API returned ${response.status}: ${response.statusText}. Response: ${responseText}`,
        );
      }

      return true;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error(`Discord notification timed out after 10 seconds`);
      } else {
        this.logger.error(
          `Failed to send Discord notification: ${getErrorMessage(error)}`,
        );
      }
      return false;
    }
  }

  private formatEmailContent(
    formatted: FormattedNotification,
    payload: NotificationPayload,
  ): { html: string; text: string } {
    const fieldsHtml = formatted.fields
      .map(
        (field) =>
          `<tr>
            <td style="padding: 12px 16px; font-weight: 600; vertical-align: top; border-bottom: 1px solid #f1f5f9; color: #475569; font-size: 14px; width: 140px;">
              ${field.title}:
            </td>
            <td style="padding: 12px 16px; vertical-align: top; border-bottom: 1px solid #f1f5f9; color: #334155; font-size: 14px;">
              ${field.value}
            </td>
          </tr>`,
      )
      .join('');

    const statusIcon = this.getStatusIcon(payload.type);
    const statusBadge = this.getStatusBadge(payload.type, formatted.color);

    const html = `
      <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
      <html xmlns="http://www.w3.org/1999/xhtml">
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${formatted.title}</title>
          <!--[if mso]>
          <noscript>
            <xml>
              <o:OfficeDocumentSettings>
                <o:AllowPNG/>
                <o:PixelsPerInch>96</o:PixelsPerInch>
              </o:OfficeDocumentSettings>
            </xml>
          </noscript>
          <![endif]-->
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #334155; background-color: #f8fafc;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f8fafc;">
            <tr>
              <td align="center" valign="top">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff;">
                  <!-- Header -->
                  <tr>
                    <td style="background: #667eea; padding: 32px 24px; text-align: center;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                          <td align="center">
                            <div style="background: rgba(255, 255, 255, 0.1); display: inline-block; padding: 12px; border-radius: 50%; margin-bottom: 16px;">
                              ${statusIcon}
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td align="center">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold;">
                              Supercheck Monitoring Alert
                            </h1>
                          </td>
                        </tr>
                        <tr>
                          <td align="center">
                            <p style="color: #ffffff; margin: 8px 0 0 0; font-size: 16px; opacity: 0.9;">
                              System Status Notification
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Alert Status -->
                  <tr>
                    <td style="padding: 24px; border-bottom: 1px solid #e2e8f0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                          <td>
                            <div style="margin-bottom: 16px;">
                              ${statusBadge}
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td>
                            <h2 style="color: #1e293b; margin: 0 0 8px 0; font-size: 20px; font-weight: bold;">
                              ${formatted.title}
                            </h2>
                          </td>
                        </tr>
                        <tr>
                          <td>
                            <div style="background: #f8fafc; border-left: 4px solid ${formatted.color}; padding: 16px 20px; margin-top: 16px;">
                              <p style="margin: 0; color: #475569; font-size: 15px; line-height: 1.6;">
                                ${formatted.message.replace(/\n/g, '<br>')}
                              </p>
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Details Table -->
                  <tr>
                    <td style="padding: 24px;">
                      <h3 style="color: #1e293b; margin: 0 0 16px 0; font-size: 16px; font-weight: bold; text-transform: uppercase;">
                        Alert Details
                      </h3>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #ffffff; border: 1px solid #e2e8f0;">
                        ${fieldsHtml}
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background: #f1f5f9; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
                      <p style="margin: 0 0 8px 0; color: #64748b; font-size: 13px;">
                        ${formatted.footer}
                      </p>
                      <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                        This is an automated notification from your monitoring system.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const text = `
SUPERCHECK MONITORING ALERT
${formatted.title}

${formatted.message}

ALERT DETAILS:
${formatted.fields.map((field) => `${field.title}: ${field.value}`).join('\n')}

${formatted.footer}

This is an automated notification from your monitoring system.
    `.trim();

    return { html, text };
  }

  private getStatusIcon(alertType: string): string {
    // Use Unicode symbols instead of SVG for better email client compatibility
    switch (alertType) {
      case 'monitor_failure':
      case 'job_failed':
        return '<span style="font-size: 24px; color: white; line-height: 1;">⚠️</span>';
      case 'monitor_recovery':
      case 'job_success':
        return '<span style="font-size: 24px; color: white; line-height: 1;">✅</span>';
      case 'ssl_expiration':
        return '<span style="font-size: 24px; color: white; line-height: 1;">🔒</span>';
      default:
        return '<span style="font-size: 24px; color: white; line-height: 1;">ℹ️</span>';
    }
  }

  private getStatusBadge(alertType: string, color: string): string {
    const badgeText = this.getStatusBadgeText(alertType);
    return `<span style="background: ${color}; color: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${badgeText}</span>`;
  }

  private getStatusBadgeText(alertType: string): string {
    switch (alertType) {
      case 'monitor_failure':
        return 'Monitor Down';
      case 'monitor_recovery':
        return 'Monitor Recovered';
      case 'job_failed':
        return 'Job Failed';
      case 'job_success':
        return 'Job Completed';
      case 'ssl_expiration':
        return 'SSL Warning';
      default:
        return 'Alert';
    }
  }

  private formatTelegramMessage(formatted: FormattedNotification): string {
    const fieldsText = formatted.fields
      .map((field) => `*${field.title}:* ${field.value}`)
      .join('\n');
    return `${formatted.title}\n\n${formatted.message}\n\n${fieldsText}`;
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
