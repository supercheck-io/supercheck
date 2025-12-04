import { Injectable, Logger, Inject } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, inArray } from 'drizzle-orm';
import * as nodemailer from 'nodemailer';
import * as schema from '../../db/schema';
import { DB_PROVIDER_TOKEN } from './db.service';
import { RedisService } from './redis.service';

/**
 * Hard Stop Notification Service
 *
 * Sends email notifications when executions are blocked due to
 * spending limit hard stops. Implements rate limiting to prevent
 * notification spam (max 1 email per hour per organization).
 */
@Injectable()
export class HardStopNotificationService {
  private readonly logger = new Logger(HardStopNotificationService.name);
  private readonly RATE_LIMIT_KEY_PREFIX = 'hard_stop_notification:';
  private readonly RATE_LIMIT_TTL_SECONDS = 3600; // 1 hour

  constructor(
    @Inject(DB_PROVIDER_TOKEN)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Send a hard stop notification if not rate limited
   */
  async notify(
    organizationId: string,
    runId: string,
    blockReason: string,
  ): Promise<{ sent: boolean; reason?: string }> {
    try {
      // Check rate limit using Redis client
      const redis = this.redisService.getClient();
      const rateLimitKey = `${this.RATE_LIMIT_KEY_PREFIX}${organizationId}`;
      const isRateLimited = await redis.exists(rateLimitKey);

      if (isRateLimited) {
        this.logger.debug(
          `[HardStop] Notification rate limited for org ${organizationId}`,
        );
        return { sent: false, reason: 'rate_limited' };
      }

      // Get organization details
      const org = await this.db.query.organization.findFirst({
        where: eq(schema.organization.id, organizationId),
      });

      if (!org) {
        return { sent: false, reason: 'organization_not_found' };
      }

      // Get admin emails
      const recipients = await this.getNotificationRecipients(organizationId);
      if (recipients.length === 0) {
        return { sent: false, reason: 'no_recipients' };
      }

      // Send email
      const sent = await this.sendHardStopEmail(
        recipients,
        org.name,
        blockReason,
        runId,
      );

      if (sent) {
        // Set rate limit using Redis client
        await redis.setex(rateLimitKey, this.RATE_LIMIT_TTL_SECONDS, '1');
        this.logger.log(
          `[HardStop] Notification sent to ${recipients.length} recipient(s) for org ${organizationId}`,
        );
      }

      return { sent };
    } catch (error) {
      this.logger.error(
        `[HardStop] Failed to send notification: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { sent: false, reason: 'error' };
    }
  }

  /**
   * Get notification recipients for an organization
   */
  private async getNotificationRecipients(
    organizationId: string,
  ): Promise<string[]> {
    const recipients = new Set<string>();

    try {
      // Get custom notification emails from billing settings
      const settings = await this.db.query.billingSettings.findFirst({
        where: eq(schema.billingSettings.organizationId, organizationId),
      });

      if (settings?.notificationEmails) {
        // notificationEmails is stored as a JSON string
        try {
          const emails = JSON.parse(settings.notificationEmails) as string[];
          if (Array.isArray(emails)) {
            emails.forEach((email) => recipients.add(email));
          }
        } catch {
          // If it's not valid JSON, treat it as a single email
          if (
            typeof settings.notificationEmails === 'string' &&
            settings.notificationEmails.includes('@')
          ) {
            recipients.add(settings.notificationEmails);
          }
        }
      }

      // Get org admins and owners
      const adminMembers = await this.db
        .select({
          email: schema.user.email,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(
          and(
            eq(schema.member.organizationId, organizationId),
            inArray(schema.member.role, ['owner', 'admin']),
          ),
        );

      adminMembers.forEach((m) => {
        if (m.email) recipients.add(m.email);
      });
    } catch (error) {
      this.logger.warn(
        `[HardStop] Failed to fetch recipients: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return Array.from(recipients);
  }

  /**
   * Send hard stop notification email via SMTP
   */
  private async sendHardStopEmail(
    recipients: string[],
    organizationName: string,
    blockReason: string,
    runId: string,
  ): Promise<boolean> {
    try {
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = parseInt(process.env.SMTP_PORT || '587');
      const smtpUser = process.env.SMTP_USER;
      const smtpPassword = process.env.SMTP_PASSWORD;
      const smtpSecure = process.env.SMTP_SECURE === 'true';
      const fromEmail = process.env.SMTP_FROM_EMAIL || smtpUser;

      if (!smtpHost || !smtpUser || !smtpPassword) {
        this.logger.warn('[HardStop] SMTP not configured, skipping email');
        return false;
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
        tls: {
          rejectUnauthorized: true,
        },
        connectionTimeout: 10000,
        greetingTimeout: 5000,
      });

      // Verify connection
      await transporter.verify();

      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_URL ||
        'https://supercheck.io';
      const billingUrl = `${baseUrl}/org-admin?tab=subscription`;

      const subject = `Execution Blocked - Spending Limit Reached - ${organizationName}`;

      const html = this.renderHardStopEmailHtml(
        organizationName,
        blockReason,
        runId,
        billingUrl,
      );

      const text = this.renderHardStopEmailText(
        organizationName,
        blockReason,
        runId,
        billingUrl,
      );

      // Send to all recipients
      const sendPromises = recipients.map((email) =>
        transporter.sendMail({
          from: fromEmail,
          to: email,
          subject,
          html,
          text,
        }),
      );

      await Promise.all(sendPromises);
      return true;
    } catch (error) {
      this.logger.error(
        `[HardStop] SMTP delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Render HTML email content for hard stop notification
   */
  private renderHardStopEmailHtml(
    organizationName: string,
    blockReason: string,
    runId: string,
    billingUrl: string,
  ): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Execution Blocked</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 20px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Execution Blocked</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0;">Spending Limit Reached</p>
  </div>
  
  <div style="background: #fff; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
    <p style="margin-top: 0;">Hi,</p>
    
    <p>A test execution was blocked because your organization <strong>${organizationName}</strong> has reached its monthly spending limit with hard stop enabled.</p>
    
    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 16px; margin: 20px 0;">
      <p style="margin: 0; font-weight: 600; color: #991b1b;">Block Reason:</p>
      <p style="margin: 8px 0 0; color: #991b1b;">${blockReason}</p>
    </div>
    
    <p><strong>Run ID:</strong> <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 14px;">${runId}</code></p>
    
    <h3 style="margin-top: 24px;">What You Can Do:</h3>
    <ul style="padding-left: 20px;">
      <li>Increase your monthly spending limit</li>
      <li>Disable hard stop (executions will continue with overage charges)</li>
      <li>Wait for the next billing period when usage resets</li>
    </ul>
    
    <div style="margin-top: 24px;">
      <a href="${billingUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">Manage Billing Settings</a>
    </div>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    
    <p style="color: #6b7280; font-size: 14px; margin-bottom: 0;">
      This is an automated notification from Supercheck. You're receiving this because you're an admin of ${organizationName}.
    </p>
  </div>
</body>
</html>`;
  }

  /**
   * Render plain text email content for hard stop notification
   */
  private renderHardStopEmailText(
    organizationName: string,
    blockReason: string,
    runId: string,
    billingUrl: string,
  ): string {
    return `
EXECUTION BLOCKED - SPENDING LIMIT REACHED

Hi,

A test execution was blocked because your organization "${organizationName}" has reached its monthly spending limit with hard stop enabled.

BLOCK REASON:
${blockReason}

Run ID: ${runId}

WHAT YOU CAN DO:
- Increase your monthly spending limit
- Disable hard stop (executions will continue with overage charges)
- Wait for the next billing period when usage resets

Manage Billing Settings: ${billingUrl}

---
This is an automated notification from Supercheck.
You're receiving this because you're an admin of ${organizationName}.
`;
  }
}
