/**
 * Queue Alerting Types
 *
 * Type definitions for queue health monitoring and alerting
 */

export interface QueueMetrics {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  waitingChildren: number;
  oldestJobTimestamp: number | null;
  averageProcessingTime: number | null;
  failureRate: number;
  timestamp: Date;
}

export interface QueueAlert {
  id: string;
  queueName: string;
  alertType: QueueAlertType;
  severity: AlertSeverity;
  message: string;
  currentValue: number;
  threshold: number;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

export type QueueAlertType =
  | 'QUEUE_DEPTH_HIGH'
  | 'WAIT_TIME_HIGH'
  | 'FAILURE_RATE_HIGH'
  | 'PROCESSING_TIME_HIGH'
  | 'QUEUE_STALLED';

export type AlertSeverity = 'warning' | 'critical';

export interface QueueAlertingConfig {
  /** Whether alerting is enabled */
  enabled: boolean;

  /** Interval in ms to check queue metrics */
  checkIntervalMs: number;

  /** Queue depth threshold (percentage of max capacity) */
  queueDepthWarningThreshold: number;
  queueDepthCriticalThreshold: number;

  /** Max queue depth (number of jobs) */
  maxQueueDepth: number;

  /** Wait time thresholds in ms */
  waitTimeWarningThresholdMs: number;
  waitTimeCriticalThresholdMs: number;

  /** Failure rate thresholds (percentage) */
  failureRateWarningThreshold: number;
  failureRateCriticalThreshold: number;

  /** Processing time thresholds in ms */
  processingTimeWarningThresholdMs: number;
  processingTimeCriticalThresholdMs: number;

  /** Time window for calculating failure rate (ms) */
  failureRateWindowMs: number;

  /** Minimum samples for failure rate calculation */
  minSamplesForFailureRate: number;

  /** Cooldown period between alerts of same type (ms) */
  alertCooldownMs: number;

  /** Webhook URL for alerts (optional) */
  alertWebhookUrl?: string;

  /** Email addresses for alerts (optional) */
  alertEmails?: string[];

  /** Slack webhook URL for alerts (optional) */
  slackWebhookUrl?: string;
}

export interface QueueAlertingState {
  lastCheckTimestamp: Date | null;
  activeAlerts: Map<string, QueueAlert>;
  alertHistory: QueueAlert[];
  metricsHistory: Map<string, QueueMetrics[]>;
}

export const DEFAULT_QUEUE_ALERTING_CONFIG: QueueAlertingConfig = {
  enabled: true,
  checkIntervalMs: 60_000, // Check every minute

  // Queue depth thresholds
  queueDepthWarningThreshold: 70, // 70% of max
  queueDepthCriticalThreshold: 90, // 90% of max
  maxQueueDepth: 10_000,

  // Wait time thresholds
  // Based on: Job max execution = 1 hour, Test timeout = 5 minutes
  // Warning: If jobs are waiting 15 minutes, something may be slow
  // Critical: If jobs are waiting 45 minutes, queue is likely backed up
  waitTimeWarningThresholdMs: 15 * 60 * 1000, // 15 minutes
  waitTimeCriticalThresholdMs: 45 * 60 * 1000, // 45 minutes

  // Failure rate thresholds
  failureRateWarningThreshold: 5, // 5%
  failureRateCriticalThreshold: 15, // 15%

  // Processing time thresholds
  // Based on: Job max execution = 1 hour (3600000ms), Test timeout = 5 minutes (300000ms)
  // Warning: If average processing time exceeds 15 minutes, jobs are running long
  // Critical: If average processing time exceeds 30 minutes, jobs may be stuck
  processingTimeWarningThresholdMs: 15 * 60 * 1000, // 15 minutes
  processingTimeCriticalThresholdMs: 30 * 60 * 1000, // 30 minutes

  // Calculation windows
  failureRateWindowMs: 15 * 60 * 1000, // 15 minute window
  minSamplesForFailureRate: 10,
  alertCooldownMs: 15 * 60 * 1000, // 15 minutes between same alerts
};
