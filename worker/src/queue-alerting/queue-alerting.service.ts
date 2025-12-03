/**
 * Queue Alerting Service
 *
 * Monitors BullMQ queue health and sends alerts when thresholds are exceeded.
 * Tracks queue depth, wait times, failure rates, and processing times.
 *
 * ## Alert Recipients Configuration
 *
 * Alerts can be sent via multiple channels. Configure the following environment variables:
 *
 * ### Slack (Recommended for team notifications)
 * Set `QUEUE_ALERT_SLACK_WEBHOOK_URL` to your Slack Incoming Webhook URL.
 * 1. Go to https://api.slack.com/messaging/webhooks
 * 2. Create a new webhook for your channel (e.g., #ops-alerts)
 * 3. Copy the webhook URL and set the env var
 *
 * ### Custom Webhook (For integration with PagerDuty, Opsgenie, etc.)
 * Set `QUEUE_ALERT_WEBHOOK_URL` to receive JSON POST requests with alert data.
 * The payload format is: { type: 'queue_alert', alert: QueueAlert }
 *
 * ### Email (Future enhancement)
 * Set `QUEUE_ALERT_EMAILS` to a comma-separated list of email addresses.
 * Requires email service integration (not yet implemented).
 *
 * ## Default Thresholds (based on 1-hour max job execution, 5-minute test timeout)
 *
 * | Metric | Warning | Critical |
 * |--------|---------|----------|
 * | Queue Depth | 70% of max | 90% of max |
 * | Wait Time | 15 minutes | 45 minutes |
 * | Failure Rate | 5% | 15% |
 * | Processing Time | 15 minutes | 30 minutes |
 *
 * All thresholds can be customized via environment variables.
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import {
  QueueMetrics,
  QueueAlert,
  QueueAlertType,
  AlertSeverity,
  QueueAlertingConfig,
  QueueAlertingState,
  DEFAULT_QUEUE_ALERTING_CONFIG,
} from './queue-alerting.types';
import { executeWithRetry } from '../common/utils/retry.util';

/**
 * All queues in the system that should be monitored.
 *
 * Queue categories:
 * - Execution queues: playwright-global, k6-global (test execution)
 * - Monitor queues: monitor-* (scheduled monitoring)
 * - Scheduler queues: *-scheduler (job scheduling)
 * - Job queues: job-execution, k6-job-execution (job processing)
 * - Utility queues: email-template-render (email rendering)
 */
const MONITORED_QUEUES = [
  // Playwright execution queues
  'playwright-global',

  // K6 performance test queues
  'k6-global',
  'k6-job-scheduler',
  'k6-job-execution',

  // Monitor queues (scheduled health checks)
  'monitor-global',
  'monitor-scheduler',
  'monitor-us-east',
  'monitor-eu-central',
  'monitor-asia-pacific',

  // Job execution queues
  'job-scheduler',
  'job-execution',

  // Utility queues
  'email-template-render',
];

@Injectable()
export class QueueAlertingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueAlertingService.name);
  private redisClient: Redis;
  private queues: Map<string, Queue> = new Map();
  private config: QueueAlertingConfig;
  private state: QueueAlertingState;
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly metricsHistoryLimit = 60; // Keep 60 samples (1 hour at 1-minute intervals)

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadConfig();
    this.state = {
      lastCheckTimestamp: null,
      activeAlerts: new Map(),
      alertHistory: [],
      metricsHistory: new Map(),
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.log('Queue alerting is disabled');
      return;
    }

    await this.initializeRedis();
    this.initializeQueues();
    this.startMonitoring();
    this.logger.log(
      `Queue alerting initialized with ${this.queues.size} queues`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopMonitoring();
    await this.cleanup();
  }

  /**
   * Load configuration from environment variables
   */
  private loadConfig(): QueueAlertingConfig {
    return {
      enabled:
        this.configService.get<string>('QUEUE_ALERTING_ENABLED', 'true') ===
        'true',
      checkIntervalMs: parseInt(
        this.configService.get<string>(
          'QUEUE_ALERTING_CHECK_INTERVAL_MS',
          String(DEFAULT_QUEUE_ALERTING_CONFIG.checkIntervalMs),
        ),
        10,
      ),
      queueDepthWarningThreshold: parseInt(
        this.configService.get<string>(
          'QUEUE_DEPTH_WARNING_THRESHOLD',
          String(DEFAULT_QUEUE_ALERTING_CONFIG.queueDepthWarningThreshold),
        ),
        10,
      ),
      queueDepthCriticalThreshold: parseInt(
        this.configService.get<string>(
          'QUEUE_DEPTH_CRITICAL_THRESHOLD',
          String(DEFAULT_QUEUE_ALERTING_CONFIG.queueDepthCriticalThreshold),
        ),
        10,
      ),
      maxQueueDepth: parseInt(
        this.configService.get<string>(
          'MAX_QUEUE_DEPTH',
          String(DEFAULT_QUEUE_ALERTING_CONFIG.maxQueueDepth),
        ),
        10,
      ),
      waitTimeWarningThresholdMs: parseInt(
        this.configService.get<string>(
          'QUEUE_WAIT_TIME_WARNING_MS',
          String(DEFAULT_QUEUE_ALERTING_CONFIG.waitTimeWarningThresholdMs),
        ),
        10,
      ),
      waitTimeCriticalThresholdMs: parseInt(
        this.configService.get<string>(
          'QUEUE_WAIT_TIME_CRITICAL_MS',
          String(DEFAULT_QUEUE_ALERTING_CONFIG.waitTimeCriticalThresholdMs),
        ),
        10,
      ),
      failureRateWarningThreshold: parseFloat(
        this.configService.get<string>(
          'QUEUE_FAILURE_RATE_WARNING',
          String(DEFAULT_QUEUE_ALERTING_CONFIG.failureRateWarningThreshold),
        ),
      ),
      failureRateCriticalThreshold: parseFloat(
        this.configService.get<string>(
          'QUEUE_FAILURE_RATE_CRITICAL',
          String(DEFAULT_QUEUE_ALERTING_CONFIG.failureRateCriticalThreshold),
        ),
      ),
      processingTimeWarningThresholdMs: parseInt(
        this.configService.get<string>(
          'QUEUE_PROCESSING_TIME_WARNING_MS',
          String(
            DEFAULT_QUEUE_ALERTING_CONFIG.processingTimeWarningThresholdMs,
          ),
        ),
        10,
      ),
      processingTimeCriticalThresholdMs: parseInt(
        this.configService.get<string>(
          'QUEUE_PROCESSING_TIME_CRITICAL_MS',
          String(
            DEFAULT_QUEUE_ALERTING_CONFIG.processingTimeCriticalThresholdMs,
          ),
        ),
        10,
      ),
      failureRateWindowMs: parseInt(
        this.configService.get<string>(
          'QUEUE_FAILURE_RATE_WINDOW_MS',
          String(DEFAULT_QUEUE_ALERTING_CONFIG.failureRateWindowMs),
        ),
        10,
      ),
      minSamplesForFailureRate: parseInt(
        this.configService.get<string>(
          'QUEUE_MIN_SAMPLES_FOR_FAILURE_RATE',
          String(DEFAULT_QUEUE_ALERTING_CONFIG.minSamplesForFailureRate),
        ),
        10,
      ),
      alertCooldownMs: parseInt(
        this.configService.get<string>(
          'QUEUE_ALERT_COOLDOWN_MS',
          String(DEFAULT_QUEUE_ALERTING_CONFIG.alertCooldownMs),
        ),
        10,
      ),
      alertWebhookUrl: this.configService.get<string>(
        'QUEUE_ALERT_WEBHOOK_URL',
      ),
      alertEmails: this.configService
        .get<string>('QUEUE_ALERT_EMAILS', '')
        .split(',')
        .filter(Boolean),
      slackWebhookUrl: this.configService.get<string>(
        'QUEUE_ALERT_SLACK_WEBHOOK_URL',
      ),
    };
  }

  /**
   * Initialize Redis connection
   */
  private async initializeRedis(): Promise<void> {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = parseInt(
      this.configService.get<string>('REDIS_PORT', '6379'),
      10,
    );
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const username = this.configService.get<string>('REDIS_USERNAME');
    const tlsEnabled =
      this.configService.get<string>('REDIS_TLS_ENABLED', 'false') === 'true';

    this.redisClient = new Redis({
      host,
      port,
      password: password || undefined,
      username: username || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (attempt: number) =>
        Math.min(1000 * Math.pow(2, attempt), 10000),
      tls: tlsEnabled
        ? {
            rejectUnauthorized:
              this.configService.get<string>(
                'REDIS_TLS_REJECT_UNAUTHORIZED',
                'true',
              ) !== 'false',
          }
        : undefined,
    });

    this.redisClient.on('error', (err) => {
      this.logger.error('Queue alerting Redis error:', err);
    });

    await this.redisClient.ping();
    this.logger.log('Queue alerting Redis connection established');
  }

  /**
   * Initialize queue connections
   */
  private initializeQueues(): void {
    for (const queueName of MONITORED_QUEUES) {
      try {
        const queue = new Queue(queueName, {
          connection: this.redisClient.duplicate(),
        });
        this.queues.set(queueName, queue);
        this.state.metricsHistory.set(queueName, []);
        this.logger.debug(`Initialized monitoring for queue: ${queueName}`);
      } catch (error) {
        this.logger.warn(
          `Failed to initialize queue ${queueName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }
  }

  /**
   * Start the monitoring loop
   */
  private startMonitoring(): void {
    this.logger.log(
      `Starting queue monitoring with ${this.config.checkIntervalMs}ms interval`,
    );

    // Run immediately on start
    this.runHealthCheck().catch((error) => {
      this.logger.error('Initial health check failed:', error);
    });

    // Set up interval
    this.checkInterval = setInterval(() => {
      this.runHealthCheck().catch((error) => {
        this.logger.error('Health check failed:', error);
      });
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop the monitoring loop
   */
  private stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.logger.log('Queue monitoring stopped');
    }
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    for (const [name, queue] of this.queues) {
      try {
        await queue.close();
        this.logger.debug(`Closed queue: ${name}`);
      } catch (error) {
        this.logger.warn(`Error closing queue ${name}:`, error);
      }
    }
    this.queues.clear();

    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }

  /**
   * Run health check on all queues
   */
  private async runHealthCheck(): Promise<void> {
    this.state.lastCheckTimestamp = new Date();
    const alerts: QueueAlert[] = [];

    for (const [name, queue] of this.queues) {
      try {
        const metrics = await this.collectQueueMetrics(name, queue);
        this.updateMetricsHistory(name, metrics);

        const queueAlerts = this.evaluateThresholds(metrics);
        alerts.push(...queueAlerts);
      } catch (error) {
        this.logger.error(`Error collecting metrics for queue ${name}:`, error);
      }
    }

    // Process alerts
    await this.processAlerts(alerts);
  }

  /**
   * Collect metrics for a queue
   */
  private async collectQueueMetrics(
    name: string,
    queue: Queue,
  ): Promise<QueueMetrics> {
    const [counts, isPaused] = await Promise.all([
      queue.getJobCounts(),
      queue.isPaused(),
    ]);

    // Get oldest waiting job timestamp
    const waitingJobs = await queue.getJobs(['waiting'], 0, 0);
    const oldestJobTimestamp =
      waitingJobs.length > 0 ? waitingJobs[0].timestamp : null;

    // Calculate failure rate from history
    const history = this.state.metricsHistory.get(name) || [];
    const recentHistory = history.filter(
      (m) =>
        new Date().getTime() - m.timestamp.getTime() <
        this.config.failureRateWindowMs,
    );

    let failureRate = 0;
    if (recentHistory.length >= this.config.minSamplesForFailureRate) {
      const totalCompleted = recentHistory.reduce(
        (sum, m) => sum + m.completed,
        0,
      );
      const totalFailed = recentHistory.reduce((sum, m) => sum + m.failed, 0);
      const totalProcessed = totalCompleted + totalFailed;
      if (totalProcessed > 0) {
        failureRate = (totalFailed / totalProcessed) * 100;
      }
    }

    // Calculate average processing time (simplified - based on completed count trend)
    let averageProcessingTime: number | null = null;
    if (recentHistory.length >= 2) {
      const firstSample = recentHistory[0];
      const lastSample = recentHistory[recentHistory.length - 1];
      const completedDiff = lastSample.completed - firstSample.completed;
      const timeDiff =
        lastSample.timestamp.getTime() - firstSample.timestamp.getTime();
      if (completedDiff > 0 && timeDiff > 0) {
        averageProcessingTime = timeDiff / completedDiff;
      }
    }

    return {
      name,
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      paused: isPaused ? 1 : 0,
      waitingChildren: counts['waiting-children'] || 0,
      oldestJobTimestamp,
      averageProcessingTime,
      failureRate,
      timestamp: new Date(),
    };
  }

  /**
   * Update metrics history for a queue
   */
  private updateMetricsHistory(name: string, metrics: QueueMetrics): void {
    const history = this.state.metricsHistory.get(name) || [];
    history.push(metrics);

    // Keep only the last N samples
    while (history.length > this.metricsHistoryLimit) {
      history.shift();
    }

    this.state.metricsHistory.set(name, history);
  }

  /**
   * Evaluate thresholds and generate alerts
   */
  private evaluateThresholds(metrics: QueueMetrics): QueueAlert[] {
    const alerts: QueueAlert[] = [];
    const now = new Date();

    // Check queue depth
    const queueDepth = metrics.waiting + metrics.delayed;
    const queueDepthPercent = (queueDepth / this.config.maxQueueDepth) * 100;

    if (queueDepthPercent >= this.config.queueDepthCriticalThreshold) {
      alerts.push(
        this.createAlert(
          metrics.name,
          'QUEUE_DEPTH_HIGH',
          'critical',
          `Queue depth at ${queueDepthPercent.toFixed(1)}% (${queueDepth} jobs)`,
          queueDepthPercent,
          this.config.queueDepthCriticalThreshold,
          now,
        ),
      );
    } else if (queueDepthPercent >= this.config.queueDepthWarningThreshold) {
      alerts.push(
        this.createAlert(
          metrics.name,
          'QUEUE_DEPTH_HIGH',
          'warning',
          `Queue depth at ${queueDepthPercent.toFixed(1)}% (${queueDepth} jobs)`,
          queueDepthPercent,
          this.config.queueDepthWarningThreshold,
          now,
        ),
      );
    }

    // Check wait time
    if (metrics.oldestJobTimestamp) {
      const waitTimeMs = now.getTime() - metrics.oldestJobTimestamp;

      if (waitTimeMs >= this.config.waitTimeCriticalThresholdMs) {
        alerts.push(
          this.createAlert(
            metrics.name,
            'WAIT_TIME_HIGH',
            'critical',
            `Oldest job waiting for ${(waitTimeMs / 60000).toFixed(1)} minutes`,
            waitTimeMs,
            this.config.waitTimeCriticalThresholdMs,
            now,
          ),
        );
      } else if (waitTimeMs >= this.config.waitTimeWarningThresholdMs) {
        alerts.push(
          this.createAlert(
            metrics.name,
            'WAIT_TIME_HIGH',
            'warning',
            `Oldest job waiting for ${(waitTimeMs / 60000).toFixed(1)} minutes`,
            waitTimeMs,
            this.config.waitTimeWarningThresholdMs,
            now,
          ),
        );
      }
    }

    // Check failure rate
    if (metrics.failureRate >= this.config.failureRateCriticalThreshold) {
      alerts.push(
        this.createAlert(
          metrics.name,
          'FAILURE_RATE_HIGH',
          'critical',
          `Failure rate at ${metrics.failureRate.toFixed(1)}%`,
          metrics.failureRate,
          this.config.failureRateCriticalThreshold,
          now,
        ),
      );
    } else if (metrics.failureRate >= this.config.failureRateWarningThreshold) {
      alerts.push(
        this.createAlert(
          metrics.name,
          'FAILURE_RATE_HIGH',
          'warning',
          `Failure rate at ${metrics.failureRate.toFixed(1)}%`,
          metrics.failureRate,
          this.config.failureRateWarningThreshold,
          now,
        ),
      );
    }

    // Check processing time
    if (metrics.averageProcessingTime !== null) {
      if (
        metrics.averageProcessingTime >=
        this.config.processingTimeCriticalThresholdMs
      ) {
        alerts.push(
          this.createAlert(
            metrics.name,
            'PROCESSING_TIME_HIGH',
            'critical',
            `Average processing time ${(metrics.averageProcessingTime / 60000).toFixed(1)} minutes`,
            metrics.averageProcessingTime,
            this.config.processingTimeCriticalThresholdMs,
            now,
          ),
        );
      } else if (
        metrics.averageProcessingTime >=
        this.config.processingTimeWarningThresholdMs
      ) {
        alerts.push(
          this.createAlert(
            metrics.name,
            'PROCESSING_TIME_HIGH',
            'warning',
            `Average processing time ${(metrics.averageProcessingTime / 60000).toFixed(1)} minutes`,
            metrics.averageProcessingTime,
            this.config.processingTimeWarningThresholdMs,
            now,
          ),
        );
      }
    }

    // Check for stalled queue (active jobs but nothing completing)
    const history = this.state.metricsHistory.get(metrics.name) || [];
    if (
      history.length >= this.config.minSamplesForFailureRate &&
      metrics.active > 0
    ) {
      const recentHistory = history.slice(-5);
      const completedDelta =
        recentHistory[recentHistory.length - 1].completed -
        recentHistory[0].completed;
      const failedDelta =
        recentHistory[recentHistory.length - 1].failed -
        recentHistory[0].failed;

      if (completedDelta === 0 && failedDelta === 0 && metrics.active > 0) {
        alerts.push(
          this.createAlert(
            metrics.name,
            'QUEUE_STALLED',
            'critical',
            `Queue appears stalled: ${metrics.active} active jobs, no progress in last ${recentHistory.length} checks`,
            metrics.active,
            0,
            now,
          ),
        );
      }
    }

    return alerts;
  }

  /**
   * Create an alert object
   */
  private createAlert(
    queueName: string,
    alertType: QueueAlertType,
    severity: AlertSeverity,
    message: string,
    currentValue: number,
    threshold: number,
    timestamp: Date,
  ): QueueAlert {
    return {
      id: uuidv4(),
      queueName,
      alertType,
      severity,
      message,
      currentValue,
      threshold,
      timestamp,
      resolved: false,
    };
  }

  /**
   * Process alerts - send notifications for new alerts, resolve old ones
   */
  private async processAlerts(newAlerts: QueueAlert[]): Promise<void> {
    const now = new Date();

    // Check for resolved alerts
    const currentAlertKeys = new Set(
      newAlerts.map((a) => `${a.queueName}:${a.alertType}`),
    );
    for (const [key, activeAlert] of this.state.activeAlerts) {
      if (!currentAlertKeys.has(key)) {
        // Alert resolved
        activeAlert.resolved = true;
        activeAlert.resolvedAt = now;
        this.state.alertHistory.push(activeAlert);
        this.state.activeAlerts.delete(key);
        this.logger.log(
          `Alert resolved: ${activeAlert.queueName} - ${activeAlert.alertType}`,
        );
      }
    }

    // Process new alerts
    for (const alert of newAlerts) {
      const alertKey = `${alert.queueName}:${alert.alertType}`;
      const existingAlert = this.state.activeAlerts.get(alertKey);

      if (existingAlert) {
        // Update existing alert if severity changed
        if (existingAlert.severity !== alert.severity) {
          this.state.activeAlerts.set(alertKey, alert);
          await this.sendAlertNotification(alert);
        }
      } else {
        // New alert - check cooldown
        const lastAlertOfType = this.state.alertHistory
          .filter(
            (a) =>
              a.queueName === alert.queueName &&
              a.alertType === alert.alertType,
          )
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

        const shouldSend =
          !lastAlertOfType ||
          now.getTime() - lastAlertOfType.timestamp.getTime() >=
            this.config.alertCooldownMs;

        if (shouldSend) {
          this.state.activeAlerts.set(alertKey, alert);
          await this.sendAlertNotification(alert);
        }
      }
    }

    // Trim alert history (keep last 1000)
    while (this.state.alertHistory.length > 1000) {
      this.state.alertHistory.shift();
    }
  }

  /**
   * Send alert notification via configured channels
   */
  private async sendAlertNotification(alert: QueueAlert): Promise<void> {
    this.logger.warn(`Queue alert: ${alert.queueName} - ${alert.message}`);

    // Send to Slack if configured
    if (this.config.slackWebhookUrl) {
      try {
        await executeWithRetry(() => this.sendSlackNotification(alert), {
          maxRetries: 3,
          initialDelayMs: 1000,
          maxDelayMs: 10000,
        });
      } catch (error) {
        this.logger.error('Failed to send Slack alert:', error);
      }
    }

    // Send to custom webhook if configured
    if (this.config.alertWebhookUrl) {
      try {
        await executeWithRetry(() => this.sendWebhookNotification(alert), {
          maxRetries: 3,
          initialDelayMs: 1000,
          maxDelayMs: 10000,
        });
      } catch (error) {
        this.logger.error('Failed to send webhook alert:', error);
      }
    }
  }

  /**
   * Send Slack notification
   */
  private async sendSlackNotification(alert: QueueAlert): Promise<void> {
    if (!this.config.slackWebhookUrl) return;

    const color = alert.severity === 'critical' ? '#dc3545' : '#ffc107';

    const response = await fetch(this.config.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [
          {
            color,
            title: `Queue Alert: ${alert.queueName}`,
            fields: [
              { title: 'Type', value: alert.alertType, short: true },
              {
                title: 'Severity',
                value: alert.severity.toUpperCase(),
                short: true,
              },
              { title: 'Message', value: alert.message, short: false },
              {
                title: 'Current Value',
                value: alert.currentValue.toFixed(2),
                short: true,
              },
              {
                title: 'Threshold',
                value: String(alert.threshold),
                short: true,
              },
            ],
            footer: 'Queue Alerting Service',
            ts: Math.floor(alert.timestamp.getTime() / 1000),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status}`);
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(alert: QueueAlert): Promise<void> {
    if (!this.config.alertWebhookUrl) return;

    const response = await fetch(this.config.alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'queue_alert',
        alert,
      }),
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`);
    }
  }

  /**
   * Get current queue metrics (for health endpoint)
   */
  getMetrics(): Map<string, QueueMetrics[]> {
    return this.state.metricsHistory;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): QueueAlert[] {
    return Array.from(this.state.activeAlerts.values());
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit = 100): QueueAlert[] {
    return this.state.alertHistory.slice(-limit);
  }

  /**
   * Get current configuration
   */
  getConfig(): QueueAlertingConfig {
    return { ...this.config };
  }
}
