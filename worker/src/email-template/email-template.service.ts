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
  private readonly QUEUE_TIMEOUT = 30000; // 30 seconds (increased from 10s)
  private readonly QUEUE_RETRY_ATTEMPTS = 3; // Retry failed queue operations
  private readonly QUEUE_RETRY_DELAY = 500; // Base delay for exponential backoff
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
        this.configService.get<string>('REDIS_TLS_ENABLED', 'false') === 'true';

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

      this.logger.log(
        `Email template queue initialized successfully (timeout: ${this.QUEUE_TIMEOUT}ms, retries: ${this.QUEUE_RETRY_ATTEMPTS})`,
      );
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
   * Render a job failure email template (generic, no test stats)
   */
  async renderJobFailureEmail(params: {
    jobName: string;
    duration: number;
    errorMessage?: string;
    runId?: string;
    dashboardUrl?: string;
  }): Promise<RenderedEmail> {
    return this.fetchTemplate('job-failure', params);
  }

  /**
   * Render a job success email template (generic, no test stats)
   */
  async renderJobSuccessEmail(params: {
    jobName: string;
    duration: number;
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
   * Generic method to fetch any email template via BullMQ with retry logic
   */
  private async fetchTemplate(
    template: string,
    data: Record<string, any>,
  ): Promise<RenderedEmail> {
    const cacheKey = this.getCacheKey(template, data);

    // Check cache first (disabled in development for hot-reload)
    const isDevelopment = process.env.NODE_ENV !== 'production';
    if (!isDevelopment) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        this.logger.debug(`Using cached template for ${template}`);
        return cached;
      }
    }

    // Ensure queue is initialized
    await this.initializeQueue();

    if (!this.queue || !this.queueEvents) {
      const errorMsg = `Queue not initialized for template ${template}. Cannot render email without queue.`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Retry logic with exponential backoff
    for (let attempt = 0; attempt < this.QUEUE_RETRY_ATTEMPTS; attempt++) {
      try {
        this.logger.debug(
          `Fetching template ${template} via BullMQ (attempt ${attempt + 1}/${this.QUEUE_RETRY_ATTEMPTS}, timeout: ${this.QUEUE_TIMEOUT}ms)`,
        );

        // Add job to queue
        const job = await this.queue.add(
          'render-template',
          { template, data },
          {
            jobId: `worker-${template}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            removeOnComplete: {
              age: 3600, // Keep completed jobs for 1 hour for Bull Dashboard visibility
              count: 100, // Keep last 100 completed jobs
            },
            removeOnFail: {
              age: 86400, // Keep failed jobs for 24 hours for debugging
              count: 50, // Keep last 50 failed jobs
            },
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

        // Cache the result (disabled in development for hot-reload)
        if (!isDevelopment) {
          this.setCache(cacheKey, result);
        }

        this.logger.debug(
          `Successfully fetched template ${template} on attempt ${attempt + 1}`,
        );

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const isLastAttempt = attempt === this.QUEUE_RETRY_ATTEMPTS - 1;

        if (isLastAttempt) {
          this.logger.error(
            `Failed to render template ${template} after ${this.QUEUE_RETRY_ATTEMPTS} attempts. Last error: ${errorMessage}`,
          );
          // Throw error instead of using fallback - ensures React Email templates are always used
          throw new Error(
            `Template rendering failed after ${this.QUEUE_RETRY_ATTEMPTS} attempts for ${template}: ${errorMessage}`,
          );
        } else {
          const delayMs = this.QUEUE_RETRY_DELAY * Math.pow(2, attempt);
          this.logger.warn(
            `Attempt ${attempt + 1} failed for template ${template}: ${errorMessage}. Retrying in ${delayMs}ms...`,
          );
          // Wait before retrying with exponential backoff
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // This should never be reached due to throw above, but TypeScript requires a return
    throw new Error(
      `Template rendering failed unexpectedly for template ${template}`,
    );
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
   * This ensures the queue-based template renderer is available.
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      await this.initializeQueue();

      if (!this.queue) {
        return {
          healthy: false,
          message:
            'Email template queue not initialized - templates will use fallback rendering',
        };
      }

      // Check if queue is responding
      const jobCounts = await this.queue.getJobCounts();

      return {
        healthy: true,
        message: `Email template queue is healthy (${jobCounts.waiting} waiting, ${jobCounts.active} active, timeout: ${this.QUEUE_TIMEOUT}ms, retries: ${this.QUEUE_RETRY_ATTEMPTS})`,
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Cannot reach email template queue - templates will use fallback rendering. Error: ${error instanceof Error ? error.message : String(error)}`,
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
