import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

/**
 * Email Template Service (BullMQ-based)
 *
 * This service fetches rendered email templates from the centralized Next.js app
 * via BullMQ queues. It provides retry logic, caching, and fallback mechanisms
 * for reliability.
 *
 * Architecture:
 * 1. Worker adds job to email-template-render queue
 * 2. Next.js app processes job and renders template
 * 3. Worker waits for result with timeout
 * 4. Result is cached for performance
 * 5. If queue fails, falls back to basic HTML
 */

interface EmailTemplateJob {
  template: string;
  data: Record<string, any>;
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);
  private readonly cache = new Map<
    string,
    { data: RenderedEmail; timestamp: number }
  >();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly QUEUE_TIMEOUT = 10000; // 10 seconds
  private readonly EMAIL_TEMPLATE_QUEUE_NAME = 'email-template-render';

  private queue: Queue<EmailTemplateJob, RenderedEmail> | null = null;
  private queueEvents: QueueEvents | null = null;
  private redisConnection: Redis | null = null;

  constructor(private configService: ConfigService) {}

  /**
   * Initialize BullMQ queue connection
   */
  private async initializeQueue(): Promise<void> {
    if (this.queue) {
      return;
    }

    try {
      // Create Redis connection
      const redisHost = this.configService.get<string>(
        'REDIS_HOST',
        'localhost',
      );
      const redisPort = this.configService.get<number>('REDIS_PORT', 6379);
      const redisPassword = this.configService.get<string>('REDIS_PASSWORD');
      const redisTlsEnabled =
        this.configService.get<string>('REDIS_TLS_ENABLED', 'false') ===
        'true';

      this.redisConnection = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        tls: redisTlsEnabled
          ? {
              rejectUnauthorized:
                this.configService.get<string>(
                  'REDIS_TLS_REJECT_UNAUTHORIZED',
                  'true',
                ) !== 'false',
            }
          : undefined,
      });

      // Create queue for adding jobs
      this.queue = new Queue<EmailTemplateJob, RenderedEmail>(
        this.EMAIL_TEMPLATE_QUEUE_NAME,
        {
          connection: this.redisConnection,
        },
      );

      // Create queue events for waiting on results
      this.queueEvents = new QueueEvents(this.EMAIL_TEMPLATE_QUEUE_NAME, {
        connection: this.redisConnection.duplicate(),
      });

      this.logger.log('Email template queue initialized successfully');
    } catch (error) {
      this.logger.error(
        `Failed to initialize email template queue: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Render a monitor alert email template
   */
  async renderMonitorAlertEmail(params: {
    title: string;
    message: string;
    fields: Array<{ title: string; value: string }>;
    footer: string;
    type: 'failure' | 'success' | 'warning';
    color: string;
  }): Promise<RenderedEmail> {
    return this.fetchTemplate('monitor-alert', params);
  }

  /**
   * Render a job failure email template
   */
  async renderJobFailureEmail(params: {
    jobName: string;
    duration: number;
    errorMessage?: string;
    totalTests?: number;
    passedTests?: number;
    failedTests?: number;
    runId?: string;
    dashboardUrl?: string;
  }): Promise<RenderedEmail> {
    return this.fetchTemplate('job-failure', params);
  }

  /**
   * Render a job success email template
   */
  async renderJobSuccessEmail(params: {
    jobName: string;
    duration: number;
    totalTests?: number;
    passedTests?: number;
    failedTests?: number;
    runId?: string;
    dashboardUrl?: string;
  }): Promise<RenderedEmail> {
    return this.fetchTemplate('job-success', params);
  }

  /**
   * Render a job timeout email template
   */
  async renderJobTimeoutEmail(params: {
    jobName: string;
    duration: number;
    runId?: string;
    dashboardUrl?: string;
  }): Promise<RenderedEmail> {
    return this.fetchTemplate('job-timeout', params);
  }

  /**
   * Generic method to fetch any email template via BullMQ
   */
  private async fetchTemplate(
    template: string,
    data: Record<string, any>,
  ): Promise<RenderedEmail> {
    const cacheKey = this.getCacheKey(template, data);

    // Check cache first
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger.debug(`Using cached template for ${template}`);
      return cached;
    }

    // Ensure queue is initialized
    await this.initializeQueue();

    if (!this.queue || !this.queueEvents) {
      this.logger.warn(
        'Queue not initialized, falling back to basic HTML template',
      );
      return this.getFallbackEmail(template, data);
    }

    try {
      this.logger.debug(
        `Fetching template ${template} via BullMQ (timeout: ${this.QUEUE_TIMEOUT}ms)`,
      );

      // Add job to queue
      const job = await this.queue.add(
        'render-template',
        { template, data },
        {
          jobId: `worker-${template}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );

      // Wait for job to complete with timeout
      const result = await Promise.race([
        job.waitUntilFinished(this.queueEvents, this.QUEUE_TIMEOUT),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Template rendering timeout after ${this.QUEUE_TIMEOUT}ms`,
                ),
              ),
            this.QUEUE_TIMEOUT,
          ),
        ),
      ]);

      // Cache the result
      this.setCache(cacheKey, result);

      this.logger.debug(`Successfully fetched template ${template}`);

      return result;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch template ${template} via BullMQ: ${error instanceof Error ? error.message : String(error)}. Using fallback.`,
      );

      // Return fallback HTML
      return this.getFallbackEmail(template, data);
    }
  }

  /**
   * Fallback email generation when queue is unavailable
   */
  private getFallbackEmail(
    template: string,
    data: Record<string, any>,
  ): RenderedEmail {
    this.logger.warn(`Using fallback email for template: ${template}`);

    switch (template) {
      case 'monitor-alert':
      case 'job-failure':
      case 'job-success':
      case 'job-timeout':
        return {
          subject: data.title || 'Notification',
          text: this.generateFallbackText(data),
          html: this.generateFallbackHTML(data),
        };
      default:
        return {
          subject: 'Notification',
          text: JSON.stringify(data, null, 2),
          html: `<pre>${JSON.stringify(data, null, 2)}</pre>`,
        };
    }
  }

  /**
   * Generate fallback plain text email
   */
  private generateFallbackText(data: any): string {
    const lines = [
      'SUPERCHECK NOTIFICATION',
      '',
      data.title || 'Alert',
      '',
      data.message || '',
      '',
      'ALERT DETAILS:',
    ];

    if (data.fields && Array.isArray(data.fields)) {
      data.fields.forEach((field: any) => {
        lines.push(`${field.title}: ${field.value}`);
      });
    }

    lines.push('');
    lines.push(data.footer || 'Supercheck Monitoring System');
    lines.push('');
    lines.push('This is an automated notification from your monitoring system.');

    return lines.join('\n');
  }

  /**
   * Generate fallback HTML email
   */
  private generateFallbackHTML(data: any): string {
    const fieldsHtml =
      data.fields && Array.isArray(data.fields)
        ? data.fields
            .map(
              (field: any) => `
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">
                ${this.escapeHtml(field.title)}:
              </td>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;">
                ${this.escapeHtml(field.value)}
              </td>
            </tr>
          `,
            )
            .join('')
        : '';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: ${data.color || '#f44336'}; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
            <h1 style="margin: 0;">Supercheck Notification</h1>
          </div>
          <div style="background: #fff; padding: 20px; border: 1px solid #ddd; border-top: none;">
            <h2 style="margin-top: 0;">${this.escapeHtml(data.title || 'Alert')}</h2>
            <div style="background: #f9f9f9; padding: 15px; border-left: 4px solid ${this.escapeHtml(data.color || '#f44336')}; margin: 20px 0;">
              <p style="margin: 0;">${this.escapeHtml(data.message || '')}</p>
            </div>
            <h3>Alert Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              ${fieldsHtml}
            </table>
          </div>
          <div style="background: #f5f5f5; padding: 15px; text-align: center; border-radius: 0 0 5px 5px; font-size: 12px; color: #666;">
            <p style="margin: 0;">${this.escapeHtml(data.footer || 'Supercheck Monitoring System')}</p>
            <p style="margin: 5px 0 0;">This is an automated notification from your monitoring system.</p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Escape HTML to prevent XSS in fallback emails
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Cache management
   */
  private getCacheKey(template: string, data: Record<string, any>): string {
    return `${template}:${JSON.stringify(data)}`;
  }

  private getFromCache(key: string): RenderedEmail | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  private setCache(key: string, data: RenderedEmail): void {
    // Limit cache size
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Health check: Test connection to email template queue
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      await this.initializeQueue();

      if (!this.queue) {
        return {
          healthy: false,
          message: 'Email template queue not initialized',
        };
      }

      // Check if queue is responding
      const jobCounts = await this.queue.getJobCounts();

      return {
        healthy: true,
        message: `Email template queue is healthy (${jobCounts.waiting} waiting, ${jobCounts.active} active)`,
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Cannot reach email template queue: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy() {
    if (this.queue) {
      await this.queue.close();
    }

    if (this.queueEvents) {
      await this.queueEvents.close();
    }

    if (this.redisConnection) {
      await this.redisConnection.quit();
    }

    this.logger.log('Email template service connections closed');
  }
}
